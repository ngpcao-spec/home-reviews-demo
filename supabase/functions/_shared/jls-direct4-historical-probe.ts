// Explicit technical transport injection only. All output is synthetic and is
// never represented as a JEV classification, Luna verdict or Sol report.
import {snapshotMockPort,snapshotReadyMock} from './jls-snapshot-v2-probe.ts';
import {processRestaurant,type RestaurantState} from './jls-restaurant-worker.ts';
import {processReadySol,type ReadyState} from './jls-sol-ready-worker.ts';
import {DIRECT_CATEGORY_KEYS,DIRECT_NATIVE_CHOICES,directHash} from './jev-direct-categories.ts';
import {historicalDirect4Contract,compileHistoricalDirect4Evidence,compileHistoricalDirect4Sol,historicalDirect4ReadyContract,
 asRestaurantProtocol,type HistoricalDirect4Protocol} from './jls-direct4-historical.ts';
import {direct4MockSolResponse,type direct4MockReport} from './jls-direct4-probe.ts';
import type {Direct4Ready} from './jls-direct4-execution.ts';
import type {DirectReportPreparation} from './jev-direct-report-preparation.ts';
function directMockPort(state:RestaurantState){
 const f=snapshotMockPort(state);
 f.port.finish=async(id,_worker,status,body,sha)=>{
  const t=f.state.tasks.find(t=>t.id===id)!;t.status=status;
  f.state.artifacts.push({kind:'task:'+id,body:body as Record<string,unknown>,sha256:sha});
  if(status!=='completed')f.state.run.status='blocked';return true;
 };
 return f;
}
export function historicalMockHttp(state:RestaurantState,calls:string[]){
 const http:typeof fetch=async(url,options)=>{
  calls.push(String(url));const usage={input_tokens:1,output_tokens:0,total_tokens:1},q=JSON.parse(String(options?.body));
  if(state.run.stage==='jev'){
   if(!String(url).includes('typesafe.ai')||Object.keys(q.questions).join()!==DIRECT_CATEGORY_KEYS.join())throw Error('MOCK_FOUR_CATEGORIES_REQUIRED');
   return new Response(JSON.stringify({model:'jev-1.13.0',usage,answers:Object.fromEntries(DIRECT_CATEGORY_KEYS.map(k=>[k,{type:'choice',choice:'mixed',
    probabilities:Object.fromEntries(DIRECT_NATIVE_CHOICES.map(c=>[c,c==='mixed'?1:0]))}]))}));
  }
  if(state.run.stage!=='luna'||String(url)!=='https://api.openai.com/v1/decisions')throw Error('MOCK_STAGE_INVALID');
  return new Response(JSON.stringify({model:'gpt-6-luna',usage,answers:q.questions.map((x:{name:string})=>({name:x.name,type:'choice',choice:'supported',confidence:1,
   probabilities:[{value:'supported',probability:1},{value:'unsupported',probability:0},{value:'uncertain',probability:0}]}))}));
 };return http;
}
export async function rehearseHistoricalDirect4(p:HistoricalDirect4Protocol&{id:string}){
 const state:RestaurantState={protocol:{...p,body:asRestaurantProtocol(p.body)},run:{id:'EXPLICIT_MOCK_RUN',stage:'jev',status:'queued'},artifacts:[],
  tasks:p.body.pending.map((t,n)=>({id:'EXPLICIT_MOCK_JEV_'+n,run_id:'EXPLICIT_MOCK_RUN',organization_id:p.body.organization_id,phase:'jev',review_id:t.review_id,
   request:{...t.payload,questions:p.body.configuration.jev.questions},request_sha256:t.request_sha256,identity:t.identity,status:'pending',request_count:0,worker:'',cache_id:null}))};
 const f=directMockPort(state),calls:string[]=[],http=historicalMockHttp(f.state,calls),fixtures:Record<string,unknown>={};
 const wakes=Math.ceil(p.body.pending.length/8);
 for(let i=0;i<wakes;i++){if(i===wakes-1)fixtures.jev={state:structuredClone(f.state)};await processRestaurant(f.port,f.state.run.id,{jev:'EXPLICIT_MOCK',openai:'EXPLICIT_MOCK'},http,historicalDirect4Contract());}
 if(f.state.run.stage!=='prepare_evidence'||calls.length!==p.body.pending.length)throw Error('MOCK_JEV_INCOMPLETE');
 const evidence=await compileHistoricalDirect4Evidence(f.state),prep=evidence.preparation;
 f.state.artifacts.push({kind:'direct4_report_preparation',body:prep as unknown as Record<string,unknown>,sha256:await directHash(prep)},
  {kind:'direct4_evidence_bundle',body:evidence as unknown as Record<string,unknown>,sha256:await directHash(evidence)},
  {kind:'evidence_plan',body:{luna_groups:prep.body.luna_groups},sha256:await directHash({luna_groups:prep.body.luna_groups})});
 f.state.tasks.push(...prep.body.luna_groups.map((g,n)=>({id:'EXPLICIT_MOCK_LUNA_'+n,run_id:f.state.run.id,organization_id:p.body.organization_id,
  phase:'luna' as const,review_id:g.review_id,request:g.payload,request_sha256:g.request_sha256,identity:null,status:'pending',request_count:0,worker:'',cache_id:null})));
 f.state.run.stage='luna';fixtures.luna={state:structuredClone(f.state)};
 for(let i=0;i<4&&String(f.state.run.stage)==='luna';i++)await processRestaurant(f.port,f.state.run.id,{jev:'EXPLICIT_MOCK',openai:'EXPLICIT_MOCK'},http,historicalDirect4Contract(prep));
 if(String(f.state.run.stage)!=='prepare_sol')throw Error('MOCK_LUNA_INCOMPLETE');
 const ready=await compileHistoricalDirect4Sol(f.state),initial:ReadyState={protocol:f.state.protocol,ready:ready as unknown as ReadyState['ready'],
  operation:{id:'EXPLICIT_MOCK_SOL',organization_id:p.body.organization_id,mode:'mock',run_id:null,status:'queued',phase:'sol',request_count:0,worker:null,receipt:null,receipt_sha256:null,result:null}};
 fixtures.sol={state:structuredClone(initial)};
 const sol=snapshotReadyMock(initial),solCalls:string[]=[];
 const solHttp:typeof fetch=async(url,options)=>{if(options?.body!==ready.body.request_json||sol.state.operation.request_count!==1)throw Error('MOCK_SOL_NOT_RESERVED');solCalls.push(String(url));return new Response(JSON.stringify(direct4MockSolResponse(ready as unknown as Direct4Ready)));};
 await processReadySol(sol.port,sol.state.operation.id,'EXPLICIT_MOCK',solHttp,historicalDirect4ReadyContract);fixtures.validate_sol={state:structuredClone(sol.state)};
 await processReadySol(sol.port,sol.state.operation.id,'EXPLICIT_MOCK',solHttp,historicalDirect4ReadyContract);
 if(sol.state.operation.status!=='completed'||!sol.state.operation.result?.validated_report||solCalls.length!==1)throw Error('MOCK_SOL_NOT_SAVED');
 await processReadySol(sol.port,sol.state.operation.id,'EXPLICIT_MOCK',solHttp,historicalDirect4ReadyContract);
 return {fixtures,qualification:{version:p.body.version,explicit_technical_mock:true,provider_calls:0,
  simulated_jev:p.body.pending.length,simulated_luna:prep.body.luna_groups.length,simulated_sol:solCalls.length,request_measurement:ready.body.measurement,
  recommendations:(sol.state.operation.result.validated_report as unknown as ReturnType<typeof direct4MockReport>).report.recommendations.length,
  receipt_saved:true,report_saved:true,zero_retries:true,denominators:p.body.denominators,configuration_sha256:p.body.classification_configuration_sha256}};
}
export async function runHistoricalDirect4Probe(phase:string,input:unknown){
 if(phase==='jev'||phase==='luna'){
  const f=directMockPort((input as {state:RestaurantState}).state),calls:string[]=[],http=historicalMockHttp(f.state,calls);
  const prep=f.state.artifacts.find(a=>a.kind==='direct4_report_preparation')?.body as unknown as DirectReportPreparation;
  await processRestaurant(f.port,f.state.run.id,{jev:'EXPLICIT_MOCK',openai:'EXPLICIT_MOCK'},http,historicalDirect4Contract(prep));
  if(f.state.run.status==='blocked'||f.state.artifacts.some(a=>a.kind==='mock_error'))throw Error('MOCK_STAGE_FAILED');
  return {passed:true,mock_http_calls:calls.length,phase:f.state.run.stage,provider_calls:0};
 }
 const state=(input as {state:ReadyState}).state,f=snapshotReadyMock(state);let calls=0;
 const http:typeof fetch=async(_url,options)=>{if(options?.body!==state.ready.body.request_json||f.state.operation.request_count!==1)throw Error('MOCK_SOL_REQUEST_CHANGED');calls++;return new Response(JSON.stringify(direct4MockSolResponse(state.ready as unknown as Direct4Ready)));};
 const out=await processReadySol(f.port,f.state.operation.id,'EXPLICIT_MOCK',http,historicalDirect4ReadyContract);
 if(out.error_code||phase==='sol'&&!f.state.operation.receipt||phase==='validate_sol'&&!f.state.operation.result?.validated_report)throw Error(out.error_code??'MOCK_SOL_NOT_SAVED');
 return {passed:true,mock_http_calls:calls,provider_calls:0,phase:out.phase,tokenizer_misses:out.tokenizer_misses,result_saved:!!f.state.operation.result};
}
