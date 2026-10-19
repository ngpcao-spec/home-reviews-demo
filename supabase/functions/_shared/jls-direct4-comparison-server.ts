// Thin routing only; reuses durable restaurant tasks and the Sol raw-receipt worker.
// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {restaurantPort} from './jls-restaurant-store.ts';
import {solReadyPort} from './jls-sol-ready-store.ts';
import {processRestaurant} from './jls-restaurant-worker.ts';
import {processReadySol} from './jls-sol-ready-worker.ts';
import {assertEvidence40ActiveUser} from './decisions-evidence40-auth.ts';
import {directHash} from './jev-direct-categories.ts';
import {direct4ComparisonContract,direct4ComparisonReadyContract,verifyDirect4Comparison,type Direct4Comparison} from './jls-direct4-comparison.ts';
import {runDirect4ComparisonProbe} from './jls-direct4-comparison-probe.ts';
export async function processDirect4ComparisonRun(client:SupabaseClient,id:string,key:string,http:typeof fetch){
 const port=restaurantPort(client),s=await port.load(id);
 if(!['queued','running'].includes(s.run.status)||s.run.stage==='prepare_sol')return {phase:'already_saved_or_free_compilation',provider_calls:0};
 if(s.run.stage==='sol'||String(s.run.stage)==='validate_sol'){
  const op=await client.from('analysis_jls_sol_ready_operations').select('id').eq('run_id',id).eq('mode','paid').single();
  if(op.error)throw Error('COMPARISON_SOL_OPERATION_MISSING');
  return processReadySol(solReadyPort(client),op.data.id,key,http,direct4ComparisonReadyContract);
 }
 if(s.run.stage!=='luna')throw Error('COMPARISON_STAGE_INVALID');
 return processRestaurant(port,id,{jev:'',openai:key},http,direct4ComparisonContract(s.protocol.body as unknown as Direct4Comparison['body']));
}
export async function direct4ComparisonActiveProbe(client:SupabaseClient,request:{protocol_id:string;phase:string}){
 const p=await client.from('analysis_jls_restaurant_protocols').select('*').eq('id',request.protocol_id).single();if(p.error)throw Error('FORBIDDEN');
 await assertEvidence40ActiveUser(client,p.data.authority_user_id);
 const check=await client.rpc('check_jls_direct4_comparison_sources',{b:p.data.body});if(check.error||check.data!==true)throw Error('COMPARISON_SOURCE_CHANGED');
 await verifyDirect4Comparison(p.data.body,p.data.sha256);
 if(!['luna','sol','validate_sol'].includes(request.phase))throw Error('COMPARISON_PROBE_PHASE_INVALID');
 const q=await client.from('analysis_jls_snapshot_preparations').select('body,sha256').eq('protocol_id',p.data.id).eq('kind','direct4_comparison_probe_input_'+request.phase).single();
 if(q.error||q.data.sha256!==await directHash(q.data.body)||q.data.body.protocol_sha256!==p.data.sha256||q.data.body.explicit_technical_mock!==true)throw Error('COMPARISON_PROBE_INPUT_CHANGED');
 const bytes=Uint8Array.from(atob(q.data.body.input_gzip_base64),(c:string)=>c.charCodeAt(0));
 const input=JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
 if(input.state.protocol.id!==p.data.id||input.state.protocol.sha256!==p.data.sha256)throw Error('COMPARISON_PROBE_SCOPE_CHANGED');
 const at=performance.now(),result=await runDirect4ComparisonProbe(request.phase,input),
  body={...result,phase:request.phase,protocol_sha256:p.data.sha256,explicit_technical_mock:true,wall_ms:performance.now()-at,
   memory:Deno.memoryUsage(),execution_id:Deno.env.get('SB_EXECUTION_ID')??null};
 const saved=await client.rpc('save_jls_snapshot_preparation',{p_protocol:p.data.id,p_kind:'direct4_comparison_deployed_'+request.phase,p_body:body,p_sha:await directHash(body)});
 if(saved.error)throw Error('COMPARISON_PROBE_SAVE_FAILED');return {archive_id:saved.data,...body};
}
