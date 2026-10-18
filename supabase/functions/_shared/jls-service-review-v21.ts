// Free, explicit evaluation of unchanged saved content. No provider capability.
import {validateReadyReceipt,type ReadyState} from "./jls-sol-ready-worker.ts";
import {snapshotReadyContract,type SnapshotSolArtifact} from "./jls-snapshot-v2.ts";
import {nativeSolReport} from "./jls-recommendation-review-v2.ts";
import {buildRecommendationDraftV21,validateRecommendationReportV21,CONTRACT_V21,VALIDATOR_V21} from "./jls-recommendation-contract-v21.ts";
import {futureServiceCandidates,futureServiceQuestions,beverageDelaySpan,beverageActionIsDelay,SERVICE_BOUNDARIES_V21} from "./jls-service-boundaries-v21.ts";
import {acceptedJlsEvidence} from "./jev-luna-sol.ts";
import {hybridHash} from "./jev-hybrid-evidence.ts";
import type {EconomyCache} from "./jev-economy-cache.ts";
import type {SavedResponseRow,SavedResponseView} from "./jls-saved-response-view.ts";
export const SERVICE_REVIEW_V21="jls-reservation-beverage-review-v2.1";
// Only validation metadata can differ; every word, source and frequency stays.
function reportContent(value:unknown):unknown{
 if(Array.isArray(value))return value.map(reportContent);
 if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).filter(([key])=>!["status","visible","reasons"].includes(key)).map(([key,v])=>[key,reportContent(v)]));
 return value;
}
export async function buildServiceReviewV21(s:ReadyState,source:SavedResponseRow,cache:EconomyCache[],code:string){
 const p=await snapshotReadyContract.verify(s),a=s.ready.body as unknown as SnapshotSolArtifact;
 const replay=await validateReadyReceipt(s,s.operation,p,snapshotReadyContract),o=replay.out;
 if(s.operation.mode!=="paid"||s.operation.status!=="blocked"||source.organization_id!==s.operation.organization_id||
  await hybridHash(source.body)!==source.sha256||source.body.source_run_id!==s.operation.run_id||source.body.source_operation_id!==s.operation.id||
  source.body.version!=="jls-saved-response-validation-v2"||source.body.result_sha256!==await hybridHash(o)||!/^[a-f0-9]{40}$/.test(code))throw Error("JLS_SERVICE_REVIEW_SOURCE_CHANGED");
 const raw=nativeSolReport(o),before=await hybridHash(raw),snapshot=s.protocol.body.snapshot;
 const future=await buildRecommendationDraftV21(p,a.decisions,"vi"),validation=await validateRecommendationReportV21(raw,p,snapshot,a.decisions,"vi",future);
 if(await hybridHash(raw)!==before||validation.raw_response_sha256!==before)throw Error("JLS_SERVICE_REVIEW_CONTENT_CHANGED");
 const selected=acceptedJlsEvidence(p,a.decisions),futureCandidates=await futureServiceCandidates(snapshot,cache);
 const previous=o.validated_report as typeof validation;
 const waiting=raw.report.recommendations.filter((r:{proposed_action:{text:string}})=>beverageActionIsDelay(r.proposed_action.text));
 const relevantIds=new Set<string>(waiting.flatMap((r:{evidence_ids:string[]})=>r.evidence_ids.map(id=>p.selected.find(e=>e.evidence_id===id)?.review_id).filter(Boolean)));
 const compatible=selected.filter(e=>relevantIds.has(e.review_id)&&e.theme_key==="wait_time"&&e.polarity==="negative"&&beverageDelaySpan(e.quote));
 const candidates=futureCandidates.candidates.filter(e=>relevantIds.has(e.review_id)&&e.theme_key==="wait_time"&&e.polarity==="negative"&&beverageDelaySpan(e.quote));
 const changes=validation.report.recommendations.map((r,i)=>({index:i,rank:r.priority.rank,title:r.title,
  old_status:previous.report.recommendations[i].status,old_visible:previous.report.recommendations[i].visible,
  new_status:r.status,new_visible:r.visible,reasons:r.reasons}));
 const body={version:SERVICE_REVIEW_V21,source_run_id:s.operation.run_id,source_operation_id:s.operation.id,
  source_protocol_id:s.protocol.id,source_protocol_sha256:s.protocol.sha256,source_artifact_sha256:s.ready.sha256,
  source_saved_validation_id:source.id,source_saved_validation_sha256:source.sha256,source_result_sha256:source.body.result_sha256,
  source_receipt_sha256:s.operation.receipt_sha256,source_report_sha256:before,source_decisions_sha256:a.decisions_sha256,
  source_prompt_sha256:a.sol.draft.prompt_sha256,code_provenance:code,validator_version:VALIDATOR_V21,
  content_unchanged:true,kind:"new_validator_on_unchanged_saved_sol_content_not_new_sol_output",changes,
  validation,validation_sha256:await hybridHash(validation),compatible_accepted_beverage_wait_ids:compatible.map(e=>e.evidence_id),
  missing_beverage_wait_proof:compatible.length===0,candidates:candidates.map(e=>({...e,luna_verdict:null,requires_new_luna_verification:true})),
  future_preparation:{contract:CONTRACT_V21,selector:SERVICE_BOUNDARIES_V21,prompt_sha256:future.prompt_sha256,schema_sha256:future.schema_sha256,
   configuration_sha256:future.config_sha256,request_sha256:future.request_sha256,dossier_sha256:future.dossier_sha256,
   request:future.request,measurement:future.measurement,questions:await futureServiceQuestions(p),requires_new_protocol:true,paid_enabled:false},
  provider_calls:0,new_consent:false,new_paid_run:false,production_enabled:false,human_validated:false,semantic_truth_guaranteed:false};
 return {body,sha256:await hybridHash(body)};
}
export async function serviceReviewView(row:SavedResponseRow,source:SavedResponseView,organizationId:string){
 const b=row.body,v=b.validation as Awaited<ReturnType<typeof validateRecommendationReportV21>>;
 if(row.organization_id!==organizationId)throw Error("FORBIDDEN");
 if(await hybridHash(b)!==row.sha256||b.version!==SERVICE_REVIEW_V21||b.source_run_id!==source.run_id||b.source_operation_id!==source.operation_id||
  b.source_saved_validation_id!==source.id||b.source_saved_validation_sha256!==source.sha256||b.source_result_sha256!==source.result_sha256||
  b.source_receipt_sha256!==source.source_receipt_sha256||b.provider_calls!==0||b.content_unchanged!==true||b.new_consent!==false||b.new_paid_run!==false||b.human_validated!==false||
  !v||v.validator_version!==VALIDATOR_V21||await hybridHash(v)!==b.validation_sha256||
  v.raw_response_sha256!==source.result.validated_report.raw_response_sha256||b.source_report_sha256!==v.raw_response_sha256||
  v.statistics_sha256!==source.result.validated_report.statistics_sha256||v.decisions_sha256!==source.result.validated_report.decisions_sha256||
  await hybridHash(reportContent(v.report))!==await hybridHash(reportContent(source.result.validated_report.report)))throw Error("JLS_SERVICE_REVIEW_CHANGED");
 return {id:row.id,sha256:row.sha256,version:SERVICE_REVIEW_V21,code_provenance:String(b.code_provenance),source_saved_validation_id:source.id,
  content_unchanged:true,validation:v,changes:b.changes as Awaited<ReturnType<typeof buildServiceReviewV21>>["body"]["changes"],
  compatible_accepted_beverage_wait_ids:b.compatible_accepted_beverage_wait_ids as string[],missing_beverage_wait_proof:b.missing_beverage_wait_proof===true,
  candidates:b.candidates as Awaited<ReturnType<typeof buildServiceReviewV21>>["body"]["candidates"],
  future_preparation:{contract:CONTRACT_V21,prompt_sha256:String((b.future_preparation as Record<string,unknown>).prompt_sha256),requires_new_protocol:true},provider_calls:0,human_validated:false};
}
export type ServiceReviewView=Awaited<ReturnType<typeof serviceReviewView>>;
