import {verifyPreparedArtifact,normalizedPlan,type PreparedRestaurantRow} from "./jls-restaurant-prepared.ts";
import {attachPlanTokenMemo,planTokenMemo,tokenCertificate,type TokenCertificate} from "./jls-token-memo.ts";
import {solRequestSize} from "./jls-sol-size.ts";
import { restaurantEvidencePlan, restaurantSol, verifyRestaurantProtocol, verifyRestaurantResumePlan, type RestaurantProtocol, RESTAURANT_POLICY } from "./jls-restaurant.ts";
import { hybridHash } from "./jev-hybrid-evidence.ts";
import { negativeHash } from "./negative-validation-core.ts";
import { parseJlsLuna, type JlsPlan } from "./jev-luna-sol.ts";
import { parseThemes } from "./jev-themes.ts";
import { economicThemeResults } from "./jev-economy-cache.ts";
import { validateEditorialReport } from "./jls-editorial-validation.ts";
import { JEV_ENDPOINT } from "./jev.ts";
export interface RestaurantTask {id:string;run_id:string;organization_id:string;phase:"jev"|"luna"|"sol";review_id:string|null;
 request:unknown;request_sha256:string;identity:{expected_served_model:string}|null;status:string;request_count:number;worker:string;}
export interface RestaurantState {protocol:{id:string;body:RestaurantProtocol;sha256:string};
 run:{id:string;stage:"jev"|"luna"|"prepare_evidence"|"prepare_sol"|"sol";status:string};tasks:(RestaurantTask&{cache_id:string|null})[];
 artifacts:{kind:string;body:Record<string,unknown>;sha256:string}[];}
export interface RestaurantPort {
 tick(run:string,worker:string):Promise<boolean>;load(run:string):Promise<RestaurantState>;
 cache(p:RestaurantProtocol):Promise<RestaurantProtocol["cache"]>;
 prepared?(p:RestaurantProtocol):Promise<PreparedRestaurantRow>;
 cacheCompatible?(protocolId:string):Promise<boolean>;
 claim(run:string,worker:string):Promise<RestaurantTask|null>;
 artifact(run:string,worker:string,kind:string,body:unknown,sha:string):Promise<boolean>;
 finish(task:string,worker:string,status:string,body:unknown,sha:string):Promise<boolean>;
 stage(run:string,worker:string,stage:string,tasks:unknown[]):Promise<boolean>;
 release(run:string,worker:string,error:string|null):Promise<void>;
}
type SolArtifact=Awaited<ReturnType<typeof restaurantSol>> & {decisions:import("./jev-luna-sol.ts").JlsDecision[];
 token_certificate?:TokenCertificate;token_certificate_sha256?:string;request_json?:string;request_raw_sha256?:string};
