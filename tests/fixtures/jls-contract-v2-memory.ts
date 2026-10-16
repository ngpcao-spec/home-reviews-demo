// Explicit in-memory transport/store; never a source of AI reference annotations.
import {canonicalJson} from "../../supabase/functions/_shared/jev-exploratory-core.ts";
import {contractTechnicalResponse} from "../../supabase/functions/_shared/jls-contract-v2-probe.ts";
import type {ContractPort,ContractState} from "../../supabase/functions/_shared/jls-contract-v2-worker.ts";
export function contractMemoryFixture(initial:ContractState,variant:"ACCEPTED"|"REJECTED"|"UNCERTAIN"){
 const state=structuredClone(initial);let leased=false,allowed=true,compatible=true;
 const calls:string[]=[];
 const port:ContractPort={load:async()=>JSON.parse(canonicalJson(state)),active:async()=>{if(!allowed)throw Error("JLS_V2_NEW_GO_REQUIRED");},compatible:async()=>compatible,
 claim:async(_id,w)=>{const o=state.operation;if(leased||!["queued","received","dispatched","validating"].includes(o.status))return null;
  if(o.phase==="luna"&&o.luna_count||o.phase==="sol"&&o.sol_count){o.status="billing_uncertain";return null;}
  leased=true;o.worker=w;o.status=o.phase.startsWith("validate_")?"validating":"dispatched";
  if(o.phase==="luna")o.luna_count=1;if(o.phase==="sol")o.sol_count=1;return structuredClone(o);},
 receive:async(_id,_w,phase,b,sha)=>{const o=state.operation;if(phase==="luna"){o.luna_receipt=b;o.luna_receipt_sha256=sha;o.phase="validate_luna";}
  else{o.sol_receipt=b;o.sol_receipt_sha256=sha;o.phase="validate_sol";}o.status=b.raw_response_text===null?"billing_uncertain":"received";o.worker=null;leased=false;return true;},
 finishLuna:async(_id,_w,b,sha)=>{state.operation.luna_result=b as ContractState["operation"]["luna_result"];state.operation.luna_result_sha256=sha;state.operation.phase="sol";state.operation.status="queued";leased=false;return true;},
 finishSol:async(_id,_w,status,b)=>{state.operation.result=b;state.operation.status=status;leased=false;return true;},
 abort:async(_id,w)=>{const o=state.operation;if(o.worker&&o.worker!==w||!["queued","received","dispatched","validating"].includes(o.status))return;
  o.status=o.phase==="luna"&&o.luna_count||o.phase==="sol"&&o.sol_count?"billing_uncertain":"blocked";o.worker=null;leased=false;}
 };
 const http:typeof fetch=async(url,options)=>{
  if(!leased||state.operation.status!=="dispatched")throw Error("MOCK_NOT_RESERVED");
  const phase=state.operation.phase,actual=phase==="sol"?state.operation.luna_result!.decisions[0].status:variant,
   wire=phase==="luna"?state.protocol.body.luna_request_json:state.protocol.body.branches.find(b=>b.assumption===actual)!.request_json;
  if(options?.body!==wire||String(url)!==(phase==="luna"?"https://api.openai.com/v1/decisions":"https://api.openai.com/v1/responses"))throw Error("MOCK_WIRE_CHANGED");
  calls.push(phase);return new Response(JSON.stringify(contractTechnicalResponse(state,actual)),{headers:{"x-request-id":"explicit_mock"}});
 };
 return {state,port,http,calls,deny:()=>{allowed=false;},incompatible:()=>{compatible=false;},interrupt:()=>{leased=false;state.operation.worker=null;}};
}
