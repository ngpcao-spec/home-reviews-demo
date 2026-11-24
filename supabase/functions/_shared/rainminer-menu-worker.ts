import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2'
import {importRainminerMenu, RAINMINER_ACTOR, RAINMINER_ACTOR_ID} from './rainminer-menu.mjs'

const actorPath = 'acts/rainminer~google-maps-menu-scraper'
const terminal = ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']
type Job = {id:string; place_id:string; status:string; run_id:string|null; lease_until:string}
type Run = {
  id:string; actId:string; status:string; defaultKeyValueStoreId:string; defaultDatasetId:string
  buildNumber?:string; buildId?:string; startedAt?:string; finishedAt?:string
  usageTotalUsd?:number; chargedEventCounts?:Record<string,number>; pricingInfo?:unknown; usage?:unknown
  options?:{maxTotalChargeUsd?:number;isMaxTotalChargeUsdSetByUser?:boolean;restartOnError?:boolean}
}
type WorkerOptions = {fetch?:typeof fetch; now?:()=>number}

export function rainminerPricing(actor: Record<string, unknown>, now = Date.now()) {
  const entries = Array.isArray(actor.pricingInfos) ? actor.pricingInfos as Record<string, unknown>[] : []
  const pricing = entries.filter(p => Date.parse(String(p.startedAt)) <= now)
    .sort((a,b) => Date.parse(String(b.startedAt))-Date.parse(String(a.startedAt)))[0]
  const minimum = Number(pricing?.minimalMaxTotalChargeUsd ?? 0)
  if (actor.id !== RAINMINER_ACTOR_ID || actor.notice !== 'NONE' ||
      pricing?.pricingModel !== 'PAY_PER_EVENT' || pricing.isPPEPlatformUsagePaidByUser === true ||
      !Number.isFinite(minimum) || minimum < 0 || minimum > .5)
    throw Error('MENU_ACTOR_PRICING_UNSUPPORTED')
  return {actorId:actor.id, actorName:RAINMINER_ACTOR, checkedAt:new Date(now).toISOString(), pricing}
}

function receipt(run: Run) {
  return {
    id:run.id, actId:run.actId, status:run.status, buildNumber:run.buildNumber, buildId:run.buildId,
    defaultDatasetId:run.defaultDatasetId, defaultKeyValueStoreId:run.defaultKeyValueStoreId,
    startedAt:run.startedAt, finishedAt:run.finishedAt, usageTotalUsd:run.usageTotalUsd,
    chargedEventCounts:run.chargedEventCounts, pricingInfo:run.pricingInfo, usage:run.usage,
    options:run.options && {maxTotalChargeUsd:run.options.maxTotalChargeUsd,
      isMaxTotalChargeUsdSetByUser:run.options.isMaxTotalChargeUsdSetByUser,restartOnError:run.options.restartOnError},
  }
}

