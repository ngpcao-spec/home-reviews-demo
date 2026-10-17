// Explicit technical mocks only; no credentials and no native provider transport.
import {processRestaurant,type RestaurantState,type RestaurantPort} from "./jls-restaurant-worker.ts";
import {processReadySol,type ReadyState,type ReadyPort} from "./jls-sol-ready-worker.ts";
import {snapshotExecutionContract,snapshotReadyContract,compileSnapshotEvidence,compileSnapshotSol,verifySnapshotEvidence,type SnapshotEvidence} from "./jls-snapshot-v2.ts";
import {THEME_KEYS} from "./jev-themes.ts";
import {economicThemeResults,type EconomyCache} from "./jev-economy-cache.ts";
import {hybridHash} from "./jev-hybrid-evidence.ts";
import {technicalSolMock} from "./jls-restaurant-cpu-probe.ts";
import {RECOMMENDATION_VERSION} from "./jls-recommendation-contract-v2.ts";
import type {RestaurantProtocol} from "./jls-restaurant.ts";
export function snapshotMockPort(initial:RestaurantState,initialCache:EconomyCache[]=[]){
 const state=structuredClone(initial),cache=structuredClone(initialCache),calls:string[]=[];let leased=false,allowed=true;
 const port:RestaurantPort={load:()=>Promise.resolve(state),tick:async()=>{if(leased||!allowed||!["queued","running"].includes(state.run.status))return false;leased=true;state.run.status="running";return true;},
 cache:()=>Promise.resolve(cache),claim:async(_run,w)=>{const t=state.tasks.find(t=>t.phase===state.run.stage&&t.status==="pending"&&t.request_count===0);
 if(!t)return null;t.request_count=1;t.worker=w;t.status="running";return structuredClone(t);},
 artifact:async(_run,_w,kind,body,sha)=>{const old=state.artifacts.find(a=>a.kind===kind);if(old)return old.sha256===sha;state.artifacts.push({kind,body:body as Record<string,unknown>,sha256:sha});return true;},
 finish:async(id,_w,status,body,sha)=>{const t=state.tasks.find(t=>t.id===id)!;t.status=status;
 state.artifacts.push({kind:"task:"+id,body:body as Record<string,unknown>,sha256:sha});
 if(status!=="completed"){state.run.status="blocked";return true;}
 if(t.phase==="jev"){
 const pending=state.protocol.body.pending.find(p=>p.review_id===t.review_id)!,b=body as {jev_response:EconomyCache["response"];served_model:string};
 cache.push({...pending.identity,id:crypto.randomUUID(),cache_key:pending.cache_key,status:"completed",response:b.jev_response,
  served_model:b.served_model,input_tokens:1,output_tokens:0,cost_usd:null,usage_complete:false,processed_at:"2026-10-17T00:00:00Z",source_task_id:t.id,
  theme_results:economicThemeResults(b.jev_response!)} as EconomyCache);
 }return true;},stage:async(_r,_w,phase)=>{state.run.stage=phase as RestaurantState["run"]["stage"];return true;},
 release:async(_r,_w,error)=>{leased=false;if(error){state.run.status="blocked";state.artifacts.push({kind:"mock_error",body:{error},sha256:"explicit_mock"});}}};
 const http:typeof fetch=async(url,options)=>{
 if(!leased)throw Error("MOCK_RESERVATION_REQUIRED");calls.push(String(url));const q=JSON.parse(String(options?.body)),usage={input_tokens:1,output_tokens:0,total_tokens:1};
 if(state.run.stage==="jev")return new Response(JSON.stringify({model:"jev-1.13.0",usage,answers:Object.fromEntries(THEME_KEYS.map(k=>[k,
  {type:"choice",choice:"both",probabilities:{absent:0,positive:0,negative:0,both:1}}]))}));
 if(state.run.stage==="luna")return new Response(JSON.stringify({model:"gpt-6-luna",usage,answers:q.questions.map((x:{name:string})=>({name:x.name,type:"choice",choice:"supported",confidence:.99,
  probabilities:[{value:"supported",probability:.99},{value:"unsupported",probability:.005},{value:"uncertain",probability:.005}]}))}));
 throw Error("MOCK_UNEXPECTED_PROVIDER_STAGE");
 };
 return {state,cache,port,http,calls,deny:()=>{allowed=false;},interrupt:()=>{leased=false;}};
}
export function snapshotReadyMock(initial:ReadyState){
 const state=structuredClone(initial);let leased=false;const calls:string[]=[];
 const port:ReadyPort={load:()=>Promise.resolve(state),active:()=>Promise.resolve(),compatible:()=>Promise.resolve(true),
 claim:async(_id,w)=>{const o=state.operation;if(leased||!["queued","received","dispatched","validating"].includes(o.status))return null;
  if(o.phase==="sol"&&o.request_count){o.status="billing_uncertain";return null;}leased=true;o.worker=w;if(o.phase==="sol")o.request_count=1;o.status=o.phase==="sol"?"dispatched":"validating";return structuredClone(o);},
 receive:async(_id,_w,r,sha)=>{state.operation.receipt=r;state.operation.receipt_sha256=sha;state.operation.phase="validate_sol";state.operation.status=r.raw_response_text?"received":"billing_uncertain";leased=false;return true;},
 finish:async(_id,_w,status,b)=>{state.operation.result=b;state.operation.status=status;leased=false;return true;},
 abort:async(_id,_w,error)=>{state.operation.status=state.operation.request_count?"billing_uncertain":"blocked";state.operation.result={error};leased=false;}};
 const http:typeof fetch=async(url,options)=>{if(!leased||state.operation.request_count!==1||options?.body!==state.ready.body.request_json)throw Error("MOCK_SOL_RESERVATION_REQUIRED");calls.push(String(url));
  const r=technicalSolMock(state.ready.body.plan);r.report.recommendations=[];
  const raw={...r,format_version:RECOMMENDATION_VERSION};return new Response(JSON.stringify({id:"EXPLICIT_TECHNICAL_MOCK_NOT_REAL_RESULT",model:"gpt-6.1-sol",status:"completed",
   usage:{input_tokens:1,output_tokens:1,total_tokens:2},output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(raw)}]}]}));};
 return {state,port,http,calls,interrupt:()=>{leased=false;}};
}
export async function rehearseSnapshotV2(protocol:{id:string;body:RestaurantProtocol;sha256:string}){
 const state:RestaurantState={protocol,run:{id:"EXPLICIT_MOCK_NOT_PAID_RUN",stage:"jev",status:"queued"},artifacts:[],
  tasks:protocol.body.pending.map(t=>({id:crypto.randomUUID(),run_id:"EXPLICIT_MOCK_NOT_PAID_RUN",organization_id:protocol.body.organization_id,
   phase:"jev",review_id:t.review_id,request:{...t.payload,questions:protocol.body.configuration.jev_request_template.questions},request_sha256:t.request_sha256,
   identity:t.identity,status:"pending",request_count:0,worker:"",cache_id:null}))};
 const f=snapshotMockPort(state,protocol.body.cache),inputs:Record<string,unknown>={jev:{state:structuredClone(state),cache:[]}};
 for(let i=0;i<20&&f.state.run.stage==="jev";i++)await processRestaurant(f.port,f.state.run.id,{jev:"mock",openai:"mock"},f.http,snapshotExecutionContract);
 if(f.state.run.stage!=="prepare_evidence")throw Error("MOCK_JEV_STAGE_FAILED");
 const evidence=await compileSnapshotEvidence(protocol.body,protocol.sha256,f.cache),plan=evidence.plan;
 await verifySnapshotEvidence(protocol.body,protocol.sha256,evidence);
 f.state.artifacts.push({kind:"snapshot_evidence",body:evidence as unknown as Record<string,unknown>,sha256:await hybridHash(evidence)},
  {kind:"evidence_plan",body:plan as unknown as Record<string,unknown>,sha256:await hybridHash(plan)});
 f.state.tasks.push(...plan.luna_groups.map(g=>({id:crypto.randomUUID(),run_id:f.state.run.id,organization_id:protocol.body.organization_id,phase:"luna" as const,
  review_id:g.review_id,request:g.payload,request_sha256:g.request_sha256,identity:null,status:"pending",request_count:0,worker:"",cache_id:null})));
 f.state.run.stage="luna";inputs.luna={state:structuredClone(f.state),cache:structuredClone(f.cache)};
 for(let i=0;i<8&&f.state.run.stage==="luna";i++)await processRestaurant(f.port,f.state.run.id,{jev:"mock",openai:"mock"},f.http,snapshotExecutionContract);
 if(String(f.state.run.stage)!=="prepare_sol")throw Error("MOCK_LUNA_STAGE_FAILED");
 const ready=await compileSnapshotSol(f.state),initial:ReadyState={protocol,ready:ready as unknown as ReadyState["ready"],
  operation:{id:"EXPLICIT_MOCK_SOL",organization_id:protocol.body.organization_id,mode:"mock",run_id:null,phase:"sol",status:"queued",request_count:0,worker:null,receipt:null,receipt_sha256:null,result:null}};
 inputs.sol=structuredClone(initial);const s=snapshotReadyMock(initial);
 await processReadySol(s.port,s.state.operation.id,"mock",s.http,snapshotReadyContract);inputs.validate_sol=structuredClone(s.state);
 await processReadySol(s.port,s.state.operation.id,"mock",s.http,snapshotReadyContract);
 if(!s.state.operation.result?.validated_report)throw Error("MOCK_VALIDATION_SAVE_FAILED");
 return {explicit_technical_mock:true,provider_calls:0,paid_consent_created:false,paid_run_created:false,
  protocol_sha256:protocol.sha256,inputs,measurements:{jev_calls:f.state.tasks.filter(t=>t.phase==="jev"&&t.request_count===1).length,
   luna_requests:plan.max_luna_calls,luna_questions:plan.question_count,sol_calls:s.calls.length,sol:ready.body.measurement,
   report_status:s.state.operation.status,tokenizer_misses_at_dispatch:0},mock_result:s.state.operation.result};
}
