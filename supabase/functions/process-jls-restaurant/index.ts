import {SHORT_FROZEN_DIRECT4} from '../_shared/jev-direct-short-config.ts';
import {restaurantCpuProbe} from "../_shared/jls-restaurant-cpu-probe.ts";
import {processTargeted9} from "../_shared/jev-targeted9-worker.ts";
import {targeted9Port} from "../_shared/jev-targeted9-store.ts";
import {processChill80} from "../_shared/jev-chill80-worker.ts";
import {chill80Port} from "../_shared/jev-chill80-store.ts";
import {solReadyProbe} from "../_shared/jls-sol-ready-probe.ts";
import {solReadyPort} from "../_shared/jls-sol-ready-store.ts";
import {processReadySol} from "../_shared/jls-sol-ready-worker.ts";
import {contractV2Port} from "../_shared/jls-contract-v2-store.ts";
import {processContractV2} from "../_shared/jls-contract-v2-worker.ts";
import {contractV2Probe} from "../_shared/jls-contract-v2-probe.ts";
import {processSnapshotRun,snapshotNativeProbe} from "../_shared/jls-snapshot-v2-server.ts";
// deno-lint-ignore no-import-prefix
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {json} from "../_shared/cors.ts";
import {restaurantPort} from "../_shared/jls-restaurant-store.ts";
import {processRestaurant} from "../_shared/jls-restaurant-worker.ts";
import {processDirect4Run,direct4ActiveProbe} from "../_shared/jls-direct4-server.ts";
import {DIRECT4_PROTOCOL_VERSION} from "../_shared/jls-direct4-execution.ts";
import {direct4ReadyContract} from "../_shared/jls-direct4-execution.ts";
import {inspectDirect4Continuation,probeDirect4Continuation} from "../_shared/jls-direct4-continuation.ts";
import {HISTORICAL_DIRECT4,FROZEN_CORPUS_DIRECT4} from "../_shared/jls-direct4-historical.ts";
import {processHistoricalDirect4Run,historicalDirect4ActiveProbe} from "../_shared/jls-direct4-historical-server.ts";
import {DIRECT4_COMPARISON} from '../_shared/jls-direct4-comparison.ts';
import {processDirect4ComparisonRun,direct4ComparisonActiveProbe} from '../_shared/jls-direct4-comparison-server.ts';
import {persistRestaurantReceiptsOnly,restaurantPersistenceProbe} from '../_shared/jls-task-persistence-server.ts';
import {restaurantSqlQualification} from '../_shared/jls-sql-qualification.ts';
import {LUNA_DIRECT4_COMPARE} from '../_shared/luna-direct4-comparison.ts';
import {processLunaDirect4Comparison,probeLunaDirect4Comparison} from '../_shared/luna-direct4-comparison-server.ts';
import {SHORT_COMPARE} from '../_shared/direct4-short-comparison.ts';
import {processShortComparison,probeShortComparison} from '../_shared/direct4-short-comparison-server.ts';
import {DIRECT4_CANDIDATES} from '../_shared/jls-direct4-candidates.ts';
import {probeCandidateOperation,candidateExecutionContract} from '../_shared/jls-direct4-candidates-server.ts';
import {PARALLEL_REPORT} from '../_shared/parallel-report.ts';
import {processParallelReport} from '../_shared/parallel-report-server.ts';
import {parallelProtocol,type ParallelCurrent,type ParallelHistory} from '../_shared/parallel-report.ts';
import {boundedParallelFixture,boundedParallelJevProbe,boundedParallelSolProbe} from '../_shared/parallel-report-probe.ts';
import {compileParallelSol} from '../_shared/parallel-report.ts';
import {COMPACT_SOL_WIRE} from '../_shared/parallel-sol-wire.ts';
import {directHash} from '../_shared/jev-direct-categories.ts';