// One wake performs one stage. Cron resumes reads independently of the browser.
// Exactly one POST call site; a failed/uncertain POST is never repeated.
export async function advanceRainminerMenu(admin: SupabaseClient, token: string, options: WorkerOptions = {}) {
  const {data, error} = await admin.rpc('claim_rainminer_menu')
  if (error) return {error:'MENU_CLAIM_FAILED'}
  const job = data?.[0] as Job|undefined
  if (!job) return {claimed:0}
  const request = options.fetch ?? fetch
  const now = options.now ?? Date.now
  let posted = false
  let knownRun: Run|undefined
  const checkpoint = async (values: Record<string,unknown>) => {
    const saved = await admin.rpc('checkpoint_rainminer_menu', {p_job:job.id,p_lease:job.lease_until,p_values:values})
    if (saved.error || saved.data !== true) throw Error('MENU_CHECKPOINT_FAILED')
  }
  const api = async (path: string, body?: unknown) => {
    const response = await request('https://api.apify.com/v2/'+path, {
      method:body === undefined ? 'GET' : 'POST',
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:body === undefined ? undefined : JSON.stringify(body),
      signal:AbortSignal.timeout(25000),
    })
    if (!response.ok) throw Error('APIFY_HTTP_'+response.status)
    return response.json()
  }
  try {
    if (job.status === 'starting') {
      const {data:actor} = await api(actorPath)
      const pricing = rainminerPricing(actor,now())
      const input = {placeIds:[job.place_id],maxMenuImages:10,maxItems:100}
      // Lease + identity + configuration + budget reservation before POST.
      const authorized = await admin.rpc('authorize_rainminer_start', {
        p_job:job.id,p_lease:job.lease_until,p_input:input,p_pricing:pricing,
      })
      if (authorized.error) throw Error('MENU_START_AUTHORIZATION_FAILED')
      if (authorized.data?.authorized !== true) return {status:'queued',reason:authorized.data?.reason}
      posted = true
      const {data:run} = await api(actorPath+'/runs?maxTotalChargeUsd='+authorized.data.maxTotalChargeUsd+'&restartOnError=false',input)
      if (!run?.id) throw Error('MENU_RUN_ID_MISSING')
      knownRun = run
      if (run.actId !== RAINMINER_ACTOR_ID) throw Error('MENU_WRONG_ACTOR')
      await checkpoint({status:'running',run_id:run.id,run_receipt:receipt(run)})
      return {status:'running'}
    }
    if (!job.run_id) throw Error('MENU_RUN_ID_MISSING')
    const {data:run} = await api('actor-runs/'+job.run_id) as {data:Run}
    if (run.id !== job.run_id || run.actId !== RAINMINER_ACTOR_ID) throw Error('MENU_WRONG_ACTOR')
    knownRun = run
    if (!terminal.includes(run.status)) {
      await checkpoint({status:'running',run_receipt:receipt(run)})
      return {status:'running'}
    }
    const cost = typeof run.usageTotalUsd === 'number' && Number.isFinite(run.usageTotalUsd) && run.usageTotalUsd>=0
      ? run.usageTotalUsd : undefined
    if (run.status !== 'SUCCEEDED') {
      await checkpoint({status:'failed',error_code:'APIFY_'+run.status,run_receipt:receipt(run),actual_cost_usd:cost})
      return {status:'failed'}
    }
    const input = await api('key-value-stores/'+run.defaultKeyValueStoreId+'/records/INPUT')
    const {data:dataset} = await api('datasets/'+run.defaultDatasetId)
    if (!Number.isSafeInteger(dataset?.itemCount) || dataset.itemCount<0) throw Error('MENU_DATASET_INCOMPLETE')
    const raw: unknown[] = []
    for (let offset=0;offset<dataset.itemCount;offset+=100) {
      const page = await api('datasets/'+run.defaultDatasetId+'/items?clean=false&skipHidden=false&skipEmpty=false&limit=100&offset='+offset)
      if (!Array.isArray(page)) throw Error('MENU_DATASET_INCOMPLETE')
      raw.push(...page)
    }
    if (raw.length !== dataset.itemCount) throw Error('MENU_DATASET_INCOMPLETE')
    const result = importRainminerMenu(raw,{
      actor:{name:RAINMINER_ACTOR,id:run.actId},runId:run.id,datasetId:run.defaultDatasetId,input,
      build:run.buildNumber,buildId:run.buildId,startedAt:run.startedAt,finishedAt:run.finishedAt,
      retrievedAt:new Date(now()).toISOString(),status:run.status,costUsd:cost,
    },job.place_id)
    await checkpoint({
      status:'completed',raw,result,run_receipt:receipt(run),actual_cost_usd:cost,retrieved_at:new Date(now()).toISOString(),
    })
    return {status:'completed',counts:result.counts}
  } catch (error) {
    // Never log provider payloads, URLs or credentials.
    const message = error instanceof Error ? error.message : ''
    const safe = /^(?:MENU_[A-Z_]+|APIFY_HTTP_\d{3}|INVALID_MENU_INPUT)$/.test(message) ? message : 'MENU_WORKER_FAILED'
    const readRetry = job.status === 'running' && (/^APIFY_HTTP_/.test(safe) ||
      safe === 'MENU_DATASET_INCOMPLETE' || safe === 'MENU_CHECKPOINT_FAILED' ||
      error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError'))
    await checkpoint({
      status:posted?'unknown':readRetry?'running':'failed',
      error_code:posted?'START_OUTCOME_UNKNOWN':safe,
      // Preserve a known ID even if the first database acknowledgement was lost.
      ...(knownRun?{run_id:knownRun.id,run_receipt:receipt(knownRun)}:{}),
    }).catch(()=>{})
    return {error:posted?'START_OUTCOME_UNKNOWN':safe}
  }
}
