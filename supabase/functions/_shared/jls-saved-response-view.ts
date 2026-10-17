// Read-only view of an offline validation. Never reopen a terminal run or dispatch.
import {hybridHash} from "./jev-hybrid-evidence.ts";
import {negativeHash} from "./negative-validation-core.ts";
import type {validateEditorialReport} from "./jls-editorial-validation.ts";
type Json=Record<string,unknown>;
export interface SavedResponseRow {id:string;organization_id:string;body:Json;sha256:string;created_at:string;}
export interface SavedResponseScope {organization_id:string;protocol_id:string;protocol_sha256:string;run_id:string;run_status:string;}
export interface SavedResponseOperation {id:string;organization_id:string;protocol_id:string;run_id:string;receipt:Json;receipt_sha256:string;request_count:number;}
export interface SavedResponseArtifact {id:string;organization_id:string;source_protocol_id:string;source_run_id:string;sha256:string;request_sha256:string;}
export async function savedResponseView(row:SavedResponseRow,scope:SavedResponseScope,op:SavedResponseOperation,a:SavedResponseArtifact){
 if([row,op,a].some(x=>x.organization_id!==scope.organization_id)||op.protocol_id!==scope.protocol_id||op.run_id!==scope.run_id||a.source_protocol_id!==scope.protocol_id||a.source_run_id!==scope.run_id)throw Error("FORBIDDEN");
 const b=row.body,r=b.result as Json,receipt=op.receipt;
 if(b.version!=="jls-saved-response-validation-v1"||await hybridHash(b)!==row.sha256||
  b.source_run_id!==scope.run_id||b.source_operation_id!==op.id||b.source_protocol_sha256!==scope.protocol_sha256||
  b.source_artifact_sha256!==a.sha256||b.source_request_sha256!==a.request_sha256||
  b.source_receipt_sha256!==op.receipt_sha256||await hybridHash(receipt)!==op.receipt_sha256||
  b.source_raw_response_sha256!==receipt.raw_response_sha256||typeof receipt.raw_response_text!=="string"||
  await negativeHash(receipt.raw_response_text)!==receipt.raw_response_sha256||receipt.request_sha256!==a.request_sha256||
  op.request_count!==1||b.provider_calls!==0||b.human_validated!==false||b.new_paid_run!==false||b.new_consent!==false||
  !["completed","needs_review"].includes(String(b.validation_status))||!r||!r.validated_report||
  await hybridHash(r)!==b.result_sha256||r.raw_response_text!==receipt.raw_response_text||r.receipt_sha256!==op.receipt_sha256)
  throw Error("JLS_SAVED_RESPONSE_CHANGED");
 const native=JSON.parse(receipt.raw_response_text);
 if(r.response_sha256!==await hybridHash(native)||await hybridHash(r.response)!==await hybridHash(native)||
  r.served_model!==native.model||await hybridHash(r.usage)!==await hybridHash(native.usage)||native.model!=="gpt-6.1-sol")throw Error("JLS_SAVED_RESPONSE_CHANGED");
 return {id:row.id,sha256:row.sha256,created_at:row.created_at,run_id:scope.run_id,run_status:scope.run_status,operation_id:op.id,
  validation_status:String(b.validation_status),validator_version:String(r.validator_version),validator_code_provenance:String(b.validator_code_provenance),
  source_receipt_sha256:op.receipt_sha256,result_sha256:String(b.result_sha256),human_validated:false,provider_calls:0,
  result:{validated_report:r.validated_report as Awaited<ReturnType<typeof validateEditorialReport>>,input_tokens:Number(r.input_tokens),output_tokens:Number(r.output_tokens),duration_ms:Number(r.duration_ms),served_model:String(r.served_model)}};
}
export type SavedResponseView=Awaited<ReturnType<typeof savedResponseView>>;
