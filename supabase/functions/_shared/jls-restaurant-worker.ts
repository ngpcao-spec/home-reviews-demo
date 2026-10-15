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
 run:{id:string;stage:"jev"|"luna"|"sol";status:string};tasks:(RestaurantTask&{cache_id:string|null})[];
 artifacts:{kind:string;body:Record<string,unknown>;sha256:string}[];}
export interface RestaurantPort {
 tick(run:string,worker:string):Promise<boolean>;load(run:string):Promise<RestaurantState>;
 cache(p:RestaurantProtocol):Promise<RestaurantProtocol["cache"]>;
 claim(run:string,worker:string):Promise<RestaurantTask|null>;
 artifact(run:string,worker:string,kind:string,body:unknown,sha:string):Promise<boolean>;
 finish(task:string,worker:string,status:string,body:unknown,sha:string):Promise<boolean>;
 stage(run:string,worker:string,stage:string,tasks:unknown[]):Promise<boolean>;
 release(run:string,worker:string,error:string|null):Promise<void>;
}
const fail=(e:unknown)=>e instanceof Error&&/^[A-Z_0-9]+$/.test(e.message)?e.message:"JLS_PROVIDER_RESULT_UNCERTAIN_NO_RETRY";
const artifact=<T>(state:RestaurantState,key:string):T|null=>{
 const x=state.artifacts.find(x=>x.kind===key);return x?x.body as T:null;
};
// A raw single fetch after transactional reservation. No SDK retry/fallback.
export async function restaurantAttempt(task:RestaurantTask,state:RestaurantState,key:string,http:typeof fetch) {
 const p=state.protocol.body,start=Date.now();let status="billing_uncertain",sent=false;
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
   const sol=artifact<Awaited<ReturnType<typeof restaurantSol>> & {decisions:import("./jev-luna-sol.ts").JlsDecision[]}>(state,"sol_dossier");
   if(!sol?.gate.passed||!sol.draft||sol.draft.request_sha256!==task.request_sha256||
    sol.draft.prompt_sha256!==p.configuration.sol_prompt_sha256||sol.draft.schema_sha256!==p.configuration.sol_schema_sha256)
    throw Error("JLS_SOL_MANIFEST_CHANGED");
   if(p.sol_size_policy)solRequestSize(task.request,p.sol_size_policy);
  }
  sent=true;
  const response=await http(task.phase==="jev"?JEV_ENDPOINT:task.phase==="luna"?"https://api.openai.com/v1/decisions":"https://api.openai.com/v1/responses",
   {method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify(task.request),
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
   const native=parseThemes(raw);if(native.model!==task.identity?.expected_served_model)throw Error("JLS_JEV_SERVED_MODEL_CHANGED");
   out.jev_response=native.decision;out.theme_results=economicThemeResults(native.decision);
  }else if(task.phase==="luna"){
   const plan=artifact<JlsPlan>(state,"evidence_plan")!,group=plan.luna_groups.find(g=>g.review_id===task.review_id)!;
   const native=await parseJlsLuna(plan,group,raw);out.decisions=native.decisions;out.cost_usd=native.cost_usd;
  }else{
   if(raw.model!=="gpt-6.1-sol"||raw.status!=="completed"||!Array.isArray(raw.output))throw Error("JLS_SOL_MODEL_OR_OUTPUT_INVALID");
   const content=raw.output.filter((x:{type:string})=>x.type==="message").flatMap((x:{content:{type:string;text:string}[]})=>x.content);
   if(content.some((x:{type:string})=>x.type==="refusal"))throw Error("JLS_SOL_REFUSED");
   const texts=content.filter((x:{type:string})=>x.type==="output_text");
   if(texts.length!==1)throw Error("JLS_SOL_OUTPUT_INVALID");
   const sol=artifact<Awaited<ReturnType<typeof restaurantSol>> & {decisions:import("./jev-luna-sol.ts").JlsDecision[]}>(state,"sol_dossier")!;
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
export async function processRestaurant(port:RestaurantPort,run:string,keys:{jev:string;openai:string},http:typeof fetch) {
 const worker=crypto.randomUUID();if(!await port.tick(run,worker))return;
 let error:string|null=null;
 try{
  let state=await port.load(run);const p=state.protocol.body;await verifyRestaurantProtocol(p,state.protocol.sha256);
  for(const a of state.artifacts)if(await hybridHash(a.body)!==a.sha256)throw Error("JLS_ARTIFACT_CHANGED");
  const cache=await port.cache(p);
  const reused=cache.filter(c=>p.cache.some(x=>x.id===c.id)).sort((a,b)=>a.id.localeCompare(b.id));
  if(await hybridHash(reused)!==await hybridHash([...p.cache].sort((a,b)=>a.id.localeCompare(b.id))))throw Error("JLS_REUSED_CACHE_CHANGED");
  const key=state.run.stage==="jev"?keys.jev:keys.openai;
  if(state.tasks.some(t=>t.phase===state.run.stage&&t.status==="pending")&&!key.trim())throw Error("JLS_PROVIDER_KEY_UNAVAILABLE");
  const tasks=[];
  for(let i=0;i<(state.run.stage==="sol"?1:8);i++){const t=await port.claim(run,worker);if(!t)break;tasks.push(t);}
  const outcomes=await Promise.allSettled(tasks.map(async t=>{
   const outcome=await restaurantAttempt(t,state,key,http);
   if(!await port.finish(t.id,worker,outcome.status,outcome.body,outcome.sha256))throw Error("JLS_RESULT_SAVE_UNCERTAIN_NO_RETRY");
  }));
  const failed=outcomes.find(x=>x.status==="rejected");if(failed?.status==="rejected")throw failed.reason;
  state=await port.load(run);
  if(!["queued","running"].includes(state.run.status))return;
  if(state.tasks.some(t=>t.phase===state.run.stage&&!["completed","reused"].includes(t.status)))return;
  const save=async(kind:string,b:unknown)=>{if(!await port.artifact(run,worker,kind,b,await hybridHash(b)))throw Error("JLS_ARTIFACT_SAVE_UNCERTAIN");};
  if(state.run.stage==="jev"){
   const plan=await restaurantEvidencePlan(p,await port.cache(p));await verifyRestaurantResumePlan(p,plan);await save("evidence_plan",plan);
   if(!await port.stage(run,worker,"luna",plan.luna_groups.map(g=>({review_id:g.review_id,request:g.payload,request_sha256:g.request_sha256}))))throw Error("JLS_STAGE_CHANGED");
  }else if(state.run.stage==="luna"){
   const plan=artifact<JlsPlan>(state,"evidence_plan")!,ds=[];
   for(const g of plan.luna_groups){
    const task=state.tasks.find(t=>t.phase==="luna"&&t.review_id===g.review_id)!;
    const a=state.artifacts.find(a=>a.kind==="task:"+task.id);
    if(!a||task.request_count!==1||task.status!=="completed"||task.request_sha256!==g.request_sha256)throw Error("JLS_LUNA_INCOMPLETE");
    const native=await parseJlsLuna(plan,g,a.body.response);
    if(await hybridHash(native.decisions)!==await hybridHash(a.body.decisions))throw Error("JLS_LUNA_NATIVE_CHANGED");
    ds.push(...native.decisions);
   }
   const sol=await restaurantSol(plan,ds);await save("sol_dossier",{...sol,decisions:ds});
   if(!sol.gate.passed||!sol.draft)throw Error("JLS_SOL_EVIDENCE_INSUFFICIENT");
   if(!await port.stage(run,worker,"sol",[{request:sol.draft.request,request_sha256:sol.draft.request_sha256}]))throw Error("JLS_STAGE_CHANGED");
  }else if(!await port.stage(run,worker,"completed",[]))throw Error("JLS_STAGE_CHANGED");
 }catch(e){error=fail(e);}
 finally{await port.release(run,worker,error);}
}