const fail=(e:unknown)=>e instanceof Error&&/^[A-Z_0-9]+$/.test(e.message)?e.message:"JLS_PROVIDER_RESULT_UNCERTAIN_NO_RETRY";
const artifact=<T>(state:RestaurantState,key:string):T|null=>{
 const x=state.artifacts.find(x=>x.kind===key);return x?x.body as T:null;
};
// A raw single fetch after transactional reservation. No SDK retry/fallback.
export async function restaurantAttempt(task:RestaurantTask,state:RestaurantState,key:string,http:typeof fetch,contract?:RestaurantExecutionContract) {
 const p=state.protocol.body,start=Date.now();let status="billing_uncertain",sent=false,wire=JSON.stringify(task.request);
 const out:Record<string,unknown>={phase:task.phase,request_sha256:task.request_sha256,raw_response_text:null,
  raw_response_sha256:null,response:null,response_sha256:null,input_tokens:null,output_tokens:null,cost_usd:null,
  calculated_not_verified_invoice:true,served_model:null,duration_ms:0,error_code:null};
 try{
  if(!key||task.run_id!==state.run.id||task.organization_id!==p.organization_id||task.request_count!==1||task.status!=="running"||
   task.request_sha256!==await hybridHash(task.request))throw Error("JLS_RESERVED_ATTEMPT_CHANGED");
  const q=task.request as {model:string};
  const expected=task.phase==="jev"?"jev-latest":task.phase==="luna"?"gpt-6-luna":"gpt-6.1-sol";
  if(q.model!==expected)throw Error("JLS_REQUEST_MODEL_INVALID");
  if(task.phase==="jev"){
   const t=p.pending.find(t=>t.review_id===task.review_id);
   if(!t||t.request_sha256!==task.request_sha256||await hybridHash(task.identity)!==await hybridHash(t.identity))throw Error("JLS_JEV_MANIFEST_CHANGED");
  }else if(task.phase==="luna"){
   const plan=artifact<JlsPlan>(state,"evidence_plan"),group=plan?.luna_groups.find(g=>g.review_id===task.review_id);
   if(!group||group.request_sha256!==task.request_sha256)throw Error("JLS_LUNA_MANIFEST_CHANGED");
  }else{
   const sol=artifact<SolArtifact>(state,"sol_dossier");
   if(!sol?.gate.passed||!sol.draft||sol.draft.request_sha256!==task.request_sha256||
    sol.draft.prompt_sha256!==p.configuration.sol_prompt_sha256||sol.draft.schema_sha256!==p.configuration.sol_schema_sha256)
    throw Error("JLS_SOL_MANIFEST_CHANGED");
   const plan=artifact<JlsPlan>(state,"evidence_plan");
   if(p.prepared){
    if(!sol.request_json||await negativeHash(sol.request_json)!==sol.request_raw_sha256||await hybridHash(JSON.parse(sol.request_json))!==task.request_sha256)throw Error("JLS_SOL_WIRE_CHANGED");wire=sol.request_json;
   }
   if(p.sol_size_policy)solRequestSize(JSON.parse(wire),p.sol_size_policy,plan?planTokenMemo(plan)?.count:undefined);
  }
  sent=true;
  const response=await http(task.phase==="jev"?JEV_ENDPOINT:task.phase==="luna"?"https://api.openai.com/v1/decisions":"https://api.openai.com/v1/responses",
   {method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:wire,
    redirect:"error",signal:AbortSignal.timeout(RESTAURANT_POLICY.provider_timeout_ms)});
  const text=(await response.text()).replaceAll(key,"[REDACTED_SECRET]");
  out.raw_response_text=text;out.raw_response_sha256=await negativeHash(text);out.provider_request_id=response.headers.get("x-request-id");
  const raw=JSON.parse(text);out.response=raw;out.response_sha256=await hybridHash(raw);out.response_id=raw.id??null;out.served_model=raw.model??null;
  if(!response.ok)throw Error("JLS_PROVIDER_HTTP_"+response.status);
  const u=raw.usage;
  if(!u||!Number.isSafeInteger(u.input_tokens)||u.input_tokens<=0||!Number.isSafeInteger(u.output_tokens)||u.output_tokens<0||
   u.total_tokens!==undefined&&u.total_tokens!==u.input_tokens+u.output_tokens)throw Error("JLS_USAGE_MISSING_BILLING_UNCERTAIN");
  out.input_tokens=u.input_tokens;out.output_tokens=u.output_tokens;out.usage=u;
  status="invalid_output";
  if(task.phase==="jev"){
   if(contract?.parseJev)Object.assign(out,await contract.parseJev(state,task,raw));
   else {
   const native=parseThemes(raw);if(native.model!==task.identity?.expected_served_model)throw Error("JLS_JEV_SERVED_MODEL_CHANGED");
   out.jev_response=native.decision;out.theme_results=economicThemeResults(native.decision);
   }
  }else if(task.phase==="luna"){
   const plan=artifact<JlsPlan>(state,"evidence_plan")!,group=plan.luna_groups.find(g=>g.review_id===task.review_id)!;
   if(contract?.parseLuna)Object.assign(out,await contract.parseLuna(state,task,raw));
   else {const native=await parseJlsLuna(plan,group,raw);out.decisions=native.decisions;out.cost_usd=native.cost_usd;}
  }else{
   if(raw.model!=="gpt-6.1-sol"||raw.status!=="completed"||!Array.isArray(raw.output))throw Error("JLS_SOL_MODEL_OR_OUTPUT_INVALID");
   const content=raw.output.filter((x:{type:string})=>x.type==="message").flatMap((x:{content:{type:string;text:string}[]})=>x.content);
   if(content.some((x:{type:string})=>x.type==="refusal"))throw Error("JLS_SOL_REFUSED");
   const texts=content.filter((x:{type:string})=>x.type==="output_text");
   if(texts.length!==1)throw Error("JLS_SOL_OUTPUT_INVALID");
   const sol=artifact<SolArtifact>(state,"sol_dossier")!;
   const plan=artifact<JlsPlan>(state,"evidence_plan")!;
   const validated=await validateEditorialReport(JSON.parse(texts[0].text),plan,p.snapshot,sol.decisions,"vi");
   out.validated_report=validated;out.validator_version=validated.validator_version;
   const r=validated.report,items=[...r.axes,...r.positive_aspects,...r.negative_aspects,r.conclusion,...r.recommendations];
   if(items.some(x=>x.status==="review_needed")){status="needs_review";out.error_code="JLS_REPORT_NEEDS_REVIEW";}
  }
  if(status!=="needs_review")status="completed";
 }catch(e){if(!sent)status="blocked";out.error_code=fail(e);}
 out.duration_ms=Date.now()-start;return {status,body:out,sha256:await hybridHash(out)};
}
export interface RestaurantExecutionContract {
 verify(p:RestaurantProtocol,sha:string):Promise<void>;
 completed(state:RestaurantState,worker:string,port:RestaurantPort):Promise<void>;
 frozenAnalysisSource?:true;
 parseJev?(state:RestaurantState,task:RestaurantTask,raw:unknown):Promise<Record<string,unknown>>;
 parseLuna?(state:RestaurantState,task:RestaurantTask,raw:unknown):Promise<Record<string,unknown>>;
}
export async function processRestaurant(port:RestaurantPort,run:string,keys:{jev:string;openai:string},http:typeof fetch,contract?:RestaurantExecutionContract) {
 const worker=crypto.randomUUID();if(!await port.tick(run,worker))return;
 let error:string|null=null;
 try{
  let state=await port.load(run);const p=state.protocol.body;
  if(contract)await contract.verify(p,state.protocol.sha256);else await verifyRestaurantProtocol(p,state.protocol.sha256);
  for(const a of state.artifacts)if(await hybridHash(a.body)!==a.sha256)throw Error("JLS_ARTIFACT_CHANGED");
  let prepared:PreparedRestaurantRow|null=null;
  if(p.prepared){
   if(!port.prepared)throw Error("JLS_PREPARED_ARTIFACT_MISSING");prepared=await port.prepared(p);
   if(port.cacheCompatible&&!await port.cacheCompatible(state.protocol.id))throw Error("JLS_REUSED_CACHE_CHANGED");
   const plan=await verifyPreparedArtifact(p,prepared,port.cacheCompatible?undefined:await port.cache(p));
   const existing=state.artifacts.find(a=>a.kind==="evidence_plan");
   if(existing){if(await hybridHash(existing.body)!==prepared.body.plan_sha256)throw Error("JLS_PREPARED_PLAN_CHANGED");existing.body=plan as unknown as Record<string,unknown>;}
   if(state.run.stage==="sol"){
    const sol=artifact<SolArtifact>(state,"sol_dossier");
    if(!sol?.token_certificate||await hybridHash(sol.token_certificate)!==sol.token_certificate_sha256)throw Error("JLS_TOKEN_CERTIFICATE_CHANGED");
    const native=await restaurantNativeDecisions(state,plan);
    if(await hybridHash(native)!==await hybridHash(sol.decisions))throw Error("JLS_LUNA_NATIVE_CHANGED");
    await attachPlanTokenMemo(plan,sol.token_certificate,true);
   }
  }else if(!contract?.frozenAnalysisSource){
  const cache=await port.cache(p);
  const reused=cache.filter(c=>p.cache.some(x=>x.id===c.id)).sort((a,b)=>a.id.localeCompare(b.id));
  if(await hybridHash(reused)!==await hybridHash([...p.cache].sort((a,b)=>a.id.localeCompare(b.id))))throw Error("JLS_REUSED_CACHE_CHANGED");
  }
  const key=state.run.stage==="jev"?keys.jev:keys.openai;
  if(state.tasks.some(t=>t.phase===state.run.stage&&t.status==="pending")&&!key.trim())throw Error("JLS_PROVIDER_KEY_UNAVAILABLE");
  const tasks=[];
  for(let i=0;i<(state.run.stage==="sol"?1:8);i++){const t=await port.claim(run,worker);if(!t)break;tasks.push(t);}
  const outcomes=await Promise.allSettled(tasks.map(async t=>{
   const outcome=await restaurantAttempt(t,state,key,http,contract);
   if(!await port.finish(t.id,worker,outcome.status,outcome.body,outcome.sha256))throw Error("JLS_RESULT_SAVE_UNCERTAIN_NO_RETRY");
  }));
  const failed=outcomes.find(x=>x.status==="rejected");if(failed?.status==="rejected")throw failed.reason;
  state=await port.load(run);
  if(!["queued","running"].includes(state.run.status))return;
  if(state.tasks.some(t=>t.phase===state.run.stage&&!["completed","reused"].includes(t.status)))return;
  if(contract){await contract.completed(state,worker,port);return;}
  const save=async(kind:string,b:unknown)=>{if(!await port.artifact(run,worker,kind,b,await hybridHash(b)))throw Error("JLS_ARTIFACT_SAVE_UNCERTAIN");};
  if(state.run.stage==="jev"){
   const plan=prepared?prepared.body.plan:await restaurantEvidencePlan(p,await port.cache(p));if(!prepared)await verifyRestaurantResumePlan(p,plan);await save("evidence_plan",plan);
   if(!await port.stage(run,worker,"luna",plan.luna_groups.map(g=>({review_id:g.review_id,request:g.payload,request_sha256:g.request_sha256}))))throw Error("JLS_STAGE_CHANGED");
  }else if(state.run.stage==="luna"&&p.prepared){
   const plan=normalizedPlan(artifact<JlsPlan>(state,"evidence_plan")!),ds=await restaurantNativeDecisions(state,plan);
   await save("luna_decisions",{decisions:ds,decisions_sha256:await hybridHash(ds)});
   if(!await port.stage(run,worker,"prepare_sol",[]))throw Error("JLS_STAGE_CHANGED");
  }else if(state.run.stage==="luna"||state.run.stage==="prepare_sol"){
   const plan=p.prepared?normalizedPlan(artifact<JlsPlan>(state,"evidence_plan")!):artifact<JlsPlan>(state,"evidence_plan")!,ds=await restaurantNativeDecisions(state,plan);
   if(prepared)await attachPlanTokenMemo(plan,prepared.body.token_certificate);
   const sol=await restaurantSol(plan,ds);
   const extra=prepared&&sol.draft?{token_certificate:await tokenCertificate(plan),request_json:JSON.stringify(sol.draft.request),request_raw_sha256:await negativeHash(JSON.stringify(sol.draft.request))}:null;
   await save("sol_dossier",{...sol,decisions:ds,...extra,...(extra?{token_certificate_sha256:await hybridHash(extra.token_certificate)}:{})});
   if(!sol.gate.passed||!sol.draft)throw Error("JLS_SOL_EVIDENCE_INSUFFICIENT");
   if(!await port.stage(run,worker,"sol",[{request:sol.draft.request,request_sha256:sol.draft.request_sha256}]))throw Error("JLS_STAGE_CHANGED");
  }else if(!await port.stage(run,worker,"completed",[]))throw Error("JLS_STAGE_CHANGED");
 }catch(e){error=fail(e);}
 finally{await port.release(run,worker,error);}
}

export async function restaurantNativeDecisions(state:RestaurantState,plan:JlsPlan){const ds=[];
 for(const g of plan.luna_groups){const task=state.tasks.find(t=>t.phase==="luna"&&t.review_id===g.review_id),a=state.artifacts.find(a=>a.kind==="task:"+task?.id);
 if(!task||!a||task.request_count!==1||task.status!=="completed"||task.request_sha256!==g.request_sha256||await hybridHash(a.body)!==a.sha256)throw Error("JLS_LUNA_INCOMPLETE");
 const native=await parseJlsLuna(plan,g,a.body.response);if(await hybridHash(native.decisions)!==await hybridHash(a.body.decisions))throw Error("JLS_LUNA_NATIVE_CHANGED");ds.push(...native.decisions);}
 return ds;
}
