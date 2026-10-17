// Existing V12/Luna/V2 components, bound to the exact historical snapshot.
// Expensive preparation is performed offline, between durable provider stages.
import {prepareRestaurantInputs,restaurantConfiguration,restaurantEvidencePlan,restaurantConsent,verifyRestaurantSnapshot,type RestaurantProtocol} from "./jls-restaurant.ts";
import {pilotSourceHash,type PilotSnapshot,type PilotReview} from "./jev-pilot-core.ts";
import {ECONOMY_CONFIG} from "./jev-economy-config.ts";
import {hybridHash} from "./jev-hybrid-evidence.ts";
import {negativeHash} from "./negative-validation-core.ts";
import {normalizeCategoryRatings} from "./cross-rating-analysis.ts";
import {futureRecommendationCandidates,ORDER_SELECTOR_VERSION} from "./jls-order-evidence-v2.ts";
import {RECOMMENDATION_VERSION,RECOMMENDATION_CONFIG,recommendationInstructionsV2,recommendationSchemaV2,buildRecommendationDraftV2,validateRecommendationReportV2} from "./jls-recommendation-contract-v2.ts";
import {SOL_SIZE_POLICY,solRequestSize} from "./jls-sol-size.ts";
import {contractEvidenceGate} from "./jls-contract-v2-preparation.ts";
import {acceptedJlsEvidence,type JlsPlan} from "./jev-luna-sol.ts";
import {normalizedPlan} from "./jls-restaurant-prepared.ts";
import {attachPlanTokenMemo,planTokenMemo} from "./jls-token-memo.ts";
import {restaurantNativeDecisions,type RestaurantExecutionContract,type RestaurantState} from "./jls-restaurant-worker.ts";
import type {SolReadyArtifact,SolReadyRow} from "./jls-sol-ready.ts";
import type {ReadyContract} from "./jls-sol-ready-worker.ts";
export const SNAPSHOT_V2="jls-historical-snapshot-v2-vi-v1";
export const CHILL="a9a6ec1c-cbb3-4e39-a498-86f2e68bd4b8";
export const CHILL_RUN="39556285-21ee-4962-9892-da3b4f0e8ca3";
export const CHILL_FINGERPRINT="5642ee929cce9504e5c21292b5b8b5fbb6f762181c57f918c999760948ba767f";
type FrozenReview=Record<string,unknown>&{id:string;rating:number;original_text:string|null;analysis_text:string;analysis_language:string|null;analysis_source:string;original_language:string|null;published_at:string|null;review_detailed_rating:unknown;review_context:unknown};
export interface FrozenHistorical {id:string;generation_id:string;organization_id:string;establishment_id:string;requested_by:string;created_at:string;language:string;status:string;
 snapshot:{analysis_version:number;reviews:FrozenReview[];base:Record<string,unknown>;publication:Record<string,unknown>};[key:string]:unknown;}
