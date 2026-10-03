import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'
import { reputationMetrics, type ReputationReview } from './reputation-metrics.ts'
import { CONSULTANT_VERSION as ANALYSIS_VERSION, AXES } from './consultant-contract.ts'
import { assembleConsultantReport, consultantBatches, consultantMetrics, consultantNarrative, extractConsultantBatch, insufficient, ratingClassification, type Classification, type ConsultantFinding } from './consultant-report.ts'
import { historicalRetry, HISTORICAL_REPORT_LEASE_SECONDS } from './historical-report-policy.ts'

type Draft = { language: string; ai_status: string; draft_text: string | null; ai_suggested_reply: string | null }
type InputReview = ReputationReview & { review_reply_drafts: Draft[]; ai_suggested_reply?: string; ai_suggested_reply_language?: string; reply_draft_text?: string; reply_draft_language?: string; ai_status?: string }
export interface HistoricalJob {
  id:string; generation_id:string; establishment_id:string; organization_id:string; language:'fr'|'vi'; status:string; model:string;
  cursor:number; ai_calls:number; input_tokens:number; output_tokens:number; attempt_count:number;
  findings:ConsultantFinding[]; classifications:Classification[]; rejected_findings_count:number;
  snapshot:{reviews?:ReputationReview[];base?:Record<string,unknown>;publication?:Record<string,unknown>};
  token_usage_complete:boolean; created_at:string; last_error:string|null; error_code?:string|null;
}
const languageOf = (v?: string) => v?.toLowerCase().replace('_','-').split('-')[0]
const check = (error: unknown, code: string) => { if (error) throw new Error(code) }
async function fingerprint(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2,'0')).join('')
}
async function prepareSnapshot(admin:SupabaseClient, run:HistoricalJob) {
  const id=run.establishment_id, language=run.language, end=run.created_at
  const {data:e,error} = await admin.from('establishments').select('id,organization_id,name,rating,total_reviews,created_at').eq('id',id).eq('organization_id',run.organization_id).single()
  check(error,'REPORT_ESTABLISHMENT_READ_FAILED')
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
      if (!reviews.length) throw new Error('NO_REVIEWS_AVAILABLE')
      const sourceFingerprint = await fingerprint({reviews,language,googleTotal:e.total_reviews,googleRating:e.rating,version:ANALYSIS_VERSION})
      const dated = reviews.map(r=>r.published_at).filter((v):v is string=>!!v && Number.isFinite(Date.parse(v))).sort()
      const snapshot = {reviews, base:{ organization_id:e.organization_id,establishment_id:id,preferred_language:language,
        period_start:dated[0] ?? e.created_at,period_end:end,google_rating:e.rating,google_total_reviews:e.total_reviews,
        source_latest_published_at:dated.at(-1) ?? null,source_undated_count:reviews.length-dated.length,
        ...reputationMetrics(reviews,e.total_reviews),source_fingerprint:sourceFingerprint,analysis_version:ANALYSIS_VERSION}}
      const classifications = reviews.filter(review=>!(review.original_text ?? review.text ?? '').trim()).map(ratingClassification)

  return {snapshot,classifications,total_steps:consultantBatches(reviews).length+1}
}

