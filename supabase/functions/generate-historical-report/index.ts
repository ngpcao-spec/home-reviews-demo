import { assertMembership, requireUser } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { reputationMetrics, type ReputationReview } from '../_shared/reputation-metrics.ts'
import { CONSULTANT_VERSION as ANALYSIS_VERSION, AXES } from '../_shared/consultant-contract.ts'
import { assembleConsultantReport, consultantBatches, consultantMetrics, consultantNarrative, extractConsultantBatch, insufficient, ratingClassification, type Classification, type ConsultantFinding } from '../_shared/consultant-report.ts'

type Draft = { language: string; ai_status: string; draft_text: string | null; ai_suggested_reply: string | null }
type InputReview = ReputationReview & { review_reply_drafts: Draft[]; ai_suggested_reply?: string; ai_suggested_reply_language?: string; reply_draft_text?: string; reply_draft_language?: string; ai_status?: string }
const languageOf = (v?: string) => v?.toLowerCase().replace('_','-').split('-')[0]
const check = (error: unknown, code: string) => { if (error) throw new Error(code) }
async function fingerprint(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2,'0')).join('')
}
Deno.serve(async (request) => {
  const early = preflight(request)
  if (early) return early
  if (request.method !== 'POST') return json({error:'METHOD_NOT_ALLOWED'},405)
  let claimed: {id:string;worker:string;generation:string} | null = null
  let admin: Awaited<ReturnType<typeof requireUser>>['admin'] | null = null
  let callUsageRecorded = true
  try {
    const context = await requireUser(request)
    admin = context.admin
    const body = await request.json() as {establishment_id?:string;generation_id?:string;force?:boolean;preferred_language?:string}
    const id = body.establishment_id
    if (typeof id !== 'string') return json({error:'ESTABLISHMENT_ID_REQUIRED'},400)
    const [{data:e,error:ee},{data:profile,error:pe}] = await Promise.all([
      context.client.from('establishments').select('id,organization_id,name,rating,total_reviews,created_at').eq('id',id).single(),
      context.client.from('profiles').select('preferred_language').eq('user_id',context.user.id).single(),
    ])
    if (ee || !e) return json({error:'ESTABLISHMENT_NOT_FOUND'},404)
    await assertMembership(context.client,context.user.id,e.organization_id,['owner','admin','manager'])
    if (pe || !['fr','vi'].includes(profile?.preferred_language)) return json({error:'PREFERRED_LANGUAGE_REQUIRED'},400)
    const language = profile.preferred_language as 'fr'|'vi'
    if (body.preferred_language && body.preferred_language !== language) return json({error:'REPORT_LANGUAGE_CHANGED'},409)
    const {data:existing,error:re} = await context.client.from('historical_establishment_reports').select('*').eq('establishment_id',id).eq('preferred_language',language).maybeSingle()
    check(re,'REPORT_READ_FAILED')
    let {data:run,error:runError} = await admin.from('historical_report_runs').select('*').eq('establishment_id',id).eq('language',language).maybeSingle()
    check(runError,'REPORT_RUN_READ_FAILED')
    // Never mix V2 extraction checkpoints with the V3 analytical contract.
    if (run && run.snapshot.base.analysis_version !== ANALYSIS_VERSION && run.status !== 'completed') {
      if (body.generation_id || run.lease_until && Date.parse(run.lease_until)>Date.now()) return json({error:'REPORT_VERSION_CHANGED'},409)
      run = {...run,status:'failed'}
    }
    // A crash after saving the report must not repeat the paid summary step.
    if (run && run.snapshot.base.analysis_version === ANALYSIS_VERSION && run.status !== 'completed' && existing?.generation_id === run.generation_id && existing.ai_status === 'completed') {
      await admin.from('historical_report_runs').update({status:'completed',locked_by:null,lease_until:null}).eq('id',run.id).eq('generation_id',run.generation_id)
      return json({report:existing,cached:true})
    }
    if (body.generation_id && run?.generation_id !== body.generation_id) return json({error:'REPORT_GENERATION_CHANGED'},409)
    // An automatic resume is never permission to restart a failed run.
    if (body.generation_id && run?.status === 'failed') return json({error:'REPORT_RUN_FAILED'},409)
    if (body.generation_id && run?.status === 'completed') return json({report:existing})
    if (!run || run.status === 'completed' || run.status === 'failed') {
      enforceRateLimit('historical-report:'+context.user.id,12,3_600_000)
      const end = new Date().toISOString()
      const reviews: ReputationReview[] = []
      for (let offset=0;;offset+=500) {
        const {data,error} = await admin.from('reviews').select('id,rating,original_text,text,published_at,historical_import,has_negative_feedback,status,review_detailed_rating,review_context,ai_status,ai_suggested_reply,ai_suggested_reply_language,reply_draft_text,reply_draft_language,review_reply_drafts(language,ai_status,draft_text,ai_suggested_reply)')
          .eq('organization_id',e.organization_id).eq('establishment_id',id).lte('created_at',end).gte('rating',1).lte('rating',5).order('id').range(offset,offset+499)
        check(error,'REPORT_REVIEWS_READ_FAILED')
        for (const r of (data ?? []) as InputReview[]) {
          const localized = r.review_reply_drafts.find(d => d.language === language)
          const hasDraft = r.reply_draft_text !== null && r.reply_draft_text !== undefined
          const ready = localized ? localized.ai_status === 'completed' && Boolean((localized.draft_text ?? localized.ai_suggested_reply)?.trim())
            : r.ai_status === 'completed' && languageOf(hasDraft ? r.reply_draft_language : r.ai_suggested_reply_language) === language && Boolean((hasDraft ? r.reply_draft_text : r.ai_suggested_reply)?.trim())
          reviews.push({id:r.id,rating:r.rating,original_text:r.original_text,text:r.text,published_at:r.published_at,historical_import:r.historical_import,has_negative_feedback:r.has_negative_feedback,status:r.status,review_detailed_rating:r.review_detailed_rating,review_context:r.review_context,ready})
        }
        if ((data?.length ?? 0)<500) break
      }
      if (!reviews.length) return json({error:'NO_REVIEWS_AVAILABLE'})
      const sourceFingerprint = await fingerprint({reviews,language,googleTotal:e.total_reviews,googleRating:e.rating,version:ANALYSIS_VERSION})
      if (!body.force && existing?.analysis_version === ANALYSIS_VERSION && existing.source_fingerprint === sourceFingerprint && existing.ai_status === 'completed') return json({report:existing,cached:true})
      const dated = reviews.map(r=>r.published_at).filter((v):v is string=>!!v && Number.isFinite(Date.parse(v))).sort()
      const snapshot = {reviews, base:{ organization_id:e.organization_id,establishment_id:id,preferred_language:language,
        period_start:dated[0] ?? e.created_at,period_end:end,google_rating:e.rating,google_total_reviews:e.total_reviews,
        source_latest_published_at:dated.at(-1) ?? null,source_undated_count:reviews.length-dated.length,
        ...reputationMetrics(reviews,e.total_reviews),source_fingerprint:sourceFingerprint,analysis_version:ANALYSIS_VERSION}}
      const classifications = reviews.filter(review=>!(review.original_text ?? review.text ?? '').trim()).map(ratingClassification)
      const next = {organization_id:e.organization_id,establishment_id:id,language,generation_id:crypto.randomUUID(),status:'running',snapshot,findings:[],classifications,cursor:0,input_tokens:0,output_tokens:0,ai_calls:0,rejected_findings_count:0,token_usage_complete:true,lease_until:null,locked_by:null,error_code:null,updated_at:end}
      const resume = run?.status === 'failed' && run.snapshot.base.source_fingerprint === sourceFingerprint
      const values = resume ? {status:'running',error_code:null,lease_until:null,locked_by:null,updated_at:end} : next
      const result = run
        ? await admin.from('historical_report_runs').update(values).eq('id',run.id).eq('generation_id',run.generation_id).eq('updated_at',run.updated_at).select('*').maybeSingle()
        : await admin.from('historical_report_runs').insert(next).select('*').maybeSingle()
      if (result.error?.code === '23505' || !result.data && !result.error) return json({error:'REPORT_GENERATION_IN_PROGRESS'})
      check(result.error,'REPORT_RUN_CREATE_FAILED')
      run = result.data
    }
    const worker = crypto.randomUUID()
    const {data:locked,error:lockError} = await admin.rpc('claim_historical_report_step',{p_run_id:run.id,p_generation_id:run.generation_id,p_worker_id:worker})
    check(lockError,'REPORT_LOCK_FAILED')
    if (!locked) return json({pending:true,generation_id:run.generation_id,progress:run.cursor})
    claimed = {id:run.id,generation:run.generation_id,worker}
    const fresh = await admin.from('historical_report_runs').select('*').eq('id',run.id).single()
    check(fresh.error,'REPORT_RUN_READ_FAILED')
    run = fresh.data
    const reviews = run.snapshot.reviews as ReputationReview[]
    const batches = consultantBatches(reviews)
    const updateRun = async (values: Record<string,unknown>) => {
      const result = await admin!.from('historical_report_runs').update({...values,updated_at:new Date().toISOString()}).eq('id',run.id).eq('generation_id',run.generation_id).eq('locked_by',worker).select('id').maybeSingle()
      check(result.error,'REPORT_PROGRESS_SAVE_FAILED')
      if (!result.data) throw new Error('REPORT_LEASE_LOST')
    }
    const recordUsage = async (usage: {input_tokens:number;output_tokens:number}) => {
      await updateRun({input_tokens:run.input_tokens+usage.input_tokens,output_tokens:run.output_tokens+usage.output_tokens})
      callUsageRecorded = true
    }
    if (run.cursor < batches.length) {
      await updateRun({ai_calls:run.ai_calls+1})
      callUsageRecorded = false
      const extracted = await extractConsultantBatch(batches[run.cursor],recordUsage)
      const findings = [...new Map([...run.findings,...extracted.findings].map((f:ConsultantFinding)=>[`${f.review_id}:${f.theme_key}:${f.sentiment}`,f])).values()]
      const classifications = [...new Map([...run.classifications,...extracted.classifications].map((item:Classification)=>[item.review_id,item])).values()]
      await updateRun({findings,classifications,cursor:run.cursor+1,rejected_findings_count:run.rejected_findings_count+extracted.rejectedCount,locked_by:null,lease_until:null})
      console.info('Historical report batch completed',{batch:run.cursor+1,accepted:extracted.findings.length,rejected:extracted.rejectedCount,classification_fallback_count:extracted.classificationFallbackCount})
      claimed = null
      return json({pending:true,generation_id:run.generation_id,progress:run.cursor+1,total_steps:batches.length+1})
    }
    const metrics = consultantMetrics(reviews,run.classifications,run.findings)
    // Persist repaired final classifications before narrative/saving; basis is the durable fallback metric.
    await updateRun({classifications:metrics.classifications})
    const narrativeCall = metrics.themes.length > 0
    if (narrativeCall) { await updateRun({ai_calls:run.ai_calls+1}); callUsageRecorded = false }
    const result = narrativeCall ? await consultantNarrative(metrics,language,recordUsage) : {
      report:assembleConsultantReport(metrics,{axes:AXES.map(key=>({key})),explanations:[],conclusion:insufficient(language)},language),
      usage:{input_tokens:0,output_tokens:0},
    }
    // No establishment identity is provided to the narrative model. Reject any accidental echo.
    if (e.name && JSON.stringify(result.report).normalize('NFC').toLowerCase().includes(e.name.normalize('NFC').toLowerCase())) throw new Error('REPORT_IDENTITY_DISCLOSURE')
    const generated = new Date().toISOString()
    const input = run.input_tokens+result.usage.input_tokens, output = run.output_tokens+result.usage.output_tokens
    const row = {...run.snapshot.base,generation_id:run.generation_id,
      analytical_positive_count:metrics.positive,analytical_negative_count:metrics.negative,consultant_report:{...result.report,classification_fallback_count:metrics.classificationFallbackCount},
      ai_overall_summary:result.report.conclusion,ai_historical_summary:result.report.conclusion,ai_status:'completed',ai_error:null,ai_model:'gpt-5.6-terra',
      ai_input_tokens:input,ai_output_tokens:output,ai_total_tokens:input+output,ai_call_count:run.ai_calls+(narrativeCall?1:0),ai_cost_usd:null,
      accepted_findings_count:run.findings.length,rejected_findings_count:run.rejected_findings_count,
      processed_batches_count:run.cursor,token_usage_complete:run.token_usage_complete,
      generated_at:generated,updated_at:generated}
    await updateRun({lease_until:new Date(Date.now()+180_000).toISOString()})
    const saved = await admin.from('historical_establishment_reports').upsert(row,{onConflict:'establishment_id,preferred_language'}).select('*').single()
    check(saved.error,'REPORT_SAVE_FAILED')
    await updateRun({status:'completed',input_tokens:input,output_tokens:output,lease_until:null,locked_by:null})
    console.info('Historical report classification totals',{total:metrics.total,positive:metrics.positive,negative:metrics.negative,classification_fallback_count:metrics.classificationFallbackCount})
    claimed = null
    return json({report:saved.data})
  } catch(error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'HISTORICAL_REPORT_FAILED'
    if (claimed && admin) await admin.from('historical_report_runs').update({status:'failed',error_code:code,lease_until:null,locked_by:null,...(!callUsageRecorded?{token_usage_complete:false}:{}),updated_at:new Date().toISOString()}).eq('id',claimed.id).eq('generation_id',claimed.generation).eq('locked_by',claimed.worker)
    console.error('Historical report failed',{code})
    return json({error:code},code==='UNAUTHORIZED'?401:code==='FORBIDDEN'?403:code==='RATE_LIMITED'?429:500)
  }
})
