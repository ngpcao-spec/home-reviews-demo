// Delivery adapter only. Classification, selection, wire, reservations and
// provider transport stay in the existing parallel-report worker.
// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {prepareHistoricalSnapshot,type HistoricalJob} from './historical-report-worker.ts';
import {parallelProtocol,CURRENT_V2,type ParallelCurrent,type ParallelHistory} from './parallel-report.ts';
import {currentBatchManifest,BATCH_TRANSPORT} from './current-batch-report.ts';
import {localHybridTokens} from './jev-hybrid-evidence.ts';
import {evidenceSelectorVersion} from './report-evidence-selector.ts';
import {DIRECT_COVERAGE_VERSION} from './jev-direct-evidence-selection.ts';
export const CURRENT_REPORT_CODE='bdbc5d541968adf8810cdea90fdd24f26cb1ca97';
export async function currentReportProtocol(run:HistoricalJob){
 const base=run.snapshot.base,reviews=run.snapshot.reviews;
 if(run.engine!=='jev_sol_v2'||!run.request_id||!run.requested_by||!base||!reviews?.length||base.organization_id!==run.organization_id||base.establishment_id!==run.establishment_id)throw Error('CURRENT_V2_SOURCE_MISSING');
 if(typeof base.source_fingerprint!=='string'||base.stored_reviews_count!==reviews.length)throw Error('CURRENT_V2_SOURCE_MISSING');
 const report={...base,organization_id:run.organization_id,establishment_id:run.establishment_id,stored_reviews_count:reviews.length,source_fingerprint:base.source_fingerprint,id:run.id,generation_id:run.generation_id,preferred_language:run.language,ai_status:'source_frozen',ai_model:null,consultant_report:null};
 return await parallelProtocol(report as ParallelCurrent,{id:run.id,generation_id:run.generation_id,organization_id:run.organization_id,establishment_id:run.establishment_id,status:'source_frozen',snapshot:{base,reviews}} as unknown as ParallelHistory,run.requested_by,CURRENT_REPORT_CODE,
  {version:CURRENT_V2,source_run_id:run.id,generation_id:run.generation_id,request_id:run.request_id},evidenceSelectorVersion(run.evidence_selector_version??DIRECT_COVERAGE_VERSION));
}
export async function processCurrentReportPreparation(admin:SupabaseClient,run:HistoricalJob,worker:string){
 const save=async(values:Record<string,unknown>)=>{const r=await admin.rpc('checkpoint_historical_report_run',{p_run_id:run.id,p_generation_id:run.generation_id,p_worker_id:worker,p_cursor:run.cursor,p_values:values});if(r.error||r.data!==true)throw Error('CURRENT_V2_CHECKPOINT_FAILED');};
 try{
  if(run.engine!=='jev_sol_v2'||run.v2_report_id)throw Error('CURRENT_V2_PREPARATION_SCOPE_CHANGED');
  if(!run.snapshot.reviews||!run.snapshot.base){
   const prepared=await prepareHistoricalSnapshot(admin,run);
   await save({...prepared,total_steps:null,attempt_count:0,locked_by:null,lease_until:null});
   if(run.jev_transport===BATCH_TRANSPORT){
    const wake=await admin.rpc('wake_current_jev_preparation',{p_source:run.id});
    if(wake.error)console.warn('CURRENT_BATCH_PREPARATION_WAKE_FAILED_CRON_RECOVERY');
   }
   return {phase:'source_frozen',provider_calls:0};
  }
  if(run.jev_transport===BATCH_TRANSPORT){
   // Reuse the existing free source certification, never its individual dispatch.
   const sealed=await admin.from('analysis_parallel_launch_preparations').select('body,sha256').eq('current_source_run_id',run.id).maybeSingle();
   if(sealed.error)throw Error('CURRENT_BATCH_CERTIFICATE_READ_FAILED');
   const p=sealed.data??await currentReportProtocol(run);
   if(!sealed.data){
    const certified=await admin.rpc('prepare_current_v2_protocol',{p_source:run.id,p_body:p.body,p_sha:p.sha256});if(certified.error)throw Error('CURRENT_BATCH_CERTIFICATION_FAILED');
    // The certificate is durable. Give tokenization its own CPU budget instead
    // of combining it with protocol construction in the same Edge request.
    await save({attempt_count:0,locked_by:null,lease_until:null});
    const wake=await admin.rpc('wake_current_jev_preparation',{p_source:run.id});
    if(wake.error)console.warn('CURRENT_BATCH_PREPARATION_WAKE_FAILED_CRON_RECOVERY');
    return {phase:'protocol_certified',provider_calls:0};
   }
   const manifest=await currentBatchManifest(p,localHybridTokens);
   const r=await admin.rpc('jev_batch_create_current',{p_source:run.id,p_manifest:manifest.body,p_sha:manifest.sha256});
   if(r.error||!r.data)throw Error('CURRENT_BATCH_QUEUE_FAILED');
   return {phase:'current_batches_queued',batch_run_id:r.data,provider_calls:0};
  }
  const sealed=await admin.from('analysis_parallel_launch_preparations').select('body,sha256').eq('current_source_run_id',run.id).maybeSingle();if(sealed.error)throw Error('CURRENT_V2_PREPARATION_READ_FAILED');
  if(!sealed.data){
   const p=await currentReportProtocol(run);if(!p.body.pending.length)throw Error('NO_TEXT_REVIEWS_AVAILABLE');
   const r=await admin.rpc('prepare_current_v2_protocol',{p_source:run.id,p_body:p.body,p_sha:p.sha256});if(r.error)throw Error('CURRENT_V2_CERTIFICATION_FAILED');
   await save({attempt_count:0,locked_by:null,lease_until:null});return {phase:'protocol_certified',provider_calls:0};
  }
  const r=await admin.rpc('start_parallel_report',{p_body:sealed.data.body,p_sha:sealed.data.sha256,p_user:run.requested_by});
  if(r.error||!r.data)throw Error('CURRENT_V2_QUEUE_FAILED');
  return {phase:'v2_queued',comparison_id:r.data,provider_calls:0};
 }catch(e){
  const prefix=e instanceof Error?e.message.split(':')[0]:'';
  const code=/^[A-Z_0-9]+$/.test(prefix)?prefix:'CURRENT_V2_PREPARATION_FAILED';
  await save({status:'failed',error_code:code,last_error:code,locked_by:null,lease_until:null});
  return {phase:'preparation_failed',error:code,provider_calls:0};
 }
}
