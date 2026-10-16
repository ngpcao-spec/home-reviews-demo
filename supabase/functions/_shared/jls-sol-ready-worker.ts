// One stage per wake: persist raw receipt, then validate in a separate invocation.
import {verifySolReadyProtocol,verifySolReadyArtifact,SOL_READY_POLICY,type SolReadyRow} from "./jls-sol-ready.ts";
import type {RestaurantProtocol} from "./jls-restaurant.ts";
import {validateEditorialReport} from "./jls-editorial-validation.ts";
import {hybridHash} from "./jev-hybrid-evidence.ts";
import {negativeHash} from "./negative-validation-core.ts";
import {planTokenMemo} from "./jls-token-memo.ts";
export interface ReadyOperation {id:string;organization_id:string;artifact_id?:string;mode:"mock"|"paid";run_id:string|null;phase:"sol"|"validate_sol";
 status:string;request_count:number;worker:string|null;receipt:ReadyReceipt|null;receipt_sha256:string|null;result:Record<string,unknown>|null;}
export interface ReadyReceipt {version:string;request_sha256:string;request_raw_sha256:string;http_status:number|null;provider_request_id:string|null;
 raw_response_text:string|null;raw_response_sha256:string|null;duration_ms:number;error_code:string|null;mock:boolean;}
