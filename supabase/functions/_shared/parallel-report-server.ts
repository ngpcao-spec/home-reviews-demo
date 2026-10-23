// Orchestration adapter only: existing restaurant reservations/receipts and
// Sol-ready dispatch perform every supplier attempt, with no client retries.
// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {restaurantPort} from './jls-restaurant-store.ts';
import {processRestaurant} from './jls-restaurant-worker.ts';
import {solReadyPort} from './jls-sol-ready-store.ts';
import {processReadySol} from './jls-sol-ready-worker.ts';
import {PARALLEL_REPORT,parallelSolEnvelope,measureParallelSolEnvelope,parallelExecutionContract,parallelReadyContract,verifyParallelRuntime,type ParallelRuntimeCertificate,type ParallelProtocol} from './parallel-report.ts';
export async function prepareParallelSolStep(admin:SupabaseClient,id:string){
 const port=restaurantPort(admin),worker=crypto.randomUUID();if(!await port.tick(id,worker))return {phase:'concurrent_or_consumed',provider_calls:0};
 let error:string|null=null,phase='free_sol_envelope';
 try{
  const s=await port.load(id);if(s.protocol.body.version!==PARALLEL_REPORT||s.run.stage!=='prepare_evidence')throw Error('PARALLEL_PREPARATION_SCOPE_CHANGED');
  const saved=s.artifacts.find(a=>a.kind==='parallel_sol_envelope_v1');
  if(!saved){
   const c=await admin.from('analysis_jls_source_certificates').select('*').eq('protocol_id',s.protocol.id).eq('organization_id',s.protocol.body.organization_id).single();if(c.error)throw Error('PARALLEL_RUNTIME_CERTIFICATE_MISSING');
   const envelope=await parallelSolEnvelope(s,c.data as ParallelRuntimeCertificate);if(!await port.artifact(id,worker,'parallel_sol_envelope_v1',envelope.body,envelope.sha256))throw Error('PARALLEL_SOL_ENVELOPE_PERSISTENCE_FAILED');
  }
  else{
   phase='free_sol_measurement';const b=saved.body as unknown as Awaited<ReturnType<typeof parallelSolEnvelope>>['body'];
   if(b.source_run_id!==id||b.source_protocol_id!==s.protocol.id||b.source_protocol_sha256!==s.protocol.sha256)throw Error('PARALLEL_SOL_ENVELOPE_SOURCE_CHANGED');
   const ready=await measureParallelSolEnvelope({body:b,sha256:saved.sha256});const q=await admin.rpc('prepare_parallel_ready',{p_run:id,p_worker:worker,p_body:ready.body,p_sha:ready.sha256});if(q.error)throw Error('PARALLEL_SOL_PERSISTENCE_FAILED');
  }
 }catch(e){error=e instanceof Error&&/^[A-Z_0-9]+$/.test(e.message)?e.message:'PARALLEL_FREE_PREPARATION_FAILED';}
 finally{await port.release(id,worker,error);}
 return {phase,provider_calls:0,error};
}
export async function processParallelReport(admin:SupabaseClient,id:string,keys:{jev:string;openai:string},http:typeof fetch){
 // Routing needs metadata only. Do not load all classifications before loading
 // them again in the shared worker or the bounded free preparation step.
 const r=await admin.from('analysis_jls_restaurant_runs').select('status,stage,protocol_id').eq('id',id).single();if(r.error)throw Error('FORBIDDEN');
 const p=await admin.from('analysis_jls_restaurant_protocols').select('body->>version').eq('id',r.data.protocol_id).single();if(p.error||p.data.version!==PARALLEL_REPORT)throw Error('PARALLEL_SCOPE_REQUIRED');
 if(!['queued','running'].includes(r.data.status)){await admin.rpc('publish_parallel_report',{p_run:id});return {phase:'already_saved',provider_calls:0};}
 if(r.data.stage==='prepare_evidence')return await prepareParallelSolStep(admin,id);
 if(r.data.stage==='sol'||r.data.stage==='validate_sol'){
  const op=await admin.from('analysis_jls_sol_ready_operations').select('id').eq('run_id',id).single();if(op.error)throw Error('PARALLEL_SOL_OPERATION_MISSING');
  const result=await processReadySol(solReadyPort(admin),op.data.id,keys.openai,http,parallelReadyContract);
  await admin.rpc('publish_parallel_report',{p_run:id});return result;
 }
 const c=await admin.from('analysis_jls_source_certificates').select('*').eq('protocol_id',r.data.protocol_id).maybeSingle();if(c.error)throw Error('PARALLEL_RUNTIME_CERTIFICATE_MISSING');
 const contract=c.data?{...parallelExecutionContract,verify:(body:Parameters<typeof parallelExecutionContract.verify>[0],sha:string)=>verifyParallelRuntime(body as unknown as ParallelProtocol,sha,r.data.protocol_id,c.data as ParallelRuntimeCertificate)}:parallelExecutionContract;
 return await processRestaurant(restaurantPort(admin),id,keys,http,contract);
}
