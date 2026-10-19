// In-memory technical mocks only. No real consent, job, supplier key or native fetch.
import {snapshotMockPort,snapshotReadyMock} from './jls-snapshot-v2-probe.ts';
import {historicalMockHttp} from './jls-direct4-historical-probe.ts';
import {processRestaurant,type RestaurantState} from './jls-restaurant-worker.ts';
import {processReadySol,type ReadyState} from './jls-sol-ready-worker.ts';
import {direct4MockSolResponse} from './jls-direct4-probe.ts';
import type {Direct4Ready} from './jls-direct4-execution.ts';
import {directHash} from './jev-direct-categories.ts';
import {directAcceptedSol,parseDirectReportLuna} from './jev-direct-report-preparation.ts';
import {direct4ComparisonContract,direct4ComparisonReadyContract,compileDirect4ComparisonSol,comparisonAsRestaurant,type Direct4Comparison} from './jls-direct4-comparison.ts';
export function comparisonMockPort(state:RestaurantState){
 const f=snapshotMockPort(state);f.port.finish=async(id,_w,status,body,sha)=>{
  const t=f.state.tasks.find(t=>t.id===id)!;t.status=status;
  f.state.artifacts.push({kind:'task:'+id,body:body as Record<string,unknown>,sha256:sha});
  if(status!=='completed')f.state.run.status='blocked';return true;
 };return f;
}
export async function rehearseDirect4Comparison(p:Direct4Comparison&{id:string}){
 const state:RestaurantState={protocol:{id:p.id,body:comparisonAsRestaurant(p.body),sha256:p.sha256},
  run:{id:'EXPLICIT_MOCK_NOT_PAID',stage:'luna',status:'queued'},tasks:p.body.pending_groups.map((g,n)=>({id:'MOCK_LUNA_'+n,
   run_id:'EXPLICIT_MOCK_NOT_PAID',organization_id:p.body.organization_id,phase:'luna',review_id:g.review_id,request:g.payload,
   request_sha256:g.request_sha256,identity:null,status:'pending',request_count:0,worker:'',cache_id:null})),
  artifacts:[{kind:'evidence_plan',body:{luna_groups:p.body.pending_groups},sha256:await directHash({luna_groups:p.body.pending_groups})}]};
 const f=comparisonMockPort(state),calls:string[]=[],fixtures:Record<string,unknown>={luna:{state:structuredClone(state)}};
 await processRestaurant(f.port,state.run.id,{jev:'',openai:'EXPLICIT_MOCK'},historicalMockHttp(f.state,calls),direct4ComparisonContract(p.body));
 if(f.state.run.stage!=='prepare_sol'||calls.length!==4||f.state.run.status==='blocked')throw Error('COMPARISON_MOCK_LUNA_FAILED');
 // Negative/abstaining mocks must never borrow another category's saved acceptance.
 for(const choice of ['unsupported','uncertain']){
  const pending=await Promise.all(p.body.pending_groups.map(g=>parseDirectReportLuna(g,{model:'gpt-6-luna',usage:{input_tokens:1,output_tokens:0,total_tokens:1},
   answers:g.evidence_ids.map(name=>({name,type:'choice',choice,confidence:1,probabilities:['supported','unsupported','uncertain'].map(value=>({value,probability:value===choice?1:0}))}))})));
  const branch=await directAcceptedSol(p.body.preparation,[...p.body.reused_results,...pending]);
  if(branch.accepted.length!==26||branch.accepted.some(e=>!p.body.reused_evidence_ids.includes(e.evidence_id)))throw Error('COMPARISON_VERDICT_TRANSFER');
 }
 const concurrent=comparisonMockPort(structuredClone(state)),cc:string[]=[];
 await Promise.all(Array.from({length:8},()=>processRestaurant(concurrent.port,state.run.id,{jev:'',openai:'EXPLICIT_MOCK'},historicalMockHttp(concurrent.state,cc),direct4ComparisonContract(p.body))));
 if(cc.length!==4||concurrent.state.tasks.some(t=>t.request_count!==1))throw Error('COMPARISON_DUPLICATE_LUNA');
 const lost=comparisonMockPort(structuredClone(state));let lostCalls=0;
 const lostHttp:typeof fetch=()=>{lostCalls++;return Promise.reject(Error('EXPLICIT_MOCK_LOST_RESPONSE'));};
 await processRestaurant(lost.port,state.run.id,{jev:'',openai:'EXPLICIT_MOCK'},lostHttp,direct4ComparisonContract(p.body));
 await processRestaurant(lost.port,state.run.id,{jev:'',openai:'EXPLICIT_MOCK'},lostHttp,direct4ComparisonContract(p.body));
 if(lostCalls!==4||lost.state.run.status!=='blocked')throw Error('COMPARISON_LOST_RESPONSE_RETRIED');
 const ready=await compileDirect4ComparisonSol(f.state),initial:ReadyState={protocol:f.state.protocol,ready:ready as unknown as ReadyState['ready'],
  operation:{id:'EXPLICIT_MOCK_SOL',organization_id:p.body.organization_id,mode:'mock',run_id:null,status:'queued',phase:'sol',request_count:0,worker:null,receipt:null,receipt_sha256:null,result:null}};
 fixtures.sol={state:structuredClone(initial)};
 const sol=snapshotReadyMock(initial);let solCalls=0;
 const http:typeof fetch=async(url,options)=>{if(String(url)!=='https://api.openai.com/v1/responses'||options?.body!==ready.body.request_json||sol.state.operation.request_count!==1)throw Error('COMPARISON_MOCK_NOT_RESERVED');
  solCalls++;return new Response(JSON.stringify(direct4MockSolResponse(ready as unknown as Direct4Ready)));};
 await processReadySol(sol.port,initial.operation.id,'EXPLICIT_MOCK',http,direct4ComparisonReadyContract);
 fixtures.validate_sol={state:structuredClone(sol.state)};
 await processReadySol(sol.port,initial.operation.id,'EXPLICIT_MOCK',http,direct4ComparisonReadyContract);
 await processReadySol(sol.port,initial.operation.id,'EXPLICIT_MOCK',http,direct4ComparisonReadyContract);
 if(solCalls!==1||sol.state.operation.status!=='completed'||!sol.state.operation.result?.validated_report)throw Error('COMPARISON_MOCK_FINALIZATION_FAILED');
 return {fixtures,qualification:{passed:true,explicit_technical_mock:true,provider_calls:0,mock_luna_requests:4,mock_luna_questions:6,
  mock_sol_calls:solCalls,reused_real_decisions:26,receipt_saved:true,result_saved:true,zero_retries:true,
  concurrent_wakes_passed:true,lost_response_not_retried:true,no_verdict_transfer:true,
  sol_measurement:ready.body.measurement,semantic_accuracy_measured:false,consents_created:0,paid_runs_created:0}};
}
export async function runDirect4ComparisonProbe(phase:string,input:unknown){
 if(phase==='luna'){
  const f=comparisonMockPort((input as {state:RestaurantState}).state),p=f.state.protocol.body as unknown as Direct4Comparison['body'],calls:string[]=[];
  await processRestaurant(f.port,f.state.run.id,{jev:'',openai:'EXPLICIT_MOCK'},historicalMockHttp(f.state,calls),direct4ComparisonContract(p));
  if(f.state.run.stage!=='prepare_sol'||f.state.run.status==='blocked'||calls.length!==4)throw Error('COMPARISON_MOCK_LUNA_FAILED');
  return {passed:true,provider_calls:0,mock_http_calls:calls.length,stage:f.state.run.stage};
 }
 if(!['sol','validate_sol'].includes(phase))throw Error('COMPARISON_PROBE_PHASE_INVALID');
 const f=snapshotReadyMock((input as {state:ReadyState}).state);let calls=0;
 const http:typeof fetch=async(_url,options)=>{if(options?.body!==f.state.ready.body.request_json||f.state.operation.request_count!==1)throw Error('COMPARISON_MOCK_NOT_RESERVED');
  calls++;return new Response(JSON.stringify(direct4MockSolResponse(f.state.ready as unknown as Direct4Ready)));};
 const out=await processReadySol(f.port,f.state.operation.id,'EXPLICIT_MOCK',http,direct4ComparisonReadyContract);
 if(out.error_code||phase==='sol'&&!f.state.operation.receipt||phase==='validate_sol'&&!f.state.operation.result?.validated_report)throw Error(out.error_code??'COMPARISON_MOCK_NOT_SAVED');
 return {passed:true,provider_calls:0,mock_http_calls:calls,phase:out.phase,tokenizer_misses:out.tokenizer_misses,result_saved:!!f.state.operation.result};
}
