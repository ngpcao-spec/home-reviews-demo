// The real Supabase service-role/PostgREST port, with injected suppliers only.
// No native supplier fetch, API key or spending authorization is available here.
// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {restaurantPort} from './jls-restaurant-store.ts';
import {processRestaurant,restaurantAttempt,type RestaurantExecutionContract} from './jls-restaurant-worker.ts';
import {historicalDirect4Contract,historicalDirect4ReadyContract} from './jls-direct4-historical.ts';
import {historicalMockHttp} from './jls-direct4-historical-probe.ts';
import {processReadySol} from './jls-sol-ready-worker.ts';
import {solReadyPort} from './jls-sol-ready-store.ts';
import {direct4MockSolResponse} from './jls-direct4-probe.ts';
import type {Direct4Ready} from './jls-direct4-execution.ts';
import type {DirectReportPreparation} from './jev-direct-report-preparation.ts';
import {directHash} from './jev-direct-categories.ts';
import {assertEvidence40ActiveUser} from './decisions-evidence40-auth.ts';
import {PARALLEL_REPORT,parallelExecutionContract} from './parallel-report.ts';
export async function restaurantSqlQualification(admin:SupabaseClient,input:{qualification_id:string;phase:string}){
 const q=await admin.from('analysis_jls_sql_qualifications').select('*').eq('id',input.qualification_id).single();
 if(q.error||Date.parse(q.data.expires_at)<=Date.now())throw Error('JLS_SQL_QUALIFICATION_INVALID');
 const p=await admin.from('analysis_jls_restaurant_protocols').select('authority_user_id').eq('id',q.data.protocol_id).single();
 if(p.error)throw Error('FORBIDDEN');await assertEvidence40ActiveUser(admin,p.data.authority_user_id);
 const metrics:{rpc:string;wall_ms:number;ok:boolean;error_code:string|null}[]=[];
 const measured=new Proxy(admin,{get(target,key){
  if(key==='rpc')return async(name:string,args:Record<string,unknown>)=>{
   const at=performance.now(),r=await target.rpc(name,args);
   metrics.push({rpc:name,wall_ms:performance.now()-at,ok:!r.error,error_code:r.error?.code??null});return r;
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const port=restaurantPort(measured),state=await port.load(q.data.run_id),calls:string[]=[];
 if(state.run.consent?.consent_source!=='technical_qualification_no_spending')throw Error('JLS_SQL_QUALIFICATION_NOT_MOCK');
 const prep=state.artifacts.find(a=>a.kind==='direct4_report_preparation')?.body as unknown as DirectReportPreparation|undefined;
 const parallel=state.protocol.body.version===PARALLEL_REPORT;
 const contract:RestaurantExecutionContract={...(parallel?parallelExecutionContract:historicalDirect4Contract(prep)),technicalMockTransport:true};
 const mock:typeof fetch=parallel?()=>{calls.push('EXPLICIT_TECHNICAL_MOCK_JEV');return Promise.resolve(new Response(JSON.stringify({model:'jev-1.13.0',usage:{input_tokens:1,output_tokens:1,total_tokens:2},answers:Object.fromEntries(['service','price','quality','ambiance'].map(k=>[k,{type:'choice',choice:'positive'}]))})));}:historicalMockHttp(state,calls),key='EXPLICIT_MOCK_NO_PROVIDER';
 let lock_observation:unknown=null;
 if(input.phase==='bind_evidence'){
  const fixture=await measured.from('analysis_jls_snapshot_preparations').select('body,sha256')
   .eq('protocol_id',q.data.protocol_id).eq('kind','sql_fixture_evidence_'+q.data.id).single();
  if(fixture.error)throw Error('JLS_SQL_EVIDENCE_FIXTURE_MISSING');
  const b=fixture.data.body;
  if(b.dataset?.id!==state.run.id||b.protocol_sha256!==q.data.protocol_sha256)throw Error('JLS_SQL_EVIDENCE_FIXTURE_CHANGED');
  const cert=await measured.rpc('save_jls_direct4_partial_evidence_certificate',{p_run:state.run.id,p_body:b,p_sha:fixture.data.sha256});
  if(cert.error)throw Error('JLS_SQL_CERTIFICATE_RPC_FAILED_'+cert.error.code);
  const bound=await measured.rpc('bind_jls_direct4_historical_evidence',{p_run:state.run.id,p_body:b,p_sha:fixture.data.sha256});
  if(bound.error||bound.data!==true)throw Error('JLS_SQL_BIND_RPC_FAILED_'+(bound.error?.code??'FALSE'));
 }else if(input.phase==='bind_sol'){
  const fixture=await measured.from('analysis_jls_snapshot_preparations').select('body,sha256')
   .eq('protocol_id',q.data.protocol_id).eq('kind','sql_fixture_sol_'+q.data.id).single();
  if(fixture.error||fixture.data.body.source_run_id!==state.run.id)throw Error('JLS_SQL_SOL_FIXTURE_MISSING');
  const saved=await measured.rpc('save_jls_direct4_ready',{p_body:fixture.data.body,p_sha:fixture.data.sha256});
  if(saved.error)throw Error('JLS_SQL_SOL_BIND_FAILED_'+saved.error.code);
 }else if(input.phase==='lock_contention'){
  const hold=measured.rpc('hold_jls_sql_qualification_lock',{p_qualification:q.data.id});
  // Supabase RPC builders are lazy; start the first connection before rivals.
  const holding=Promise.resolve(hold);
  await new Promise(r=>setTimeout(r,250));
  const workers=[crypto.randomUUID(),crypto.randomUUID()];
  const rivals=Promise.all(workers.map(w=>port.tick(state.run.id,w)));
  await new Promise(r=>setTimeout(r,500));
  const snapshot=await measured.rpc('inspect_jls_sql_qualification_locks',{p_qualification:q.data.id});
  const [held,won]=await Promise.all([holding,rivals]);
  if(held.error||snapshot.error||won.filter(Boolean).length!==1)throw Error('JLS_SQL_LOCK_TEST_FAILED');
  lock_observation={holder:held.data,snapshot:snapshot.data,winning_workers:won.filter(Boolean).length};
  await port.release(state.run.id,workers[won.findIndex(Boolean)],null);
 }else if(input.phase==='lost_response'){
  const lost:typeof fetch=()=>{calls.push('EXPLICIT_MOCK_LOST_RESPONSE');return Promise.reject(Error('EXPLICIT_MOCK_RESPONSE_LOST'));};
  await processRestaurant(port,state.run.id,{jev:key,openai:key},lost,contract);
 }else if(input.phase==='cycle'||input.phase==='concurrent_wakes'){
  await Promise.all(Array.from({length:input.phase==='cycle'?1:4},()=>processRestaurant(port,state.run.id,{jev:key,openai:key},mock,contract)));
 }else if(input.phase==='parallel_claims'||input.phase==='receipt_resume'){
  const worker=crypto.randomUUID();
  if(await port.tick(state.run.id,worker)){
   const tasks=(await Promise.all(Array.from({length:8},()=>port.claim(state.run.id,worker)))).filter(t=>t!==null);
   const outcomes=await Promise.all(tasks.map(async t=>{
    const out=await restaurantAttempt(t,state,key,mock,contract,()=>port.beginProvider!(t));
    if(!await port.retainReceipt!(state,t,out))throw Error('JLS_SQL_MOCK_RECEIPT_FAILED');return t.id;
   }));
   if(input.phase==='parallel_claims')await Promise.all(outcomes.map(id=>port.finishReceipt!(id)));
   // receipt_resume deliberately leaves running tasks + known receipts. A
   // subsequent cycle flushes persistence before its lost-attempt guard.
   await port.release(state.run.id,worker,null);
  }
 }else if(input.phase==='sol'||input.phase==='validate_sol'){
  const op=await measured.from('analysis_jls_sol_ready_operations').select('id,mode').eq('run_id',state.run.id).single();
  if(op.error||op.data.mode!=='mock')throw Error('JLS_SQL_MOCK_SOL_REQUIRED');
  const sp=solReadyPort(measured),s=await sp.load(op.data.id);
  const http:typeof fetch=async(url,options)=>{
   if(String(url)!=='https://api.openai.com/v1/responses'||options?.body!==s.ready.body.request_json)throw Error('JLS_SQL_MOCK_WIRE_CHANGED');
   calls.push('EXPLICIT_MOCK_SOL');return new Response(JSON.stringify(direct4MockSolResponse(s.ready as unknown as Direct4Ready)));
  };
  await processReadySol(sp,op.data.id,key,http,historicalDirect4ReadyContract);
 }else throw Error('JLS_SQL_QUALIFICATION_PHASE_INVALID');
 const after=await port.load(state.run.id);
 const body={version:'jls-sql-rpc-qualification-v1',qualification_id:q.data.id,run_id:state.run.id,phase:input.phase,
  protocol_sha256:q.data.protocol_sha256,provider_calls:0,explicit_technical_mock:true,
  mock_http_invocations:calls.length,metrics,lock_observation,run_status:after.run.status,stage:after.run.stage,
  completed_tasks:after.tasks.filter(t=>t.status==='completed').length,request_count:after.tasks.reduce((s,t)=>s+t.request_count,0),
  execution_id:Deno.env.get('SB_EXECUTION_ID')??null};
 const saved=await admin.rpc('save_jls_snapshot_preparation',{p_protocol:q.data.protocol_id,
  p_kind:'sql_qualification_'+q.data.nonce+'_'+input.phase+'_'+body.request_count+'_'+body.stage,p_body:body,p_sha:await directHash(body)});
 if(saved.error)throw Error('JLS_SQL_QUALIFICATION_METRIC_SAVE_FAILED');return {archive_id:saved.data,...body};
}