export interface ReadyState {operation:ReadyOperation;protocol:{id:string;body:RestaurantProtocol;sha256:string};ready:SolReadyRow}
export interface ReadyPort {
 load(id:string):Promise<ReadyState>;active(s:ReadyState):Promise<void>;compatible(s:ReadyState):Promise<boolean>;
 claim(id:string,worker:string):Promise<ReadyOperation|null>;
 receive(id:string,worker:string,receipt:ReadyReceipt,sha:string):Promise<boolean>;
 finish(id:string,worker:string,status:string,result:Record<string,unknown>,sha:string):Promise<boolean>;
 abort(id:string,worker:string,error:string):Promise<void>;
}
// Optional versioned contract adapter. Historical callers keep the original path.
export interface ReadyContract {
 verify(s:ReadyState):Promise<import("./jev-luna-sol.ts").JlsPlan>;
 validate(raw:unknown,s:ReadyState,plan:import("./jev-luna-sol.ts").JlsPlan):Promise<Awaited<ReturnType<typeof validateEditorialReport>>>;
}
const terminal=new Set(["completed","needs_review","invalid_output","blocked","billing_uncertain","authorization_expired"]);
const code=(e:unknown)=>e instanceof Error&&/^[A-Z_0-9]+$/.test(e.message)?e.message:"JLS_SOL_READY_BILLING_UNCERTAIN";
export async function processReadySol(port:ReadyPort,id:string,key:string,http:typeof fetch,contract?:ReadyContract){
 const worker=crypto.randomUUID();let claimed=false,phase="",sent=false,mock=false;
 try{
  const s=await port.load(id);mock=s.operation.mode==="mock";if(terminal.has(s.operation.status))return {phase:"already_recorded",provider_calls:0};
  await port.active(s);
  let plan;
  if(contract)plan=await contract.verify(s);
  else {await verifySolReadyProtocol(s.protocol.body,s.protocol.sha256);plan=await verifySolReadyArtifact(s.protocol.body,s.ready);}
  if(!await port.compatible(s))throw Error("JLS_SOL_READY_REUSED_SOURCE_CHANGED");
  if(s.operation.phase==="sol"&&!key.trim())throw Error("JLS_SOL_READY_KEY_UNAVAILABLE");
  const op=await port.claim(id,worker);if(!op)return {phase:"concurrent_or_consumed",provider_calls:0};
  claimed=true;phase=op.phase;
  if(op.phase==="sol"){
   if(op.request_count!==1||op.worker!==worker||op.status!=="dispatched"||op.mode!==s.operation.mode)throw Error("JLS_SOL_READY_RESERVED_ATTEMPT_CHANGED");
   const a=s.ready.body,at=Date.now();let raw:string|null=null,receipt:ReadyReceipt;
   try{
    sent=true;
    const response=await http("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},
     body:a.request_json,redirect:"error",signal:AbortSignal.timeout(s.protocol.body.sol_size_policy!.provider_timeout_ms)});
    raw=(await response.text()).replaceAll(key,"[REDACTED_SECRET]");
    receipt={version:"jls-sol-raw-receipt-v1",request_sha256:a.request_sha256,request_raw_sha256:a.request_raw_sha256,
     http_status:response.status,provider_request_id:response.headers.get("x-request-id"),raw_response_text:raw,
     raw_response_sha256:await negativeHash(raw),duration_ms:Date.now()-at,error_code:null,mock:op.mode==="mock"};
    if(new TextEncoder().encode(raw).length>SOL_READY_POLICY.max_response_bytes)receipt.error_code="JLS_SOL_RESPONSE_BYTES_EXCEEDED";
   }catch(e){receipt={version:"jls-sol-raw-receipt-v1",request_sha256:a.request_sha256,request_raw_sha256:a.request_raw_sha256,http_status:null,
    provider_request_id:null,raw_response_text:raw,raw_response_sha256:raw===null?null:await negativeHash(raw),duration_ms:Date.now()-at,
    error_code:code(e),mock:op.mode==="mock"};}
   if(!await port.receive(id,worker,receipt,await hybridHash(receipt)))throw Error("JLS_SOL_RECEIPT_SAVE_UNCERTAIN_NO_RETRY");
   return {phase:"raw_receipt_saved",provider_calls:mock?0:1,mock_http_calls:mock?1:0,tokenizer_misses:planTokenMemo(plan)!.misses};
  }
  const receipt=op.receipt;
  if(op.request_count!==1||!receipt||!op.receipt_sha256||await hybridHash(receipt)!==op.receipt_sha256||
   receipt.raw_response_text===null||await negativeHash(receipt.raw_response_text)!==receipt.raw_response_sha256||
   receipt.request_sha256!==s.ready.body.request_sha256||receipt.request_raw_sha256!==s.ready.body.request_raw_sha256)throw Error("JLS_SOL_RECEIPT_CHANGED");
  const out:Record<string,unknown>={phase:"sol",request_sha256:receipt.request_sha256,raw_response_text:receipt.raw_response_text,
   raw_response_sha256:receipt.raw_response_sha256,response:null,response_sha256:null,response_id:null,provider_request_id:receipt.provider_request_id,
   served_model:null,input_tokens:null,output_tokens:null,usage:null,cost_usd:null,duration_ms:receipt.duration_ms,error_code:null,
   raw_saved_before_validation:true,calculated_not_verified_invoice:true,human_validated:false,production_enabled:false};
  let status="invalid_output";
  try{
   if(receipt.error_code)throw Error(receipt.error_code);
   const raw=JSON.parse(receipt.raw_response_text);
   out.response=raw;out.response_sha256=await hybridHash(raw);out.response_id=raw.id??null;out.served_model=raw.model??null;
   const u=raw.usage;
   if(u&&Number.isSafeInteger(u.input_tokens)&&u.input_tokens>0&&Number.isSafeInteger(u.output_tokens)&&u.output_tokens>=0&&
    (u.total_tokens===undefined||u.total_tokens===u.input_tokens+u.output_tokens)){out.input_tokens=u.input_tokens;out.output_tokens=u.output_tokens;out.usage=u;}
   else {status="billing_uncertain";throw Error("JLS_USAGE_MISSING_BILLING_UNCERTAIN");}
   if(receipt.http_status===null||receipt.http_status<200||receipt.http_status>=300)throw Error("JLS_PROVIDER_HTTP_"+receipt.http_status);
   if(raw.model!=="gpt-6.1-sol"||raw.status!=="completed"||!Array.isArray(raw.output))throw Error("JLS_SOL_MODEL_OR_OUTPUT_INVALID");
   const content=raw.output.filter((x:{type:string})=>x.type==="message").flatMap((x:{content:unknown[]})=>x.content);
   if(content.some((x:{type:string})=>x.type==="refusal"))throw Error("JLS_SOL_REFUSED");
   const texts=content.filter((x:{type:string})=>x.type==="output_text");if(texts.length!==1)throw Error("JLS_SOL_OUTPUT_INVALID");
   const validated=contract?await contract.validate(JSON.parse(texts[0].text),s,plan):
    await validateEditorialReport(JSON.parse(texts[0].text),plan,s.protocol.body.snapshot,s.ready.body.decisions,"vi");
   out.validated_report=validated;out.validator_version=validated.validator_version;
   const r=validated.report,items=[...r.axes,...r.positive_aspects,...r.negative_aspects,r.conclusion,...r.recommendations];
   status=items.some(x=>x.status==="review_needed")?"needs_review":"completed";
   if(status==="needs_review")out.error_code="JLS_REPORT_NEEDS_REVIEW";
  }catch(e){out.error_code=code(e);}
  out.receipt_sha256=op.receipt_sha256;
  if(!await port.finish(id,worker,status,out,await hybridHash(out)))throw Error("JLS_SOL_VALIDATION_SAVE_UNCERTAIN_NO_RETRY");
  return {phase:"validation_saved",provider_calls:0,tokenizer_misses:planTokenMemo(plan)!.misses,status};
 }catch(e){await port.abort(id,worker,code(e));return {phase,provider_calls:sent&&!mock?1:0,mock_http_calls:sent&&mock?1:0,error_code:code(e),claimed};}
}
