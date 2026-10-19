// Explicit in-memory test port only, reusing the historical queue/receipt mocks.
import {snapshotMockPort,snapshotReadyMock} from './jls-snapshot-v2-probe.ts';
import {processRestaurant,type RestaurantState} from './jls-restaurant-worker.ts';
import {processReadySol,type ReadyState,type ReadyPort} from './jls-sol-ready-worker.ts';
import {DIRECT_CATEGORY_KEYS,directHash} from './jev-direct-categories.ts';
import {analysisTextSha256} from './analysis-text.ts';
import {DIRECT_REPORT_FORMAT,type DirectReportPreparation} from './jev-direct-report-preparation.ts';
import {direct4RestaurantContract,direct4ReadyContract,compileDirect4Ready,DIRECT4_TOKEN_VERIFIER_VERSION,type Direct4Protocol,type Direct4Ready} from './jls-direct4-execution.ts';

export async function direct4MockState(p:DirectReportPreparation,protocol:Direct4Protocol&{id:string}):Promise<RestaurantState>{
 const manifest={luna_groups:p.body.luna_groups,question_count:32,source_sha256:p.body.source_snapshot.sha256};
 return {protocol:protocol as unknown as RestaurantState['protocol'],run:{id:'EXPLICIT_MOCK_NOT_PAID_RUN',stage:'luna',status:'queued'},
  artifacts:[{kind:'evidence_plan',body:manifest,sha256:await directHash(manifest)}],
  tasks:p.body.luna_groups.map((g,n)=>({id:'EXPLICIT_MOCK_TASK_'+n,run_id:'EXPLICIT_MOCK_NOT_PAID_RUN',organization_id:p.body.organization_id,
   phase:'luna',review_id:g.review_id,request:g.payload,request_sha256:g.request_sha256,identity:null,status:'pending',request_count:0,worker:'',cache_id:null}))};
}
export function direct4MockReport(a:Direct4Ready){
 const accepted=a.body.sol.draft.packet.evidence;
 return {format_version:DIRECT_REPORT_FORMAT,statistics_sha256:a.body.preparation.body.statistics_sha256,report:{
  categories:DIRECT_CATEGORY_KEYS.map(category=>({category,text:'MÔ PHỎNG KỸ THUẬT — không phải báo cáo thực tế.',
   evidence_ids:[accepted.find(e=>e.category===category)!.evidence_id]})),positive_aspects:[],negative_aspects:[],
  conclusion:{text:'MÔ PHỎNG KỸ THUẬT.',evidence_ids:[accepted[0].evidence_id]},recommendations:[]}};
}
export function direct4MockSolResponse(a:Direct4Ready){return {id:'EXPLICIT_MOCK_NOT_PROVIDER',model:'gpt-6.1-sol',status:'completed',
 usage:{input_tokens:1,output_tokens:1,total_tokens:2},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(direct4MockReport(a))}]}]};}
export function direct4MockReady(a:Direct4Ready,protocol:Direct4Protocol&{id:string}):ReadyState{return {
 protocol:protocol as unknown as ReadyState['protocol'],ready:a as unknown as ReadyState['ready'],operation:{id:'EXPLICIT_MOCK_OPERATION',
 organization_id:protocol.body.organization_id,mode:'mock',run_id:null,phase:'sol',status:'queued',request_count:0,worker:null,receipt:null,receipt_sha256:null,result:null}};}