const historicalOrder=["id","rating","original_text","text","published_at","historical_import","has_negative_feedback","status","review_detailed_rating","review_context","ready","original_language","analysis_text","analysis_language","analysis_source","analysis_translation_override"];
export async function historicalSnapshotFingerprint(s:FrozenHistorical["snapshot"]){
 if(s.reviews.some(r=>Object.keys(r).some(k=>!historicalOrder.includes(k))))throw Error("JLS_FROZEN_REVIEW_SCHEMA_CHANGED");
 const reviews=s.reviews.map(r=>Object.fromEntries(historicalOrder.filter(k=>k in r).map(k=>[k,r[k]])));
 return negativeHash(JSON.stringify({reviews,language:"vi",googleTotal:s.base.google_total_reviews,googleRating:s.base.google_rating,version:7}));
}
export async function snapshotV2Configuration(){
 const c=await restaurantConfiguration(SOL_SIZE_POLICY);
 return {...c,policy:{...c.policy,version:SNAPSHOT_V2,format_version:RECOMMENDATION_VERSION,editorial_version:RECOMMENDATION_CONFIG.version},
  selector_version:ORDER_SELECTOR_VERSION,sol_prompt_sha256:await negativeHash(recommendationInstructionsV2("vi")),sol_schema_sha256:await hybridHash(recommendationSchemaV2()),
  snapshot_execution:{version:SNAPSHOT_V2,stages:["jev","prepare_evidence","luna","prepare_sol","sol","validate_sol"],
   free_preparation:"codex_authenticated_offline_compiler",maximum_selected_evidence:32,maximum_luna_requests:32,
   no_provider_at_preparation:true,dispatch_tokenizations:0,source_policy:"historical_100_exact_80_english_no_fresh_resolver"}};
}
export async function prepareSnapshotV2(h:FrozenHistorical,cache:RestaurantProtocol["cache"],code:string,expectedModel:string){
 const s=h.snapshot;
 if(h.id!==CHILL_RUN||h.establishment_id!==CHILL||h.language!=="vi"||h.status!=="completed"||s.analysis_version!==7||
  s.base.source_fingerprint!==CHILL_FINGERPRINT||await historicalSnapshotFingerprint(s)!==CHILL_FINGERPRINT||s.reviews.length!==100||
  new Set(s.reviews.map(r=>r.id)).size!==100||s.reviews.filter(r=>(r.original_text??"").trim()).length!==80||
  s.reviews.filter(r=>r.analysis_language==="en"&&r.analysis_text.trim()).length!==80)throw Error("JLS_HISTORICAL_SNAPSHOT_CHANGED");
 const reviews=await Promise.all(s.reviews.map(async r=>{
  const text=(r.original_text??"").trim().length>0;
  if(text&&(r.analysis_language!=="en"||!["original_en","google_translation_en","verified_translation_override_en"].includes(r.analysis_source)))throw Error("JLS_FROZEN_ENGLISH_REQUIRED");
  if(!text&&r.analysis_text.trim())throw Error("JLS_TEXTLESS_ANALYSIS_FORBIDDEN");
  return {id:r.id,organization_id:h.organization_id,establishment_id:h.establishment_id,rating:r.rating,
   original_text:r.original_text??"",original_text_sha256:await negativeHash(r.original_text??""),original_language:r.original_language,
   analysis_text:text?r.analysis_text:null,analysis_text_sha256:text?await negativeHash(r.analysis_text):null,
   analysis_language:text?"en":null,analysis_source:r.analysis_source,translation_provenance:{source:r.analysis_source,
    historical_run_id:h.id,frozen:true,provider_translation_id:null,provider_id_status:"not_retained_in_historical_snapshot",
    ...(r.analysis_translation_override?{override:r.analysis_translation_override}:{})},
   normalized_category_ratings:normalizeCategoryRatings(r.review_detailed_rating),review_detailed_rating:r.review_detailed_rating,
   review_context:r.review_context,published_at:r.published_at} satisfies PilotReview;
 }));
 const source={google_total_reviews:Number(s.base.google_total_reviews),establishment_name:"Chill Thái - Thai Food",reviews,legacy:null};
 const snapshot:PilotSnapshot={id:h.id,organization_id:h.organization_id,establishment_id:h.establishment_id,name:"Chill Thái — snapshot historique exact V2",
  created_by:h.requested_by,created_at:h.created_at,source,source_sha256:await pilotSourceHash(source),config_sha256:await hybridHash(ECONOMY_CONFIG),
  production_enabled:false,preview_at_creation:null,rates:{jev_input:null,jev_output:null,sol_input:null,sol_output:null,apify_import:null,english_translation:null,
   observed_jev_input_per_review:null,observed_jev_output_per_review:null,observed_sol_input:null,observed_sol_output:null,provenance:[]}};
 const base=await prepareRestaurantInputs(snapshot,cache,{historical_run_id:h.id,source_fingerprint:CHILL_FINGERPRINT},code,expectedModel),configuration=await snapshotV2Configuration();
 const body={...base,version:SNAPSHOT_V2,configuration,configuration_sha256:await hybridHash(configuration),sol_size_policy:SOL_SIZE_POLICY,
  frozen_v2:{version:SNAPSHOT_V2,historical_run_id:h.id,historical_generation_id:h.generation_id,historical_run_sha256:await hybridHash(h),
   historical_snapshot_sha256:await hybridHash(s),source_fingerprint:CHILL_FINGERPRINT,historical_snapshot:s}} as RestaurantProtocol;
 await verifySnapshotV2(body,await hybridHash(body));return {body,sha256:await hybridHash(body)};
}
export async function verifySnapshotV2(p:RestaurantProtocol,sha:string){
 const f=p.frozen_v2,s=f?.historical_snapshot as unknown as FrozenHistorical["snapshot"];
 if(p.version!==SNAPSHOT_V2||!f||f.historical_run_id!==CHILL_RUN||p.establishment_id!==CHILL||p.snapshot.establishment_id!==CHILL||
  p.max_jev_calls!==p.pending.length||p.max_jev_calls>80||p.max_luna_calls!==32||p.max_sol_calls!==1||p.english_review_ids.length!==80||
  await hybridHash(p)!==sha||await hybridHash(p.configuration)!==p.configuration_sha256||await hybridHash(await snapshotV2Configuration())!==p.configuration_sha256||
  f.source_fingerprint!==CHILL_FINGERPRINT||await hybridHash(s)!==f.historical_snapshot_sha256||
  await historicalSnapshotFingerprint(s)!==CHILL_FINGERPRINT||await hybridHash(p.cache)!==p.cache_sha256||await hybridHash(p.pending)!==p.pending_sha256||
  p.authority_user_id!==p.snapshot.created_by||p.organization_id!==p.snapshot.organization_id||!p.preparation_is_not_spending_authorization)throw Error("JLS_SNAPSHOT_V2_CHANGED");
 await verifyRestaurantSnapshot(p.snapshot);
 if(await hybridHash(p.snapshot.source.reviews.map(r=>r.id))!==await hybridHash(s.reviews.map(r=>r.id))||
  p.snapshot.source.reviews.some((r,i)=>r.original_text!==(s.reviews[i].original_text??"")||r.analysis_text!==(s.reviews[i].analysis_text.trim()?s.reviews[i].analysis_text:null)))throw Error("JLS_FROZEN_TEXT_CHANGED");
}
// Invoke only after a fresh, explicit user GO; preparation never calls this.
export const snapshotConsent=(p:RestaurantProtocol,sha:string,go:string,at:string)=>restaurantConsent(p,sha,go,at,verifySnapshotV2);
export interface SnapshotEvidence {version:string;protocol_sha256:string;plan:JlsPlan;plan_sha256:string;code_provenance:string;}
export interface SnapshotSolArtifact extends Omit<SolReadyArtifact,"sol"> {
 sol:{gate:NonNullable<SolReadyArtifact["sol"]>["gate"];draft:Awaited<ReturnType<typeof buildRecommendationDraftV2>>};
}
export async function compileSnapshotEvidence(p:RestaurantProtocol,sha:string,cache:RestaurantProtocol["cache"]){
 await verifySnapshotV2(p,sha);
 const selected=(await futureRecommendationCandidates(p.snapshot,cache)).selected;
 const plan=await restaurantEvidencePlan(p,cache,selected);
 if(plan.max_luna_calls>32||plan.question_count>32)throw Error("JLS_LUNA_LIMIT_EXCEEDED");
 return {version:SNAPSHOT_V2,protocol_sha256:sha,plan,plan_sha256:await hybridHash(plan),code_provenance:p.code_provenance} satisfies SnapshotEvidence;
}
export async function verifySnapshotEvidence(p:RestaurantProtocol,sha:string,row:SnapshotEvidence){
 const plan=row.plan;
 if(row.version!==SNAPSHOT_V2||row.protocol_sha256!==sha||plan.source_plan_sha256!==sha||row.plan_sha256!==await hybridHash(plan)||
  plan.organization_id!==p.organization_id||plan.establishment_id!==p.establishment_id||plan.source_sha256!==p.snapshot.source_sha256||
  plan.statistics_sha256!==await hybridHash(plan.statistics)||plan.dossier_sha256!==await hybridHash(plan.selected)||
  plan.luna_manifest_sha256!==await hybridHash(plan.luna_groups)||plan.question_count!==plan.selected.length||plan.question_count>32||
  plan.max_luna_calls!==plan.luna_groups.length||plan.max_luna_calls>32)throw Error("JLS_SNAPSHOT_EVIDENCE_CHANGED");
 for(const e of plan.selected){const r=p.snapshot.source.reviews.find(r=>r.id===e.review_id);
  if(!r?.analysis_text||r.analysis_text_sha256!==e.analysis_text_sha256||r.analysis_text.slice(e.quote_start,e.quote_end)!==e.quote||
   r.analysis_text.slice(e.context_start,e.context_end)!==e.context||await negativeHash(e.quote)!==e.quote_sha256)throw Error("JLS_SNAPSHOT_QUOTE_CHANGED");}
 for(const g of plan.luna_groups){const input=JSON.parse(g.payload.input),r=p.snapshot.source.reviews.find(r=>r.id===g.review_id);
  if(Object.keys(input).sort().join(",")!=="analysis_text,review_alias"||input.analysis_text!==r?.analysis_text||
   g.payload.model!=="gpt-6-luna"||await hybridHash(g.payload)!==g.request_sha256||await hybridHash(g.payload.questions)!==g.questions_sha256)throw Error("JLS_SNAPSHOT_LUNA_CHANGED");}
 return normalizedPlan(plan);
}
export const snapshotExecutionContract:RestaurantExecutionContract={verify:verifySnapshotV2,completed:async(s,w,port)=>{
 if(s.run.stage==="jev"){if(!await port.stage(s.run.id,w,"prepare_evidence",[]))throw Error("JLS_STAGE_CHANGED");return;}
 if(s.run.stage!=="luna")throw Error("JLS_SNAPSHOT_STAGE_INVALID");
 const row=s.artifacts.find(a=>a.kind==="snapshot_evidence");if(!row)throw Error("JLS_SNAPSHOT_EVIDENCE_MISSING");
 const plan=await verifySnapshotEvidence(s.protocol.body,s.protocol.sha256,row.body as unknown as SnapshotEvidence),ds=await restaurantNativeDecisions(s,plan);
 const b={decisions:ds,decisions_sha256:await hybridHash(ds)};
 if(!await port.artifact(s.run.id,w,"luna_decisions",b,await hybridHash(b))||!await port.stage(s.run.id,w,"prepare_sol",[]))throw Error("JLS_STAGE_CHANGED");
}};
export async function compileSnapshotSol(state:RestaurantState){
 const p=state.protocol.body;await verifySnapshotV2(p,state.protocol.sha256);
 const row=state.artifacts.find(a=>a.kind==="snapshot_evidence");if(!row)throw Error("JLS_SNAPSHOT_EVIDENCE_MISSING");
 const plan=await verifySnapshotEvidence(p,state.protocol.sha256,row.body as unknown as SnapshotEvidence),ds=await restaurantNativeDecisions(state,plan);
 const accepted=acceptedJlsEvidence(plan,ds),gate=contractEvidenceGate(plan,accepted.map(e=>e.evidence_id));
 if(!gate.passed)throw Error("JLS_SOL_EVIDENCE_INSUFFICIENT");
 const draft=await buildRecommendationDraftV2(plan,ds,"vi"),cert=draft.token_certificate,request_json=JSON.stringify(draft.request);
 const artifact:SnapshotSolArtifact={version:"jls-snapshot-sol-request-v2",source_protocol_id:state.protocol.id,source_protocol_sha256:state.protocol.sha256,
  source_run_id:state.run.id,code_provenance:p.code_provenance,source_tasks:state.tasks.filter(t=>t.phase==="luna").map(t=>{
   const a=state.artifacts.find(a=>a.kind==="task:"+t.id)!;return {task_id:t.id,review_id:t.review_id!,request_sha256:t.request_sha256,artifact_sha256:a.sha256,response_sha256:String(a.body.response_sha256)};}),
  source_decisions_artifact_sha256:state.artifacts.find(a=>a.kind==="luna_decisions")!.sha256,decisions:ds,decisions_sha256:await hybridHash(ds),
  plan,plan_sha256:await hybridHash(plan),sol:{gate:{...gate,policy:p.configuration.policy.sufficiency,human_validated:false},draft},
  token_certificate:cert,token_certificate_sha256:await hybridHash(cert),request_json,request_raw_sha256:await negativeHash(request_json),
  request_sha256:draft.request_sha256,measurement:draft.measurement};
 return {body:artifact,sha256:await hybridHash(artifact)};
}
export async function verifySnapshotReady(p:RestaurantProtocol,sha:string,row:SolReadyRow|{body:SnapshotSolArtifact;sha256:string}){
 await verifySnapshotV2(p,sha);const a=row.body as SnapshotSolArtifact;
 const request=JSON.parse(a.request_json),draft=a.sol.draft;
 if(a.version!=="jls-snapshot-sol-request-v2"||await hybridHash(a)!==row.sha256||a.source_protocol_sha256!==sha||
  a.decisions_sha256!==await hybridHash(a.decisions)||a.plan_sha256!==await hybridHash(a.plan)||
  a.request_sha256!==await hybridHash(JSON.parse(a.request_json))||a.request_raw_sha256!==await negativeHash(a.request_json)||
  !a.sol.draft||a.sol.draft.format_version!==RECOMMENDATION_VERSION||a.sol.draft.prompt_sha256!==p.configuration.sol_prompt_sha256||a.sol.draft.schema_sha256!==p.configuration.sol_schema_sha256||
  await hybridHash(a.sol.draft.packet)!==a.sol.draft.dossier_sha256||await hybridHash(a.token_certificate)!==a.token_certificate_sha256)throw Error("JLS_SNAPSHOT_SOL_CHANGED");
 if(request.model!=="gpt-6.1-sol"||request.max_output_tokens!==9500||await hybridHash(draft.request)!==a.request_sha256||
  request.input?.length!==2||request.input[0].role!=="system"||await negativeHash(request.input[0].content)!==p.configuration.sol_prompt_sha256||
  request.input[1].role!=="user"||await hybridHash(JSON.parse(request.input[1].content))!==draft.dossier_sha256||
  await hybridHash(request.text?.format?.schema)!==p.configuration.sol_schema_sha256)throw Error("JLS_SNAPSHOT_SOL_REQUEST_CHANGED");
 const plan=await verifySnapshotEvidence(p,sha,{version:SNAPSHOT_V2,protocol_sha256:sha,plan:a.plan,plan_sha256:a.plan_sha256,code_provenance:p.code_provenance});
 const accepted=acceptedJlsEvidence(plan,a.decisions);
 if(!contractEvidenceGate(plan,accepted.map(e=>e.evidence_id)).passed)throw Error("JLS_SOL_EVIDENCE_INSUFFICIENT");
 const fields=["evidence_id","review_id","theme_key","polarity","axis","quote","quote_start","quote_end","quote_sha256","context","analysis_text_sha256"] as const;
 if(draft.packet.statistics_sha256!==plan.statistics_sha256||draft.packet.evidence.length!==accepted.length||
  await hybridHash([...draft.packet.evidence].sort((a,b)=>a.evidence_id.localeCompare(b.evidence_id)).map(e=>Object.fromEntries(fields.map(k=>[k,e[k]]))))!==
  await hybridHash([...accepted].sort((a,b)=>a.evidence_id.localeCompare(b.evidence_id)).map(e=>Object.fromEntries(fields.map(k=>[k,e[k]])))))throw Error("JLS_SNAPSHOT_ACCEPTED_DOSSIER_CHANGED");
 await attachPlanTokenMemo(plan,a.token_certificate,true);
 if(await hybridHash(solRequestSize(JSON.parse(a.request_json),SOL_SIZE_POLICY,planTokenMemo(plan)!.count))!==await hybridHash(a.measurement))throw Error("JLS_TOKEN_MEASUREMENT_CHANGED");
 return plan;
}
export const snapshotReadyContract:ReadyContract={verify:s=>verifySnapshotReady(s.protocol.body,s.protocol.sha256,s.ready),
 validate:async(raw,s,plan)=>{
  // Native responses were reparsed during compilation and their immutable hashes
  // are rechecked by SQL before reservation; no verdict is transferred to a new quote.
  const a=s.ready.body as unknown as SnapshotSolArtifact;for(const g of plan.luna_groups){if(!g.evidence_ids.every(id=>a.decisions.some(d=>d.evidence_id===id&&d.request_sha256===g.request_sha256)))throw Error("JLS_LUNA_DECISIONS_CHANGED");}
  return validateRecommendationReportV2(raw,plan,s.protocol.body.snapshot,a.decisions,"vi",a.sol.draft);
 }};
