// Orchestration adapter only: existing restaurant reservations/receipts and
// Sol-ready dispatch perform every supplier attempt, with no client retries.
// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {restaurantPort} from './jls-restaurant-store.ts';
import {processRestaurant} from './jls-restaurant-worker.ts';
import {solReadyPort} from './jls-sol-ready-store.ts';
import {processReadySol} from './jls-sol-ready-worker.ts';
import {PARALLEL_REPORT,compileParallelSol,parallelExecutionContract,parallelReadyContract} from './parallel-report.ts';
export async function processParallelReport(admin:SupabaseClient,id:string,keys:{jev:string;openai:string},http:typeof fetch){
 const port=restaurantPort(admin),s=await port.load(id);
 if(s.protocol.body.version!==PARALLEL_REPORT)throw Error('PARALLEL_SCOPE_REQUIRED');
 if(!['queued','running'].includes(s.run.status)){await admin.rpc('publish_parallel_report',{p_run:id});return {phase:'already_saved',provider_calls:0};}
 if(s.run.stage==='prepare_evidence'){
  const worker=crypto.randomUUID();if(!await port.tick(id,worker))return {phase:'concurrent_or_consumed',provider_calls:0};
  let error:string|null=null;
  try{const ready=await compileParallelSol(await port.load(id));const q=await admin.rpc('prepare_parallel_ready',{p_run:id,p_worker:worker,p_body:ready.body,p_sha:ready.sha256});if(q.error)throw Error('PARALLEL_SOL_PERSISTENCE_FAILED');}
  catch(e){error=e instanceof Error&&/^[A-Z_0-9]+$/.test(e.message)?e.message:'PARALLEL_FREE_PREPARATION_FAILED';}
  finally{await port.release(id,worker,error);}
  return {phase:'free_sol_preparation',provider_calls:0,error};
 }
 if(s.run.stage==='sol'||String(s.run.stage)==='validate_sol'){
  const op=await admin.from('analysis_jls_sol_ready_operations').select('id').eq('run_id',id).single();if(op.error)throw Error('PARALLEL_SOL_OPERATION_MISSING');
  const result=await processReadySol(solReadyPort(admin),op.data.id,keys.openai,http,parallelReadyContract);
  await admin.rpc('publish_parallel_report',{p_run:id});return result;
 }
 return await processRestaurant(port,id,keys,http,parallelExecutionContract);
}