export function direct4SolMockPort(state:ReadyState){
 const f=snapshotReadyMock(state),a=state.ready as unknown as Direct4Ready;
 const http:typeof fetch=async(url,options)=>{if(String(url)!=='https://api.openai.com/v1/responses'||options?.body!==a.body.request_json||
  f.state.operation.request_count!==1||f.state.operation.status!=='dispatched')throw Error('DIRECT4_MOCK_NOT_RESERVED');
  f.calls.push(String(url));return new Response(JSON.stringify(direct4MockSolResponse(a)));};
 return {...f,http};
}
// Actual persisted request + actual saved Luna verdicts. Only the operation,
// reservation, receipt and report below are explicit in-memory technical mocks.
export async function replaySavedDirect4Sol(source:ReadyState,checks?:Pick<ReadyPort,'active'|'compatible'>){
 if(source.operation.request_count!==0||source.operation.receipt!==null||source.operation.result!==null)
  throw Error('DIRECT4_SAVED_PROBE_REQUIRES_UNSENT_SOL');
 const original=await directHash(source),a=source.ready as unknown as Direct4Ready;
 const state=structuredClone(source);
 state.operation={...state.operation,id:'EXPLICIT_SAVED_SOL_MOCK',mode:'mock',run_id:null,status:'queued',phase:'sol',worker:null};
 const f=direct4SolMockPort(state);
 if(checks){f.port.active=()=>checks.active(source);f.port.compatible=()=>checks.compatible(source);}
 const sent=await processReadySol(f.port,f.state.operation.id,'EXPLICIT_MOCK',f.http,direct4ReadyContract);
 if(sent.error_code||sent.phase!=='raw_receipt_saved'||f.calls.length!==1)throw Error(sent.error_code??'DIRECT4_SAVED_PROBE_SEND_FAILED');
 const saved=await processReadySol(f.port,f.state.operation.id,'EXPLICIT_MOCK',f.http,direct4ReadyContract);
 if(saved.error_code||saved.phase!=='validation_saved'||f.state.operation.status!=='completed'||!f.state.operation.result?.validated_report)
  throw Error(saved.error_code??'DIRECT4_SAVED_PROBE_VALIDATION_FAILED');
 await processReadySol(f.port,f.state.operation.id,'EXPLICIT_MOCK',f.http,direct4ReadyContract);
 if(f.calls.length!==1||await directHash(source)!==original)throw Error('DIRECT4_SAVED_PROBE_MUTATION_OR_RETRY');
 return {passed:true,token_verifier_version:DIRECT4_TOKEN_VERIFIER_VERSION,explicit_technical_mock:true,provider_calls:0,
  mock_sol_calls:f.calls.length,real_luna_results_reused:a.body.results.length,source_operation_id:source.operation.id,
  source_ready_sha256:source.ready.sha256,request_sha256:a.body.request_sha256,request_raw_sha256:a.body.request_raw_sha256,
  token_certificate_sha256:a.body.token_certificate_sha256,measurement:a.body.measurement,sufficiency:a.body.sol.gate,
  tokenizer_misses:[sent.tokenizer_misses,saved.tokenizer_misses],mock_receipt_saved:true,mock_result_readable:true,
  source_state_unchanged:true,real_reservation_performed:false};
}
export async function prepareDirect4WorkerMocks(p:DirectReportPreparation,protocol:Direct4Protocol&{id:string}){
 const f=snapshotMockPort(await direct4MockState(p,protocol)),contract=direct4RestaurantContract(p);let last:RestaurantState|undefined;
 for(let n=0;n<4;n++){if(n===3)last=structuredClone(f.state);await processRestaurant(f.port,f.state.run.id,{jev:'',openai:'EXPLICIT_MOCK'},f.http,contract);}
 if(f.calls.length!==32||f.state.run.stage!=='prepare_sol'||f.state.tasks.some(t=>t.status!=='completed'||t.request_count!==1))throw Error('DIRECT4_MOCK_LUNA_FAILED');
 const ready=await compileDirect4Ready(f.state,p);if(!ready.artifact)throw Error('DIRECT4_MOCK_GATE_FAILED');
 const sol=direct4MockReady(ready.artifact,protocol),send=direct4SolMockPort(sol);
 await processReadySol(send.port,send.state.operation.id,'EXPLICIT_MOCK',send.http,direct4ReadyContract);
 if(send.calls.length!==1||!send.state.operation.receipt)throw Error('DIRECT4_MOCK_RECEIPT_MISSING');
 const validate=structuredClone(send.state);
 await processReadySol(send.port,send.state.operation.id,'EXPLICIT_MOCK',send.http,direct4ReadyContract);
 if(send.state.operation.status!=='completed'||!send.state.operation.result?.validated_report)throw Error('DIRECT4_MOCK_FINALIZATION_FAILED');
 return {luna:{state:last!,preparation:p},prepared:{state:sol},sol:{state:sol},validate_sol:{state:validate},
  qualification:{mock_luna_calls:32,mock_sol_calls:1,provider_calls:0,validated:true,receipt_before_validation:true}};
}
export async function runDirect4WorkerProbe(phase:string,input:unknown){
 if(phase==='luna'){
  const i=input as {state:RestaurantState;preparation:DirectReportPreparation},f=snapshotMockPort(i.state);
  await processRestaurant(f.port,f.state.run.id,{jev:'',openai:'EXPLICIT_MOCK'},f.http,direct4RestaurantContract(i.preparation));
  if(f.calls.length!==8||f.state.run.stage!=='prepare_sol'||f.state.tasks.some(t=>t.status!=='completed'||t.request_count!==1))throw Error('DIRECT4_PROBE_LUNA_FAILED');
  return {passed:true,mock_http_calls:8,maximum_luna_calls:32,completed_mock_luna:32,saved:true};
 }
 const i=input as {state:ReadyState};
 if(phase==='prepared'){
  await direct4ReadyContract.verify(i.state);
  return {passed:true,mock_http_calls:0,request_verified:true,saved:true};
 }
 if(!['sol','validate_sol'].includes(phase))throw Error('DIRECT4_PROBE_PHASE_INVALID');
 const f=direct4SolMockPort(i.state),outcome=await processReadySol(f.port,f.state.operation.id,'EXPLICIT_MOCK',f.http,direct4ReadyContract);
 if(outcome.error_code)throw Error(outcome.error_code);
 if(phase==='sol'&&(!f.state.operation.receipt||f.calls.length!==1)||
  phase==='validate_sol'&&(f.state.operation.status!=='completed'||!f.state.operation.result?.validated_report||f.calls.length!==0))throw Error('DIRECT4_PROBE_FINALIZATION_FAILED');
 if(phase==='validate_sol'){
  await processReadySol(f.port,f.state.operation.id,'EXPLICIT_MOCK',f.http,direct4ReadyContract);
  if(f.calls.length)throw Error('DIRECT4_PROBE_RETRY');
 }
 return {passed:true,mock_http_calls:f.calls.length,phase:outcome.phase,saved:true,
  result_sha256:await directHash(f.state.operation.result??f.state.operation.receipt),
  raw_sha256:f.state.operation.receipt?.raw_response_sha256??await analysisTextSha256('')};
}
