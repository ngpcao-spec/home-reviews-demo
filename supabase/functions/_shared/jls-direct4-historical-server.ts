// Server wiring for the scoped historical direct-four contract. Reuses both
// existing workers, authorization, leases, task claims and Sol receipt store.
// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {restaurantPort} from './jls-restaurant-store.ts';
import {solReadyPort} from './jls-sol-ready-store.ts';
import {processRestaurant} from './jls-restaurant-worker.ts';
import {processReadySol} from './jls-sol-ready-worker.ts';
import {assertEvidence40ActiveUser} from './decisions-evidence40-auth.ts';
import {verifyHistoricalDirect4,historicalDirect4Contract,historicalDirect4ReadyContract,type HistoricalDirect4Protocol} from './jls-direct4-historical.ts';
import type {DirectReportPreparation} from './jev-direct-report-preparation.ts';
import {runHistoricalDirect4Probe} from './jls-direct4-historical-probe.ts';
import {directHash} from './jev-direct-categories.ts';
export async function processHistoricalDirect4Run(client:SupabaseClient,id:string,keys:{jev:string;openai:string},http:typeof fetch){
 const port=restaurantPort(client),s=await port.load(id);
 if(s.run.consent?.consent_source==='technical_qualification_no_spending')return {phase:'technical_mock_excluded_from_paid_route',provider_calls:0};
 if(!['queued','running'].includes(s.run.status))return {phase:'already_saved',provider_calls:0};
 if(['prepare_evidence','prepare_sol'].includes(s.run.stage))return {phase:'awaiting_authenticated_free_compilation',provider_calls:0};
 if(s.run.stage==='sol'||String(s.run.stage)==='validate_sol'){
  const op=await client.from('analysis_jls_sol_ready_operations').select('id').eq('run_id',id).eq('mode','paid').single();
  if(op.error)throw Error('DIRECT4_HISTORICAL_SOL_OPERATION_MISSING');
  return processReadySol(solReadyPort(client),op.data.id,keys.openai,http,historicalDirect4ReadyContract);
 }
 const a=s.artifacts.find(a=>a.kind==='direct4_report_preparation');
 return processRestaurant(port,id,keys,http,historicalDirect4Contract(a?.body as unknown as DirectReportPreparation));
}
export async function historicalDirect4ActiveProbe(client:SupabaseClient,request:{protocol_id:string;phase:string}){
 const q=await client.from('analysis_jls_restaurant_protocols').select('id,body,sha256,organization_id,authority_user_id').eq('id',request.protocol_id).single();
 if(q.error)throw Error('FORBIDDEN');
 await assertEvidence40ActiveUser(client,q.data.authority_user_id);
 const m=await client.from('organization_members').select('role').eq('organization_id',q.data.organization_id).eq('user_id',q.data.authority_user_id).in('role',['owner','admin','manager']).maybeSingle();
 if(m.error||!m.data)throw Error('FORBIDDEN');
 await verifyHistoricalDirect4(q.data.body as HistoricalDirect4Protocol['body'],q.data.sha256);
 if(!['jev','luna','sol','validate_sol'].includes(request.phase))throw Error('DIRECT4_HISTORICAL_PROBE_PHASE_INVALID');
 const row=await client.from('analysis_jls_snapshot_preparations').select('body,sha256').eq('protocol_id',q.data.id)
  .eq('kind','historical_direct4_probe_input_'+request.phase).single();
 if(row.error||row.data.sha256!==await directHash(row.data.body)||row.data.body.explicit_technical_mock!==true||
  row.data.body.protocol_sha256!==q.data.sha256)throw Error('DIRECT4_HISTORICAL_PROBE_INPUT_CHANGED');
 let input=row.data.body.input_json;
 if(typeof row.data.body.input_gzip_base64==='string'){
  const bytes=Uint8Array.from(atob(row.data.body.input_gzip_base64),(c:string)=>c.charCodeAt(0));
  input=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
 }
 if(typeof input!=='string')throw Error('DIRECT4_HISTORICAL_PROBE_INPUT_CHANGED');
 const at=performance.now(),result=await runHistoricalDirect4Probe(request.phase,JSON.parse(input));
 const b={version:q.data.body.version,phase:request.phase,protocol_sha256:q.data.sha256,result,provider_calls:0,
  explicit_technical_mock:true,wall_ms:performance.now()-at,memory:Deno.memoryUsage(),execution_id:Deno.env.get('SB_EXECUTION_ID')??null};
 const saved=await client.rpc('save_jls_snapshot_preparation',{p_protocol:q.data.id,p_kind:'historical_direct4_deployed_'+request.phase,p_body:b,p_sha:await directHash(b)});
 if(saved.error)throw Error('DIRECT4_HISTORICAL_PROBE_SAVE_FAILED');return {archive_id:saved.data,...b};
}
