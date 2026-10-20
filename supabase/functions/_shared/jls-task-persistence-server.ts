// Authenticated database-only recovery / qualification. No provider credentials
// or supplier transport are accepted by either entry point.
// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {restaurantPort} from './jls-restaurant-store.ts';
import {assertEvidence40ActiveUser} from './decisions-evidence40-auth.ts';
import {hybridHash} from './jev-hybrid-evidence.ts';
import {taskReceiptWire,databasePersistenceRetry,TASK_RECEIPT_VERSION} from './jls-task-persistence.ts';
async function scope(client:SupabaseClient,run:string){
 const state=await restaurantPort(client).load(run),p=state.protocol.body;
 const member=await client.from('organization_members').select('role').eq('organization_id',p.organization_id).eq('user_id',p.authority_user_id).in('role',['owner','admin','manager']).maybeSingle();
 if(member.error||!member.data)throw Error('FORBIDDEN');
 await assertEvidence40ActiveUser(client,p.authority_user_id);return state;
}
export async function persistRestaurantReceiptsOnly(client:SupabaseClient,run:string){
 if(typeof run!=='string')throw Error('FORBIDDEN');await scope(client,run);
 const r=await client.rpc('flush_jls_restaurant_receipts',{p_run:run});
 if(r.error)throw Error('JLS_PERSISTENCE_DATABASE_FAILED');
 return {version:TASK_RECEIPT_VERSION,run_id:run,...r.data,provider_calls:0,new_attempts:0};
}
export async function restaurantPersistenceProbe(client:SupabaseClient,input:{run_id:string;task_ids:string[];nonce:string}){
 if(!Array.isArray(input.task_ids)||!input.task_ids.length||input.task_ids.length>8||new Set(input.task_ids).size!==input.task_ids.length||
  !/^[a-z0-9_-]{1,40}$/.test(input.nonce))throw Error('JLS_PERSISTENCE_PROBE_SCOPE_INVALID');
 const state=await scope(client,input.run_id),before=await hybridHash(state.run);
 if(['queued','running'].includes(state.run.status))throw Error('JLS_PERSISTENCE_PROBE_HISTORY_REQUIRED');
 const port=restaurantPort(client),selected=input.task_ids.map(id=>{
  const task=state.tasks.find(t=>t.id===id),artifact=state.artifacts.find(a=>a.kind==='task:'+id);
  if(!task||task.status!=='completed'||task.request_count!==1||!artifact||task.phase==='sol')throw Error('JLS_PERSISTENCE_PROBE_REQUIRES_SAVED_OUTCOME');
  return {task,artifact};
 });
 const at=performance.now();
 const results=await Promise.all(selected.map(async({task,artifact})=>{
  if(await hybridHash(artifact.body)!==artifact.sha256)throw Error('JLS_ARTIFACT_CHANGED');
  const receipt=await taskReceiptWire(state,task,{status:task.status,body:artifact.body,sha256:artifact.sha256},'existing_artifact');
  const start=performance.now(),save=()=>client.rpc('save_jls_restaurant_receipt',{p_task:task.id,p_worker:task.worker,p_wire:receipt.wire,p_sha:receipt.sha256});
  const first=await save(),second=await save();
  if(first.error||second.error||first.data!==true||second.data!==true)throw Error('JLS_PERSISTENCE_PROBE_RECEIPT_FAILED');
  // This is confirmation of an already saved historical result, not a rewrite.
  const finished=await databasePersistenceRetry(()=>port.finishReceipt!(task.id));
  if(!finished)throw Error('JLS_PERSISTENCE_PROBE_CONFIRMATION_FAILED');
  return {task_id:task.id,receipt_sha256:receipt.sha256,source_artifact_sha256:artifact.sha256,idempotent:true,duration_ms:performance.now()-start};
 }));
 const after=await port.load(input.run_id);
 const ordered=(a:typeof state.artifacts)=>[...a].sort((x,y)=>x.kind.localeCompare(y.kind));
 if(await hybridHash(after.run)!==before||await hybridHash(ordered(after.artifacts))!==await hybridHash(ordered(state.artifacts)))throw Error('JLS_PERSISTENCE_PROBE_HISTORY_CHANGED');
 const body={version:TASK_RECEIPT_VERSION,run_id:input.run_id,passed:true,source:'existing_immutable_artifacts_not_new_provider_outputs',
  provider_calls:0,new_attempts:0,new_consent:false,historical_run_unchanged:true,results,wall_ms:performance.now()-at,
  execution_id:Deno.env.get('SB_EXECUTION_ID')??null};
 const saved=await client.rpc('save_jls_snapshot_preparation',{p_protocol:state.protocol.id,p_kind:'task_persistence_probe_'+input.nonce,p_body:body,p_sha:await hybridHash(body)});
 if(saved.error)throw Error('JLS_PERSISTENCE_PROBE_ARCHIVE_FAILED');return {archive_id:saved.data,...body};
}
