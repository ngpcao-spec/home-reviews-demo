// Server wiring only; transport, reservation and persistence stay in existing workers.
// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import process from 'node:process';
import {restaurantPort} from './jls-restaurant-store.ts';
import {solReadyPort} from './jls-sol-ready-store.ts';
import {processRestaurant} from './jls-restaurant-worker.ts';
import {processReadySol} from './jls-sol-ready-worker.ts';
import {assertEvidence40ActiveUser} from './decisions-evidence40-auth.ts';
import {directHash} from './jev-direct-categories.ts';
import {verifyDirectReportSources,type DirectReportPreparation,type DirectReportInput} from './jev-direct-report-preparation.ts';
import {DIRECT4_PREPARATION_ID,DIRECT4_WORKER_VERSION,DIRECT4_TOKEN_VERIFIER_VERSION,DIRECT4_PROTOCOL_VERSION,verifyDirect4Preparation,verifyDirect4Protocol,
 direct4RestaurantContract,direct4ReadyContract,type Direct4Protocol} from './jls-direct4-execution.ts';
import {runDirect4WorkerProbe,replaySavedDirect4Sol} from './jls-direct4-probe.ts';

export async function loadDirect4Preparation(client:SupabaseClient,protocolId:string){
 const pr=await client.from('analysis_jls_restaurant_protocols').select('id,body,sha256').eq('id',protocolId).single();
 if(pr.error)throw Error('FORBIDDEN');await verifyDirect4Protocol(pr.data.body,pr.data.sha256);
 await assertEvidence40ActiveUser(client,pr.data.body.authority_user_id);
 const m=await client.from('organization_members').select('role').eq('organization_id',pr.data.body.organization_id)
  .eq('user_id',pr.data.body.authority_user_id).in('role',['owner','admin','manager']).maybeSingle();
 if(m.error||!m.data)throw Error('FORBIDDEN');
 const row=await client.from('analysis_jls_snapshot_preparations').select('body,sha256,protocol_id').eq('id',DIRECT4_PREPARATION_ID)
  .eq('organization_id',pr.data.body.organization_id).single();if(row.error)throw Error('DIRECT4_PREPARATION_MISSING');
 const p={body:row.data.body,sha256:row.data.sha256} as DirectReportPreparation;await verifyDirect4Preparation(p);
 return {protocol:pr.data as Direct4Protocol&{id:string},preparation:p,parent_protocol_id:row.data.protocol_id};
}
export async function processDirect4Run(client:SupabaseClient,run:string,key:string,http:typeof fetch){
 const port=restaurantPort(client),s=await port.load(run);
 const {preparation}=await loadDirect4Preparation(client,s.protocol.id);
 if(!['queued','running'].includes(s.run.status))return {phase:'already_saved',provider_calls:0};
 if(s.run.stage==='prepare_sol')return {phase:'awaiting_authenticated_free_compilation',provider_calls:0};
 if(s.run.stage==='sol'||String(s.run.stage)==='validate_sol'){
  const op=await client.from('analysis_jls_sol_ready_operations').select('id').eq('run_id',run).eq('mode','paid').single();
  if(op.error)throw Error('DIRECT4_SOL_OPERATION_MISSING');
  return processReadySol(solReadyPort(client),op.data.id,key,http,direct4ReadyContract);
 }
 if(s.run.stage!=='luna')throw Error('DIRECT4_STAGE_INVALID');
 return processRestaurant(port,run,{jev:'',openai:key},http,direct4RestaurantContract(preparation));
}
// Runs only an explicit in-memory probe, before any provider secret is loaded.
export async function direct4ActiveProbe(client:SupabaseClient,request:{protocol_id:string;phase:string;nonce:string;operation_id?:string}){
 const at=performance.now(),cpu=process.cpuUsage(),loaded=await loadDirect4Preparation(client,request.protocol_id);
 if(!['luna','prepared','sol','validate_sol','saved_sol'].includes(request.phase)||!/^[-a-zA-Z0-9_]{1,30}$/.test(request.nonce))throw Error('DIRECT4_PROBE_SCOPE_INVALID');
 const [dataset,snapshot]=await Promise.all([
  client.from('analysis_jls_snapshot_preparations').select('*').eq('id',loaded.preparation.body.source_archive.id).single(),
  client.from('analysis_jls_snapshot_preparations').select('*').eq('id',loaded.preparation.body.source_snapshot.id).single()]);
 if(dataset.error||snapshot.error)throw Error('DIRECT4_SOURCE_MISSING');
 await verifyDirectReportSources({dataset:dataset.data,snapshot:snapshot.data,prior_luna_requests:[]} as DirectReportInput);
 let result;
 if(request.phase==='saved_sol'){
  if(!request.operation_id)throw Error('DIRECT4_PROBE_OPERATION_REQUIRED');
  const port=solReadyPort(client),stored=await port.load(request.operation_id);
  if(stored.operation.mode!=='paid'||stored.protocol.id!==loaded.protocol.id||stored.protocol.sha256!==loaded.protocol.sha256)
   throw Error('DIRECT4_PROBE_OPERATION_SCOPE_CHANGED');
  result=await replaySavedDirect4Sol(stored,port);
 }else{
 const fixture=await client.from('analysis_jls_snapshot_preparations').select('body,sha256').eq('protocol_id',loaded.parent_protocol_id)
  .eq('kind','direct4_worker_probe_input_'+request.phase+'_'+loaded.protocol.sha256.slice(0,12)).single();
 if(fixture.error||fixture.data.sha256!==await directHash(fixture.data.body)||fixture.data.body.explicit_technical_mock!==true||
  fixture.data.body.protocol_sha256!==loaded.protocol.sha256||typeof fixture.data.body.input_json!=='string')throw Error('DIRECT4_PROBE_INPUT_CHANGED');
 // Preserve the serialized mock artifact exactly, including sub-micro costs.
 // JSONB and JS encode exponent numbers differently; do not change their hashes.
 result=await runDirect4WorkerProbe(request.phase,JSON.parse(fixture.data.body.input_json));
 }
 const delta=process.cpuUsage(cpu);
 const body={worker_version:DIRECT4_WORKER_VERSION,token_verifier_version:DIRECT4_TOKEN_VERIFIER_VERSION,protocol_id:loaded.protocol.id,protocol_sha256:loaded.protocol.sha256,
  phase:request.phase,passed:result.passed,result,provider_calls:0,explicit_technical_mock:true,
  cpu_ms:(delta.user+delta.system)/1000,wall_ms:performance.now()-at,memory:Deno.memoryUsage(),execution_id:Deno.env.get('SB_EXECUTION_ID')??null,
  runtime:Deno.version,paid_consent_created:false,paid_run_created:false};
 const saved=await client.rpc('save_jls_snapshot_preparation',{p_protocol:loaded.parent_protocol_id,
  p_kind:'direct4_worker_probe_'+request.phase+'_'+request.nonce,p_body:body,p_sha:await directHash(body)});
 if(saved.error)throw Error('DIRECT4_PROBE_SAVE_FAILED');return {archive_id:saved.data,...body};
}
export function direct4ReadView(protocol:{id:string;body:{version:string};sha256:string},run:unknown,tasks:unknown[],artifacts:unknown[],operation:unknown){
 if(![DIRECT4_PROTOCOL_VERSION,'jls-direct4-historical-v1'].includes(protocol.body.version))throw Error('DIRECT4_READ_VERSION_CHANGED');
 return {version:DIRECT4_WORKER_VERSION,protocol,run,tasks,artifacts,sol_operation:operation,new_provider_calls:0,read_only:true,production_enabled:false};
}
