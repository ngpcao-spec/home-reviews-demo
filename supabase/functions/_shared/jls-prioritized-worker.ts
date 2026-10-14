import { hybridHash } from "./jev-hybrid-evidence.ts";
import { negativeHash } from "./negative-validation-core.ts";
import { validatePrioritizedReport } from "./jev-luna-sol-prioritized-validation.ts";
import type { PrioritizedPreparation, PrioritizedProtocol } from "./jls-prioritized-execution.ts";
import type { JlsPlan, JlsDecision } from "./jev-luna-sol.ts";
import type { PilotSnapshot } from "./jev-pilot-core.ts";
export interface PrioritizedTask {
  id:string;run_id:string;organization_id:string;protocol_id:string;protocol_sha256:string;
  request:unknown;request_sha256:string;status:string;request_count:number;lease_owner:string|null;
  authorization_expires_at:string;
}
export interface PrioritizedExecutionSource {
  plan:JlsPlan;snapshot:PilotSnapshot;preparation:PrioritizedPreparation;
  protocol:{id:string;body:PrioritizedProtocol;sha256:string};decisions:JlsDecision[];
}
export interface PrioritizedExecutionPort {
  claim(run:string,worker:string):Promise<PrioritizedTask|null>;
  finish(task:string,worker:string,status:string,body:PrioritizedExecutionResult,sha:string):Promise<boolean>;
  abort(run:string,error:string):Promise<void>;
}
export interface PrioritizedExecutionResult {
  version:string;protocol_sha256:string;source_plan_sha256:string;decisions_sha256:string;request_sha256:string;
  raw_response_text:string|null;raw_response_sha256:string|null;response:Record<string,unknown>|null;
  response_sha256:string|null;response_id:string|null;provider_request_id:string|null;
  validated_report:Awaited<ReturnType<typeof validatePrioritizedReport>>|null;
  controls:{json_valid:boolean;usage_complete:boolean;model_matches:boolean;report_validation_passed:boolean;error_code:string|null};
  served_model:string|null;input_tokens:number|null;output_tokens:number|null;usage_details:unknown;
  cost_usd:number|null;duration_ms:number;human_validated:false;production_enabled:false;
}
// One raw fetch, no SDK, no fallback, redirect or retry. A claim is committed
// before the HTTP attempt; failed persistence never authorizes another attempt.
export async function processPrioritizedSol(port:PrioritizedExecutionPort,s:PrioritizedExecutionSource,run:string,key:string,http:typeof fetch) {
  if(!key.trim()){await port.abort(run,"OPENAI_API_KEY_UNAVAILABLE");return;}
  const worker=crypto.randomUUID(),task=await port.claim(run,worker);if(!task)return;
  const start=Date.now(),q=s.protocol.body,d=s.preparation.body.draft;
  const out:PrioritizedExecutionResult={version:"jls-prioritized-vi-execution-result-v1",protocol_sha256:s.protocol.sha256,
    source_plan_sha256:q.source_plan_sha256,decisions_sha256:q.decisions_sha256,request_sha256:q.request_sha256,
    raw_response_text:null,raw_response_sha256:null,response:null,response_sha256:null,response_id:null,provider_request_id:null,
    validated_report:null,controls:{json_valid:false,usage_complete:false,model_matches:false,report_validation_passed:false,error_code:null},
    served_model:null,input_tokens:null,output_tokens:null,usage_details:null,cost_usd:null,duration_ms:0,human_validated:false,production_enabled:false};
  let dispatched=false,status="billing_uncertain";
  try{
    if(task.run_id!==run||task.organization_id!==q.organization_id||task.protocol_id!==s.protocol.id||
      task.protocol_sha256!==s.protocol.sha256||task.request_count!==1||task.status!=="running"||task.lease_owner!==worker||
      task.request_sha256!==q.request_sha256||
      !Number.isFinite(Date.parse(task.authorization_expires_at))||Date.parse(task.authorization_expires_at)<=Date.now()||
      await hybridHash(task.request)!==q.request_sha256||await hybridHash(d.request)!==q.request_sha256||
      await hybridHash(q)!==s.protocol.sha256||q.max_sol_calls!==1||q.language!=="vi"||q.requested_model!=="gpt-6.1-sol"||
      q.endpoint!=="/v1/responses"||q.automatic_retry!==false||q.provider_client_retries!==0)throw new Error("JLS_PRI_RESERVED_TASK_CHANGED");
    dispatched=true;
    const response=await http("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},
      body:JSON.stringify(task.request),redirect:"error",signal:AbortSignal.timeout(q.provider_timeout_ms)});
    out.provider_request_id=response.headers.get("x-request-id");
    // Preserve invalid JSON too. Redact only the server secret if echoed by an error.
    const rawText=(await response.text()).replaceAll(key,"[REDACTED_SECRET]");
    out.raw_response_text=rawText;out.raw_response_sha256=await negativeHash(rawText);
    const raw:Record<string,unknown>=JSON.parse(rawText);if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("JLS_PRI_INVALID_PROVIDER_JSON");
    out.response=raw;out.response_sha256=await hybridHash(raw);out.response_id=typeof raw.id==="string"?raw.id:null;
    out.served_model=typeof raw.model==="string"?raw.model:null;out.controls.model_matches=raw.model===q.requested_model;
    const u=raw.usage as Record<string,unknown>|undefined;
    if(u&&Number.isSafeInteger(u.input_tokens)&&Number(u.input_tokens)>0&&Number.isSafeInteger(u.output_tokens)&&Number(u.output_tokens)>=0&&u.total_tokens===Number(u.input_tokens)+Number(u.output_tokens)){
      out.input_tokens=Number(u.input_tokens);out.output_tokens=Number(u.output_tokens);out.usage_details=u;out.controls.usage_complete=true;
      const rates=d.estimates.rates;out.cost_usd=out.controls.model_matches&&rates.sol_input!==null&&rates.sol_output!==null?(out.input_tokens*rates.sol_input+out.output_tokens*rates.sol_output)/1e6:null;
    }
    if(!response.ok)throw new Error("JLS_PRI_PROVIDER_HTTP_"+response.status);
    if(!out.controls.usage_complete)throw new Error("JLS_PRI_USAGE_MISSING_BILLING_UNCERTAIN");
    status="invalid_output";
    if(!out.controls.model_matches)throw new Error("JLS_PRI_SERVED_MODEL_CHANGED");
    if(raw.status!=="completed"||!Array.isArray(raw.output))throw new Error("JLS_PRI_SOL_INCOMPLETE");
    const messages=raw.output.filter((x:unknown)=>!!x&&typeof x==="object"&&(x as {type:string}).type==="message") as {content:{type:string;text?:string}[]}[];
    if(messages.some(m=>!Array.isArray(m.content)))throw new Error("JLS_PRI_INVALID_SOL_MESSAGE");
    const texts=messages.flatMap(m=>m.content.filter(c=>c.type==="output_text").map(c=>c.text??""));
    if(messages.some(m=>m.content.some(c=>c.type==="refusal"))||texts.length!==1)throw new Error("JLS_PRI_SOL_REFUSED_OR_INVALID");
    const report=JSON.parse(texts[0]);out.controls.json_valid=true;
    out.validated_report=await validatePrioritizedReport(report,s.plan,s.snapshot,s.decisions,"vi");
    const r=out.validated_report.report,items=[...r.axes,...r.positive_aspects,...r.negative_aspects,r.conclusion,...r.recommendations];
    out.controls.report_validation_passed=items.every(i=>i.status!=="review_needed");
    status=out.controls.report_validation_passed?"completed":"needs_review";
  }catch(e){if(!dispatched)status="blocked_incompatible";
    out.controls.error_code=e instanceof Error&&/^[A-Z_0-9]+$/.test(e.message)?e.message:
      status==="invalid_output"?"JLS_PRI_REPORT_INVALID":"JLS_PRI_NETWORK_OR_PARSING_BILLING_UNCERTAIN";
  }
  out.duration_ms=Date.now()-start;
  let saved=false;try{saved=await port.finish(task.id,worker,status,out,await hybridHash(out));}catch{ /* Ambiguous save never retries HTTP. */ }
  if(!saved){
    await port.abort(run,"JLS_PRI_RESULT_SAVE_UNCERTAIN_NO_RETRY");throw new Error("JLS_PRI_RESULT_SAVE_UNCERTAIN_NO_RETRY");
  }
}