declare const EdgeRuntime:{waitUntil(p:Promise<unknown>):void};
Deno.serve(async r=>{
 if(r.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);
 const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
 const auth=await admin.rpc("verify_review_scheduler_token",{p_token:r.headers.get("x-home-reviews-scheduler")??""});
 if(auth.error||auth.data!==true)return json({error:"UNAUTHORIZED"},401);
 const payload=await r.clone().json().catch(()=>null);
 if(payload?.mode==='parallel_report_capability')return json({version:PARALLEL_REPORT,worker_revision:'parallel-compact-sol-v1',sol_wire_version:COMPACT_SOL_WIRE,stages:['jev','prepare_evidence','sol','validate_sol'],max_luna_calls:0,max_sol_calls:1,provider_calls:0});
 if(payload?.mode==='parallel_report_probe'){
  // Deployed-path rehearsal with explicit injected suppliers, no durable run,
  // authorization, reservation or database write. Returns before provider keys.
  try{
   const at=performance.now();
   if(payload.phase==='sol'){
    const a=await admin.from('analysis_jls_snapshot_preparations').select('body,sha256').eq('id',payload.prepared_archive_id).eq('kind','parallel_bounded_mock_ready').single();
    if(a.error||await directHash(a.data.body)!==a.data.sha256||a.data.body.explicit_technical_mock!==true)throw Error('PROBE_SOURCE_CHANGED');
    const result=await boundedParallelSolProbe(a.data.body.protocol,a.data.body.ready);
    return json({version:PARALLEL_REPORT,phase:'sol',explicit_technical_mock:true,provider_calls:0,new_runs:0,new_consents:0,...result,wall_ms:performance.now()-at,memory:Deno.memoryUsage()});
   }
   if(!['jev','compile'].includes(payload.phase))throw Error('BOUNDED_PROBE_PHASE_REQUIRED');
   const q=await admin.from('historical_establishment_reports').select('*').eq('id',payload.report_id).single();if(q.error)throw Error('FORBIDDEN');
   const h=await admin.from('historical_report_runs').select('*').eq('generation_id',q.data.generation_id).eq('organization_id',q.data.organization_id).eq('establishment_id',q.data.establishment_id).eq('status','completed').single();if(h.error)throw Error('PARALLEL_CORPUS_UNAVAILABLE');
   const p=await parallelProtocol(q.data as ParallelCurrent,h.data as ParallelHistory,h.data.requested_by,'a'.repeat(40));
   const source=await admin.from('analysis_jls_snapshot_preparations').select('organization_id,protocol_id,establishment_id:body->>establishment_id,dataset:body->source_input->dataset').eq('id',payload.source_archive_id).single();
   const dataset=source.data?.dataset as unknown as {body:{configuration_sha256:string;reviews:{review_id:string;analysis_text_sha256:string;raw_response_text:string}[]}}|null;
   if(source.error||!dataset?.body||!Array.isArray(dataset.body.reviews)||source.data.organization_id!==p.body.organization_id||source.data.establishment_id!==p.body.establishment_id||dataset.body.configuration_sha256!==p.body.classification_configuration_sha256)throw Error('PROBE_SOURCE_CHANGED');
   const protocol={...p,id:crypto.randomUUID()},state=await boundedParallelFixture(protocol,dataset.body.reviews);
   if(payload.phase==='jev')return json({version:PARALLEL_REPORT,phase:'jev',explicit_technical_mock:true,provider_calls:0,new_runs:0,new_consents:0,...await boundedParallelJevProbe(state,dataset.body.reviews),wall_ms:performance.now()-at,memory:Deno.memoryUsage()});
   const ready=await compileParallelSol(state),body={protocol,ready,explicit_technical_mock:true};
   const saved=await admin.rpc('save_jls_snapshot_preparation',{p_protocol:source.data.protocol_id,p_kind:'parallel_bounded_mock_ready',p_body:body,p_sha:await directHash(body)});if(saved.error)throw Error('PROBE_PERSISTENCE_FAILED');
   return json({version:PARALLEL_REPORT,phase:'compile',explicit_technical_mock:true,provider_calls:0,new_runs:0,new_consents:0,prepared_archive_id:saved.data,measurement:ready.body.measurement,wall_ms:performance.now()-at,memory:Deno.memoryUsage()});
  }catch(e){return json({error:e instanceof Error?e.message:'PARALLEL_PROBE_FAILED',provider_calls:0},409);}
 }
 if(payload?.mode==='direct4_candidates_probe'){
  try{return json(await probeCandidateOperation(admin,payload.operation_id));}
  catch(e){return json({error:e instanceof Error?e.message:'DIRECT_CANDIDATES_PROBE_FAILED',provider_calls:0},409);}
 }
 if(payload?.mode==='compact_comparison_execute'){
  // Explicit scheduler-authenticated wake for one previously authorized job.
  // The shared SQL claim reserves its sole Sol attempt before transport.
  const port=solReadyPort(admin),s=await port.load(payload.operation_id);
  const p=s.protocol.body as unknown as {version:string;configuration:{sol_wire_version?:string}};
  if(s.operation.mode!=='paid'||p.version!==DIRECT4_CANDIDATES||p.configuration.sol_wire_version!==COMPACT_SOL_WIRE)return json({error:'COMPACT_COMPARISON_SCOPE_REQUIRED'},409);
  EdgeRuntime.waitUntil(processReadySol(port,s.operation.id,Deno.env.get('OPENAI_API_KEY')??'',fetch,candidateExecutionContract)
   .catch(()=>console.error('COMPACT_COMPARISON_STOPPED_NO_RETRY')));
  return json({accepted_background:true,operation_id:s.operation.id,automatic_retry:false},202);
 }
 if(payload?.mode==='short_common_comparison_probe'){
  try{return json(await probeShortComparison(admin,payload.protocol_id));}
  catch(e){return json({error:e instanceof Error?e.message:'SHORT_COMPARISON_PROBE_FAILED',provider_calls:0},409);}
 }
 if(payload?.mode==='luna_direct4_comparison_probe'){
  try{return json(await probeLunaDirect4Comparison(admin,payload.protocol_id));}
  catch(e){return json({error:e instanceof Error?e.message:'LUNA_DIRECT4_PROBE_FAILED',provider_calls:0},409);}
 }
 if(payload?.mode==='restaurant_sql_qualification'){
  // Real PostgREST RPCs and explicit mocks only. Returns before provider keys.
  try{return json(await restaurantSqlQualification(admin,payload));}
  catch(e){return json({error:e instanceof Error?e.message:'JLS_SQL_QUALIFICATION_FAILED',provider_calls:0},409);}
 }
 if(payload?.mode==='restaurant_persistence_only'||payload?.mode==='restaurant_persistence_probe'){
  // Save/confirm existing responses only. Exits before loading any provider key.
  try{return json(payload.mode==='restaurant_persistence_only'?
   await persistRestaurantReceiptsOnly(admin,payload.run_id):await restaurantPersistenceProbe(admin,payload));}
  catch(e){return json({error:e instanceof Error?e.message:'JLS_PERSISTENCE_FAILED',provider_calls:0,new_attempts:0},409);}
 }
 if(payload?.mode==='direct4_comparison_probe'){
  // Authenticated free qualification; exits before loading any provider key.
  try{return json(await direct4ComparisonActiveProbe(admin,payload));}
  catch(e){return json({error:e instanceof Error?e.message:'COMPARISON_PROBE_FAILED',provider_calls:0},409);}
 }
 if(payload?.mode==='direct4_historical_probe'){
  // Actual frozen sources and version routing; injected mock suppliers only.
  try{return json(await historicalDirect4ActiveProbe(admin,payload));}
  catch(e){return json({error:e instanceof Error?e.message:'DIRECT4_HISTORICAL_PROBE_FAILED',provider_calls:0},409);}
 }
 if(payload?.mode==='direct4_continuation_inspect'||payload?.mode==='direct4_continuation_probe'){
  // Inspection and persisted technical mocks exit before provider secrets.
  try{return json(payload.mode==='direct4_continuation_inspect'?
   await inspectDirect4Continuation(admin,payload.operation_id):await probeDirect4Continuation(admin,payload.operation_id));}
  catch(e){return json({error:e instanceof Error?e.message:'DIRECT4_CONTINUATION_FAILED',provider_calls:0},409);}
 }
 if(payload?.mode==='direct4_probe'){
  // Read sources + injected mocks only; no provider key, authorization or paid queue.
  try{return json(await direct4ActiveProbe(admin,payload));}
  catch(e){return json({error:e instanceof Error?e.message:'DIRECT4_PROBE_FAILED',provider_calls:0},409);}
 }
 if(payload?.mode==="jev_chill80"){
  EdgeRuntime.waitUntil(processChill80(chill80Port(admin),payload.execution_id,Deno.env.get("TYPESAFE_API_KEY")??"",fetch)
   .catch(()=>console.error("CHILL80_STOPPED_NO_RETRY")));
  return json({accepted_background:true,scope:"jev_chill80",automatic_retry:false},202);
 }
 if(payload?.mode==="jev_targeted9"){
  EdgeRuntime.waitUntil(processTargeted9(targeted9Port(admin),payload.execution_id,Deno.env.get("TYPESAFE_API_KEY")??"",fetch)
   .catch(()=>console.error("TARGETED9_STOPPED_NO_RETRY")));
  return json({accepted_background:true,scope:"jev_targeted9",automatic_retry:false},202);
 }
 if(payload?.mode==="snapshot_v2_probe"){
  // Ends before any supplier key is loaded; injected mock transport only.
  EdgeRuntime.waitUntil(snapshotNativeProbe(admin,payload).catch(e=>console.error("JLS_SNAPSHOT_PROBE_FAILED",e instanceof Error?e.message:"UNKNOWN")));
  return json({accepted_free_probe:true,provider_calls:0},202);
 }
 if(payload?.mode==="sol_ready_probe"){
  EdgeRuntime.waitUntil(solReadyProbe(admin,payload.operation_id,payload.variant??"normal").catch(e=>console.error("JLS_READY_PROBE_FAILED",e instanceof Error?e.message:"UNKNOWN")));
  return json({accepted_free_probe:true,provider_calls:0},202);
 }
 if(payload?.mode==="cpu_probe"){
  // This route never loads provider keys, claims a task or authorizes a run.
  EdgeRuntime.waitUntil(restaurantCpuProbe(admin,payload).catch(e=>{console.error("JLS_CPU_PROBE_FAILED",e instanceof Error?e.message:"UNKNOWN");}));
  return json({accepted_free_probe:true,provider_calls:0,nonce:payload.nonce},202);
 }
 if(payload?.mode==="contract_v2_operation"){
  const op=await admin.from("analysis_jls_contract_v2_operations").select("mode").eq("id",payload.operation_id).single();
  if(op.error)return json({error:"FORBIDDEN"},403);
  // Mock branch exits before loading any provider secret or native transport.
  EdgeRuntime.waitUntil((op.data.mode==="mock"?contractV2Probe(admin,payload.operation_id):
   processContractV2(contractV2Port(admin),payload.operation_id,Deno.env.get("OPENAI_API_KEY")??"",fetch))
   .catch(e=>console.error("JLS_CONTRACT_V2_FAILED",e instanceof Error?e.message:"UNKNOWN")));
  return json({accepted_background:true,technical_mock:op.data.mode==="mock"},202);
 }
 const continuations=await admin.from('analysis_jls_direct4_continuations').select('id').eq('mode','paid')
  .in('status',['queued','received','dispatched','validating']).limit(1);
 if(continuations.error)return json({error:'JLS_DATABASE_FAILED'},409);
 const {data:runs,error}=await admin.from("analysis_jls_restaurant_runs").select("id").in("status",["queued","running"])
  .neq('consent->>consent_source','technical_qualification_no_spending');
 if(error)return json({error:"JLS_DATABASE_FAILED"},409);
 const next=await admin.from("analysis_jls_contract_v2_operations").select("id").eq("mode","paid").in("status",["queued","received","dispatched","validating"]).limit(1);
 if(next.error)return json({error:"JLS_DATABASE_FAILED"},409);
 if(!runs?.length&&!next.data?.length&&!continuations.data?.length)return json({claimed:0,new_paid_calls:0});
 const work=(async()=>{
  for(const op of continuations.data??[])await processReadySol(solReadyPort(admin,true),op.id,Deno.env.get('OPENAI_API_KEY')??'',fetch,direct4ReadyContract);
  for(const op of next.data??[])await processContractV2(contractV2Port(admin),op.id,Deno.env.get("OPENAI_API_KEY")??"",fetch);
  for(const run of runs??[])try{
  const p=await admin.from("analysis_jls_restaurant_runs").select("protocol_id").eq("id",run.id).single();
  const v=p.data?await admin.from("analysis_jls_restaurant_protocols").select("body->>version").eq("id",p.data.protocol_id).single():null;
  if(v?.data?.version===PARALLEL_REPORT){
   await processParallelReport(admin,run.id,{jev:Deno.env.get('TYPESAFE_API_KEY')??'',openai:Deno.env.get('OPENAI_API_KEY')??''},fetch);continue;
  }
  if(v?.data?.version===DIRECT4_CANDIDATES){
   const op=await admin.from('analysis_jls_sol_ready_operations').select('id').eq('run_id',run.id).eq('mode','paid').single();
   if(op.error)throw Error('DIRECT_CANDIDATES_OPERATION_MISSING');
   await processReadySol(solReadyPort(admin),op.data.id,Deno.env.get('OPENAI_API_KEY')??'',fetch,candidateExecutionContract);continue;
  }
  if(v?.data?.version===SHORT_COMPARE){
   await processShortComparison(admin,run.id,{jev:Deno.env.get('TYPESAFE_API_KEY')??'',openai:Deno.env.get('OPENAI_API_KEY')??''},fetch);continue;
  }
  if(v?.data?.version===LUNA_DIRECT4_COMPARE){
   await processLunaDirect4Comparison(admin,run.id,Deno.env.get('OPENAI_API_KEY')??'',fetch);continue;
  }
  if(v?.data?.version===DIRECT4_COMPARISON){
   await processDirect4ComparisonRun(admin,run.id,Deno.env.get('OPENAI_API_KEY')??'',fetch);continue;
  }
  if([HISTORICAL_DIRECT4,FROZEN_CORPUS_DIRECT4,SHORT_FROZEN_DIRECT4].includes(v?.data?.version??'')){
   await processHistoricalDirect4Run(admin,run.id,{jev:Deno.env.get('TYPESAFE_API_KEY')??'',openai:Deno.env.get('OPENAI_API_KEY')??''},fetch);continue;
  }
  if(v?.data?.version===DIRECT4_PROTOCOL_VERSION){
   await processDirect4Run(admin,run.id,Deno.env.get('OPENAI_API_KEY')??'',fetch);continue;
  }
  if(v?.data?.version==="jls-historical-snapshot-v2-vi-v1"){
   await processSnapshotRun(admin,run.id,{jev:Deno.env.get("TYPESAFE_API_KEY")??"",openai:Deno.env.get("OPENAI_API_KEY")??""},fetch);continue;
  }
  const ready=await admin.from("analysis_jls_sol_ready_operations").select("id").eq("run_id",run.id).eq("mode","paid").maybeSingle();
  if(ready.error)continue;
  if(ready.data){await processReadySol(solReadyPort(admin),ready.data.id,Deno.env.get("OPENAI_API_KEY")??"",fetch);continue;}
  await processRestaurant(restaurantPort(admin),run.id,{jev:Deno.env.get("TYPESAFE_API_KEY")??"",openai:Deno.env.get("OPENAI_API_KEY")??""},fetch);
 }catch{/* Claimed attempts are never reset or retried. */}})();
 EdgeRuntime.waitUntil(work);return json({accepted_background:true},202);
});
