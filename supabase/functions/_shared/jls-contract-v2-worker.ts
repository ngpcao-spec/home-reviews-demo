// Small orchestration layer over the existing durable Sol worker and Luna parser.
import {processReadySol,type ReadyPort,type ReadyState,type ReadyReceipt} from "./jls-sol-ready-worker.ts";
import {verifyContractV2,contractBranch,contractNativeDecision,type ContractV2Row,type ContractSource} from "./jls-contract-v2-preparation.ts";
import {validateRecommendationReportV2} from "./jls-recommendation-contract-v2.ts";
import {hybridHash} from "./jev-hybrid-evidence.ts";
import {negativeHash} from "./negative-validation-core.ts";
import type {JlsDecision} from "./jev-luna-sol.ts";
export interface ContractOperation {id:string;mode:"mock"|"paid";phase:"luna"|"validate_luna"|"sol"|"validate_sol";status:string;
 luna_count:number;sol_count:number;worker:string|null;luna_receipt:ReadyReceipt|null;luna_receipt_sha256:string|null;
 luna_result:{decisions:JlsDecision[];[key:string]:unknown}|null;luna_result_sha256?:string|null;sol_receipt:ReadyReceipt|null;sol_receipt_sha256:string|null;
 result:Record<string,unknown>|null;}
export interface ContractState {operation:ContractOperation;protocol:ContractV2Row;source:ContractSource}
export interface ContractPort {load(id:string):Promise<ContractState>;active(s:ContractState):Promise<void>;compatible(s:ContractState):Promise<boolean>;
 claim(id:string,worker:string):Promise<ContractOperation|null>;
 receive(id:string,worker:string,phase:"luna"|"sol",body:ReadyReceipt,sha:string):Promise<boolean>;
 finishLuna(id:string,worker:string,body:Record<string,unknown>,sha:string,branch:string):Promise<boolean>;
 finishSol(id:string,worker:string,status:string,body:Record<string,unknown>,sha:string):Promise<boolean>;
 abort(id:string,worker:string,error:string):Promise<void>;
}
const terminal=new Set(["completed","needs_review","invalid_output","blocked","billing_uncertain","authorization_expired"]);
const errorCode=(e:unknown)=>e instanceof Error&&/^[A-Z_0-9]+$/.test(e.message)?e.message:"JLS_V2_UNCERTAIN_NO_RETRY";
function readyOperation(o:ContractOperation){return {id:o.id,organization_id:"",mode:o.mode,run_id:null,
 phase:o.phase as "sol"|"validate_sol",status:o.status,request_count:o.sol_count,worker:o.worker,
 receipt:o.sol_receipt,receipt_sha256:o.sol_receipt_sha256,result:o.result};}
