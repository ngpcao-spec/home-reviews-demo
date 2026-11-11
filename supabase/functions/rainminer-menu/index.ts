import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {requireUser, assertMembership, type AuthContext} from '../_shared/auth.ts';
import {json, preflight} from '../_shared/cors.ts';
import {importRainminerMenu, RAINMINER_ACTOR, RAINMINER_ACTOR_ID} from '../_shared/rainminer-menu.mjs';

const table = 'rainminer_menu_jobs';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const actorPath = 'acts/rainminer~google-maps-menu-scraper';
type Admin = AuthContext['admin'];

async function work(admin: Admin, token: string) {
  const {data, error} = await admin.rpc('claim_rainminer_menu');
  if (error) return json({error:'MENU_CLAIM_FAILED'}, 500);
  const job = data?.[0];
  if (!job) return json({claimed:0});
  let posted = false;
  const update = async (values: Record<string, unknown>) => {
    const result = await admin.from(table).update(values).eq('id',job.id)
      .eq('lease_until',job.lease_until).select('id').single();
    if (result.error) throw Error('MENU_CHECKPOINT_FAILED');
  };
  const api = async (path: string, body?: unknown) => {
    const response = await fetch('https://api.apify.com/v2/'+path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw Error('APIFY_HTTP_'+response.status);
    return response.json();
  };
  try {
    const restaurant = await admin.from('establishments').select('place_id,active').eq('id',job.establishment_id).single();
    const sharedSource = !restaurant.error && !restaurant.data.active && Deno.env.get('SHARED_RESTAURANTS_ENABLED')==='true'
      ? await admin.rpc('shared_menu_source_valid',{p_establishment:job.establishment_id,p_place:job.place_id,p_require_subscribers:job.status==='starting'}) : null;
    if (restaurant.error || (!restaurant.data.active && sharedSource?.data!==true) || restaurant.data.place_id !== job.place_id)
      throw Error('MENU_PLACE_ID_CHANGED');
    if (job.status === 'starting') {
      const {data: actor} = await api(actorPath);
      const pricing = actor.pricingInfos.filter((p: {startedAt:string}) => Date.parse(p.startedAt)<=Date.now())
        .sort((a: {startedAt:string}, b: {startedAt:string}) => Date.parse(b.startedAt)-Date.parse(a.startedAt))[0];
      if (actor.id !== RAINMINER_ACTOR_ID || actor.notice !== 'NONE' || pricing?.pricingModel !== 'PAY_PER_EVENT' ||
          pricing.isPPEPlatformUsagePaidByUser === true || (pricing.minimalMaxTotalChargeUsd ?? 0) > .5)
        throw Error('MENU_ACTOR_PRICING_UNSUPPORTED');
      posted = true;
      const {data: run} = await api(actorPath+'/runs?maxTotalChargeUsd=0.5&restartOnError=false', {
        placeIds:[job.place_id], maxMenuImages:10, maxItems:100,
      });
      if (!run?.id) throw Error('MENU_RUN_ID_MISSING');
      await update({status:'running',run_id:run.id,lease_until:null});
      return json({status:'running'});
    }
    const {data: run} = await api('actor-runs/'+job.run_id);
    if (run.actId !== RAINMINER_ACTOR_ID) throw Error('MENU_WRONG_ACTOR');
    if (!['SUCCEEDED','FAILED','ABORTED','TIMED-OUT'].includes(run.status)) {
      await update({lease_until:null});
      return json({status:'running'});
    }
    if (run.status !== 'SUCCEEDED') {
      await update({status:'failed',error_code:'APIFY_'+run.status,lease_until:null});
      return json({status:'failed'});
    }
    const input = await api('key-value-stores/'+run.defaultKeyValueStoreId+'/records/INPUT');
    const {data: dataset} = await api('datasets/'+run.defaultDatasetId);
    const raw = [];
    for (let offset=0; offset<dataset.itemCount; offset+=100) {
      const page = await api(`datasets/${run.defaultDatasetId}/items?clean=false&skipHidden=false&skipEmpty=false&limit=100&offset=${offset}`);
      raw.push(...page);
    }
    if (raw.length !== dataset.itemCount) throw Error('MENU_DATASET_INCOMPLETE');
    const result = importRainminerMenu(raw, {
      actor:{name:RAINMINER_ACTOR,id:run.actId},runId:run.id,datasetId:run.defaultDatasetId,
      input,build:run.buildNumber,startedAt:run.startedAt,finishedAt:run.finishedAt,
      status:run.status,costUsd:run.usageTotalUsd,
    }, job.place_id);
    const current = await admin.from('establishments').select('place_id,active').eq('id',job.establishment_id).single();
    const finalSharedSource = !current.error && !current.data.active && Deno.env.get('SHARED_RESTAURANTS_ENABLED')==='true'
      ? await admin.rpc('shared_menu_source_valid',{p_establishment:job.establishment_id,p_place:job.place_id,p_require_subscribers:false}) : null;
    if (current.error || (!current.data.active && finalSharedSource?.data!==true) || current.data.place_id !== job.place_id) throw Error('MENU_PLACE_ID_CHANGED');
    await update({status:'completed',raw,result,lease_until:null});
    return json({status:'completed',counts:result.counts});
  } catch (error) {
    const code = error instanceof Error ? error.message : 'MENU_WORKER_FAILED';
    const retryRead = job.status === 'running' && (/^APIFY_HTTP_/.test(code) || code === 'MENU_DATASET_INCOMPLETE' || error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError'));
    await update({status:posted?'unknown':retryRead?'running':'failed',
      error_code:posted?'START_OUTCOME_UNKNOWN':code,lease_until:null}).catch(()=>{});
    return json({error:code},502);
  }
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return preflight(request)!;
  if (request.method !== 'POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  try {
    const body = await request.json();
    const token = Deno.env.get('APIFY_API_TOKEN')?.trim();
    const url = Deno.env.get('SUPABASE_URL')!;
    const workerUrl = url+'/functions/v1/rainminer-menu';
    const isEnabled = async (admin: Admin) => {
      if (!token) return false;
      const setting = await admin.rpc('rainminer_menu_enabled',{p_worker_url:workerUrl});
      return !setting.error && setting.data === true;
    };
    if (body.action === 'work') {
      const admin = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
      const auth = await admin.rpc('verify_review_scheduler_token',{p_token:request.headers.get('x-home-reviews-scheduler')??''});
      if (auth.error || auth.data !== true) return json({error:'UNAUTHORIZED'},401);
      if (!await isEnabled(admin)) return json({error:'MENU_DISABLED'},503);
      return await work(admin,token!);
    }
    if (!uuid.test(body.establishment_id ?? '') || !['status','start'].includes(body.action))
      return json({error:'MENU_INVALID_REQUEST'},400);
    const {client,admin,user} = await requireUser(request);
    const restaurant = await client.from('establishments').select('id,organization_id,place_id')
      .eq('id',body.establishment_id).eq('active',true).single();
    if (restaurant.error) return json({error:'MENU_RESTAURANT_NOT_FOUND'},404);
    const role = await assertMembership(client,user.id,restaurant.data.organization_id);
    const canStart = ['owner','admin','manager'].includes(role) && /^ChIJ[\w-]+$/.test(restaurant.data.place_id??'') && await isEnabled(admin);
    if (body.action === 'start') {
      if (!canStart) return json({error:'MENU_START_UNAVAILABLE'},403);
      if (!uuid.test(body.request_id??'')) return json({error:'MENU_INVALID_REQUEST'},400);
      const queued = await admin.rpc('enqueue_rainminer_menu',{p_establishment:restaurant.data.id,p_request:body.request_id,p_user:user.id});
      if (queued.error) return json({error:queued.error.message.includes('MENU_QUEUE_BUSY')?'MENU_QUEUE_BUSY':'MENU_ENQUEUE_FAILED'},409);
      const {data: accepted, error} = await admin.from(table).select('id,request_id,status,error_code').eq('id',queued.data).single();
      if (error) return json({error:'MENU_STATUS_FAILED'},500);
      return json({job:accepted},202);
    }
    const jobs = admin.from(table).select('id,request_id,status,error_code')
      .eq('establishment_id',restaurant.data.id).eq('place_id',restaurant.data.place_id).order('created_at',{ascending:false});
    const [latest, completed] = await Promise.all([jobs.limit(1).maybeSingle(),
      admin.from(table).select('result').eq('establishment_id',restaurant.data.id).eq('place_id',restaurant.data.place_id)
        .eq('status','completed').order('created_at',{ascending:false}).limit(1).maybeSingle()]);
    if (latest.error || completed.error) return json({error:'MENU_STATUS_FAILED'},500);
    let result = completed.data?.result ?? null;
    let currentJob=latest.data;
    if (Deno.env.get('SHARED_RESTAURANTS_ENABLED') === 'true') {
      const shared = await admin.rpc('read_shared_establishment_menu', {p_establishment:restaurant.data.id,p_user:user.id});
      if (shared.error) return json({error:'MENU_STATUS_FAILED'},500);
      result = shared.data?.result ?? result;
      currentJob=shared.data?.job??currentJob;
    }
    return json({job:currentJob,result,canStart});
  } catch {
    return json({error:'MENU_REQUEST_REJECTED'},403);
  }
});
