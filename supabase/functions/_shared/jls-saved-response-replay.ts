// Explicit free replay. No fetch, credentials, dispatch, consent or run port.
import {validateReadyReceipt,type ReadyContract,type ReadyState} from "./jls-sol-ready-worker.ts";
import {hybridHash} from "./jev-hybrid-evidence.ts";
export const SAVED_REPLAY_V2="jls-saved-response-validation-v2";
export const FINALIZATION_V2="jls-received-finalization-v2";
export async function replaySavedResponse(s:ReadyState,contract:ReadyContract,source:{id:string;sha256:string},code:string){
 if(s.operation.status!=="blocked"||s.operation.phase!=="validate_sol"||s.operation.mode!=="paid"||s.operation.request_count!==1||
  !s.operation.run_id||!s.operation.receipt||!/^[a-f0-9]{40}$/.test(code)||!/^[a-f0-9]{64}$/.test(source.sha256))throw Error("JLS_OFFLINE_REPLAY_SCOPE_INVALID");
 const plan=await contract.verify(s),{out,status}=await validateReadyReceipt(s,s.operation,plan,contract);
 const body={version:SAVED_REPLAY_V2,source_run_id:s.operation.run_id,source_operation_id:s.operation.id,
  source_operation_historical_status:s.operation.status,source_receipt_sha256:s.operation.receipt_sha256,
  source_raw_response_sha256:s.operation.receipt.raw_response_sha256,source_request_sha256:s.ready.body.request_sha256,
  source_artifact_sha256:s.ready.sha256,source_protocol_sha256:s.protocol.sha256,
  source_original_validation_id:source.id,source_original_validation_sha256:source.sha256,
  validator_code_provenance:code,finalization_version:FINALIZATION_V2,
  provenance:"explicit offline replay of unchanged saved Sol receipt; no transport; historical run and first validation preserved",
  human_validated:false,production_enabled:false,provider_calls:0,new_consent:false,new_paid_run:false,
  validation_status:status,result:out,result_sha256:await hybridHash(out)};
 return {body,sha256:await hybridHash(body)};
}