export async function processContractV2(port:ContractPort,id:string,key:string,http:typeof fetch){
 let worker="",claimed=false,sent=false,mock=false,phase="";
 try{
  const s=await port.load(id),o=s.operation;mock=o.mode==="mock";phase=o.phase;
  if(terminal.has(o.status))return {phase:"already_recorded",provider_calls:0};
  const p=s.protocol.body;
  if(o.phase==="sol"||o.phase==="validate_sol"){
   const state=s;let prepared:Awaited<ReturnType<typeof contractBranch>>;
   const asReady=async(x:ContractState):Promise<ReadyState>=>{
    if(!x.operation.luna_result||x.operation.luna_result.decisions.length!==1)throw Error("JLS_V2_LUNA_RESULT_MISSING");
    const receipt=x.operation.luna_receipt;
    if(!receipt?.raw_response_text||await hybridHash(receipt)!==x.operation.luna_receipt_sha256||
     await negativeHash(receipt.raw_response_text)!==receipt.raw_response_sha256||receipt.request_sha256!==p.luna_group.request_sha256||
     x.operation.luna_result_sha256&&await hybridHash(x.operation.luna_result)!==x.operation.luna_result_sha256)throw Error("JLS_V2_LUNA_RECEIPT_CHANGED");
    const native=await contractNativeDecision(p,JSON.parse(receipt.raw_response_text));
    if(await hybridHash(native.decisions)!==await hybridHash(x.operation.luna_result.decisions))throw Error("JLS_V2_NATIVE_DECISION_CHANGED");
    const b=await contractBranch(x.protocol,x.source,x.operation.luna_result.decisions[0]);prepared=b;
    if(!b.branch.gate.passed)throw Error("JLS_SOL_EVIDENCE_INSUFFICIENT");
    // Internal adapter only; the original source protocol/artifact are never written.
    return {operation:{...readyOperation(x.operation),organization_id:x.protocol.body.organization_id},protocol:x.source.protocol,
     ready:{sha256:b.branch.sha256,body:{...x.source.artifact.body,plan:b.plan,decisions:b.decisions,
      request_json:b.branch.request_json,request_sha256:b.draft.request_sha256,request_raw_sha256:b.branch.request_raw_sha256,
      measurement:b.draft.measurement,sol:{gate:{...b.branch.gate,policy:p.configuration.sufficiency,human_validated:false},draft:b.draft} as unknown as ReadyState["ready"]["body"]["sol"]}}};
   };
   const readyPort:ReadyPort={load:()=>asReady(state),
    active:async()=>{await port.active(state);await verifyContractV2(state.protocol,state.source);},compatible:()=>port.compatible(state),
    claim:async(_id,w)=>{const next=await port.claim(id,w);return next?{...readyOperation(next),organization_id:p.organization_id}:null;},
    receive:(_id,w,b,sha)=>port.receive(id,w,"sol",b,sha),finish:(_id,w,status,b,sha)=>port.finishSol(id,w,status,b,sha),abort:port.abort};
   return processReadySol(readyPort,id,key,http,{
    verify:()=>Promise.resolve(prepared.plan),
    validate:(raw,_ready,plan)=>validateRecommendationReportV2(raw,plan,state.source.protocol.body.snapshot,prepared.decisions,"vi",prepared.draft)
   });
  }
  await port.active(s);await verifyContractV2(s.protocol,s.source);
  if(!await port.compatible(s))throw Error("JLS_V2_REUSED_SOURCE_CHANGED");
  if(o.phase==="luna"&&!key.trim())throw Error("JLS_V2_KEY_UNAVAILABLE");
  worker=crypto.randomUUID();const op=await port.claim(id,worker);if(!op)return {phase:"concurrent_or_consumed",provider_calls:0};claimed=true;
  if(op.phase==="luna"){
   if(op.luna_count!==1||op.sol_count!==0||op.status!=="dispatched"||op.worker!==worker)throw Error("JLS_V2_RESERVED_ATTEMPT_CHANGED");
   const start=Date.now();let receipt:ReadyReceipt;
   try{sent=true;const response=await http("https://api.openai.com/v1/decisions",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},
    body:p.luna_request_json,redirect:"error",signal:AbortSignal.timeout(110000)});
    const text=(await response.text()).replaceAll(key,"[REDACTED_SECRET]");
    receipt={version:"jls-v2-luna-raw-receipt-v1",request_sha256:p.luna_group.request_sha256,request_raw_sha256:p.luna_request_raw_sha256,
     raw_response_text:text,raw_response_sha256:await negativeHash(text),http_status:response.status,provider_request_id:response.headers.get("x-request-id"),
     duration_ms:Date.now()-start,error_code:new TextEncoder().encode(text).length>1048576?"JLS_LUNA_RESPONSE_BYTES_EXCEEDED":null,mock};
   }catch(e){receipt={version:"jls-v2-luna-raw-receipt-v1",request_sha256:p.luna_group.request_sha256,request_raw_sha256:p.luna_request_raw_sha256,
    raw_response_text:null,raw_response_sha256:null,http_status:null,provider_request_id:null,duration_ms:Date.now()-start,error_code:errorCode(e),mock};}
   if(!await port.receive(id,worker,"luna",receipt,await hybridHash(receipt)))throw Error("JLS_V2_RECEIPT_SAVE_UNCERTAIN_NO_RETRY");
   return {phase:"luna_raw_saved",provider_calls:mock?0:1,mock_http_calls:mock?1:0};
  }
  const receipt=op.luna_receipt;
  if(op.luna_count!==1||!receipt||await hybridHash(receipt)!==op.luna_receipt_sha256||receipt.raw_response_text===null||
   await negativeHash(receipt.raw_response_text)!==receipt.raw_response_sha256||receipt.request_sha256!==p.luna_group.request_sha256||
   receipt.request_raw_sha256!==p.luna_request_raw_sha256)throw Error("JLS_V2_LUNA_RECEIPT_CHANGED");
  if(receipt.error_code||receipt.http_status!==200)throw Error(receipt.error_code??"JLS_LUNA_PROVIDER_HTTP_ERROR");
  const raw=JSON.parse(receipt.raw_response_text),native=await contractNativeDecision(p,raw);
  const u=native.usage;if(!u||!Number.isSafeInteger(u.input_tokens)||u.input_tokens<1||!Number.isSafeInteger(u.output_tokens)||u.output_tokens<0)throw Error("JLS_USAGE_MISSING_BILLING_UNCERTAIN");
  const b=await contractBranch(s.protocol,s.source,native.decisions[0]);
  const result={...native,raw_response_sha256:receipt.raw_response_sha256,receipt_sha256:op.luna_receipt_sha256,request_sha256:p.luna_group.request_sha256,
   branch:native.decisions[0].status,sol_gate:b.branch.gate,probabilities_preserved:true,calculated_not_verified_invoice:true};
  if(!await port.finishLuna(id,worker,result,await hybridHash(result),native.decisions[0].status))throw Error("JLS_V2_LUNA_SAVE_UNCERTAIN_NO_RETRY");
  return {phase:"luna_validation_saved",provider_calls:0,branch:native.decisions[0].status,gate:b.branch.gate.passed};
 }catch(e){if(worker||!claimed)await port.abort(id,worker,errorCode(e));
  return {phase,error_code:errorCode(e),provider_calls:sent&&!mock?1:0,mock_http_calls:sent&&mock?1:0};}
}