/** One durable unit per invocation: snapshot OR extraction batch OR final narrative. */
export async function processHistoricalRun(admin:SupabaseClient, run:HistoricalJob, worker:string) {
  const started=Date.now()
  let usageRecorded=true
  const log=(event:string,extra:Record<string,unknown>={})=>console.info(event,{
    generation_id:run.generation_id,model:run.model,establishment_id:run.establishment_id,cursor:run.cursor,batch:run.cursor+1,
    attempt:run.attempt_count,duration_ms:Date.now()-started,ai_calls:run.ai_calls,...extra,
  })
  if(run.status==='failed'){log('HISTORICAL_RUN_FAILED',{code:run.error_code});return {generation_id:run.generation_id,status:'failed'}}
  log('HISTORICAL_RUN_CLAIMED')
  if(run.last_error==='REPORT_LEASE_RECOVERED') log('HISTORICAL_RUN_LEASE_RECOVERED')
  const updateRun=async(values:Record<string,unknown>)=>{
    const {data,error}=await admin.rpc('checkpoint_historical_report_run',{
      p_run_id:run.id,p_generation_id:run.generation_id,p_worker_id:worker,p_cursor:run.cursor,p_values:values,
    })
    check(error,'REPORT_PROGRESS_SAVE_FAILED')
    if(data!==true) throw new Error('REPORT_LEASE_LOST')
    Object.assign(run,values)
  }
  const recordUsage=async(usage:{input_tokens:number;output_tokens:number})=>{
    await updateRun({input_tokens:run.input_tokens+usage.input_tokens,output_tokens:run.output_tokens+usage.output_tokens})
    usageRecorded=true
  }
  try {
    if(!run.model?.trim()) throw new Error('REPORT_MODEL_MISSING')
    if(!run.snapshot.reviews || !run.snapshot.base) {
      const prepared=await prepareSnapshot(admin,run)
      await updateRun({...prepared,attempt_count:0,locked_by:null,lease_until:null,error_code:null,last_error:null})
      return {generation_id:run.generation_id,status:'running',cursor:run.cursor}
    }
    if(run.snapshot.base.analysis_version!==ANALYSIS_VERSION) throw new Error('REPORT_VERSION_CHANGED')
    const reviews=run.snapshot.reviews,language=run.language
    const batches=consultantBatches(reviews)
    // Also adopts legacy checkpoints without changing their cursor/findings/generation.
    await updateRun({total_steps:batches.length+1,lease_until:new Date(Date.now()+HISTORICAL_REPORT_LEASE_SECONDS*1000).toISOString()})
    const {data:existing,error:existingError}=await admin.from('historical_establishment_reports').select('*').eq('establishment_id',run.establishment_id).eq('preferred_language',language).maybeSingle()
    check(existingError,'REPORT_RUN_READ_FAILED')
    const publish=async(row:Record<string,unknown>)=>{
      const {data,error}=await admin.rpc('complete_historical_report_run',{
        p_run_id:run.id,p_generation_id:run.generation_id,p_worker_id:worker,p_cursor:run.cursor,p_report:row,
      })
      check(error,'REPORT_SAVE_FAILED')
      if(data!==true) throw new Error('REPORT_LEASE_LOST')
      log('HISTORICAL_RUN_COMPLETED')
      return {generation_id:run.generation_id,status:'completed',cursor:run.cursor}
    }
    if(existing?.generation_id===run.generation_id && existing.ai_status==='completed') return await publish(existing)
    // A failed publication must not pay for the final narrative again.
    if(run.snapshot.publication) return await publish(run.snapshot.publication)
    if(run.cursor<batches.length) {
      await updateRun({ai_calls:run.ai_calls+1})
      usageRecorded=false
      log('HISTORICAL_BATCH_STARTED')
      const extracted=await extractConsultantBatch(batches[run.cursor],recordUsage,run.model)
      const findings=[...new Map([...run.findings,...extracted.findings].map((f:ConsultantFinding)=>[`${f.review_id}:${f.theme_key}:${f.sentiment}`,f])).values()]
      const classifications=[...new Map([...run.classifications,...extracted.classifications].map((item:Classification)=>[item.review_id,item])).values()]
      const batch=run.cursor+1
      await updateRun({findings,classifications,cursor:batch,rejected_findings_count:run.rejected_findings_count+extracted.rejectedCount,
        attempt_count:0,error_code:null,last_error:null,locked_by:null,lease_until:null})
      log('HISTORICAL_BATCH_COMPLETED',{batch,accepted:extracted.findings.length,rejected:extracted.rejectedCount,classification_fallback_count:extracted.classificationFallbackCount})
      return {generation_id:run.generation_id,status:'running',cursor:run.cursor}
    }
    const metrics=consultantMetrics(reviews,run.classifications,run.findings)
    await updateRun({classifications:metrics.classifications})
    const narrativeCall=metrics.themes.length>0
    if(narrativeCall){await updateRun({ai_calls:run.ai_calls+1});usageRecorded=false}
    const result=narrativeCall ? await consultantNarrative(metrics,language,recordUsage,run.model) : {
      report:assembleConsultantReport(metrics,{axes:AXES.map(key=>({key})),explanations:[],conclusion:insufficient(language)},language),
      usage:{input_tokens:0,output_tokens:0},
    }
    const {data:e,error:eError}=await admin.from('establishments').select('name').eq('id',run.establishment_id).single()
    check(eError,'REPORT_ESTABLISHMENT_READ_FAILED')
    if(e.name && JSON.stringify(result.report).normalize('NFC').toLowerCase().includes(e.name.normalize('NFC').toLowerCase())) throw new Error('REPORT_IDENTITY_DISCLOSURE')
    const generated=new Date().toISOString()
    const row={...run.snapshot.base,generation_id:run.generation_id,
      analytical_positive_count:metrics.positive,analytical_negative_count:metrics.negative,consultant_report:{...result.report,classification_fallback_count:metrics.classificationFallbackCount},
      ai_overall_summary:result.report.conclusion,ai_historical_summary:result.report.conclusion,ai_status:'completed',ai_error:null,ai_model:run.model,
      ai_input_tokens:run.input_tokens,ai_output_tokens:run.output_tokens,ai_total_tokens:run.input_tokens+run.output_tokens,ai_call_count:run.ai_calls,ai_cost_usd:null,
      accepted_findings_count:run.findings.length,rejected_findings_count:run.rejected_findings_count,
      processed_batches_count:run.cursor,token_usage_complete:run.token_usage_complete,generated_at:generated,updated_at:generated}
    await updateRun({snapshot:{...run.snapshot,publication:row}})
    return await publish(row)
  } catch(error) {
    if(error instanceof Error && error.message==='REPORT_LEASE_LOST') return {generation_id:run.generation_id,status:'lease_lost'}
    const policy=historicalRetry(error,run.attempt_count)
    try {
      await updateRun({status:policy.status,last_error:policy.code,error_code:policy.code,
        next_retry_at:policy.status==='retry'?new Date(Date.now()+policy.delay*1000).toISOString():null,
        locked_by:null,lease_until:null,...(!usageRecorded?{token_usage_complete:false}:{})})
      log(policy.status==='retry'?'HISTORICAL_RUN_RETRY':'HISTORICAL_RUN_FAILED',{code:policy.code})
    } catch { log('HISTORICAL_CHECKPOINT_UNAVAILABLE') }
    return {generation_id:run.generation_id,status:policy.status,error:policy.code}
  }
}
