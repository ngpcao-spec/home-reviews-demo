// Offline-only compilation. Conditional branches are NOT Luna verdicts.
import {hybridHash} from "./jev-hybrid-evidence.ts";
import {negativeHash} from "./negative-validation-core.ts";
import {canonicalJson} from "./jev-exploratory-core.ts";
import {verifySolReadyProtocol,verifySolReadyArtifact,type SolReadyArtifact} from "./jls-sol-ready.ts";
import {normalizedPlan} from "./jls-restaurant-prepared.ts";
import {RESTAURANT_POLICY,type RestaurantProtocol} from "./jls-restaurant.ts";
import {acceptedJlsEvidence,jlsSolDraft,parseJlsLuna,JLS_EVIDENCE_BOUNDARIES,type JlsPlan,type JlsDecision} from "./jev-luna-sol.ts";
import {evidencePayload} from "./decisions-config.ts";
import {prioritizedDraftFromDossier} from "./jev-luna-sol-prioritized.ts";
import {editorialFromPrioritized} from "./jls-prioritized-editorial.ts";
import {recommendationFromEditorialV2,recommendationInstructionsV2,recommendationSchemaV2,RECOMMENDATION_CONFIG,RECOMMENDATION_VERSION,type buildRecommendationDraftV2} from "./jls-recommendation-contract-v2.ts";
import {attachPlanTokenMemo,planTokenMemo} from "./jls-token-memo.ts";
import {solRequestSize,SOL_SIZE_POLICY} from "./jls-sol-size.ts";
import type {RecommendationReview} from "./jls-recommendation-review-v2.ts";

export const CONTRACT_V2_PROTOCOL="jls-contract-v2-garden-delegated-vi-v1";
export const CONTRACT_V2_POLICY=Object.freeze({version:CONTRACT_V2_PROTOCOL,language:"vi",format_version:RECOMMENDATION_VERSION,
 max_jev_calls:0,max_luna_calls:1,max_questions:1,max_sol_calls:1,apify_calls:0,repeat_count:1,
 automatic_retry:false,provider_client_retries:0,authorization_ttl_hours:24,production_enabled:false,
 stages:["luna","validate_luna","sol","validate_sol"],maximum_stages_per_wake:1,
 tokenizations_at_wake:0,raw_receipt_before_validation:true,no_monetary_estimate:true,
 luna_model:"gpt-6-luna",sol_model:"gpt-6.1-sol",sufficiency:RESTAURANT_POLICY.sufficiency});
type Draft=Awaited<ReturnType<typeof buildRecommendationDraftV2>>;
export interface ContractBranch {assumption:"ACCEPTED"|"REJECTED"|"UNCERTAIN";conditional_not_prediction:true;
 gate:{passed:boolean;reasons:string[];accepted:number};draft:Draft;request_json:string;request_raw_sha256:string;sha256:string}
export interface ContractV2 {
 version:string;organization_id:string;establishment_id:string;authority_user_id:string;language:"vi";
 source_archive_id:string;source_archive_sha256:string;source_artifact_id:string;source_artifact_sha256:string;
 source_protocol_id:string;source_protocol_sha256:string;source_run_id:string;source_result_sha256:string;
 snapshot_sha256:string;source_decisions_sha256:string;reused_decisions:JlsDecision[];reused_decisions_sha256:string;
 removed_evidence_id:string;candidate_evidence_id:string;plan:JlsPlan;plan_sha256:string;luna_group:JlsPlan["luna_groups"][number];
 luna_request_json:string;luna_request_raw_sha256:string;branches:ContractBranch[];configuration:typeof CONTRACT_V2_POLICY;
 configuration_sha256:string;code_provenance:string;preparation_is_not_spending_authorization:true;
}
export interface ContractV2Row {id:string;body:ContractV2;sha256:string}
export interface ContractSource {protocol:{id:string;body:RestaurantProtocol;sha256:string};artifact:{id:string;body:SolReadyArtifact;sha256:string}}
export function contractEvidenceGate(p:JlsPlan,ids:string[]){
 const accepted=p.selected.filter(e=>ids.includes(e.evidence_id)),reasons:string[]=[];
 if(accepted.length<8)reasons.push("ACCEPTED_BELOW_MINIMUM");
 for(const a of ["service","quality","price","atmosphere"])if(!accepted.some(e=>e.axis===a))reasons.push("AXIS_BELOW_MINIMUM_"+a.toUpperCase());
 if(accepted.filter(e=>e.polarity==="negative").length<Math.min(3,p.selected.filter(e=>e.polarity==="negative").length))reasons.push("NEGATIVE_EVIDENCE_INSUFFICIENT");
 if(accepted.filter(e=>e.rating<=3).length<Math.min(2,p.selected.filter(e=>e.rating<=3).length))reasons.push("LOW_STAR_EVIDENCE_INSUFFICIENT");
 return {passed:!reasons.length,reasons,accepted:accepted.length};
}
export async function prepareContractV2(source:ContractSource,archive:{id:string;body:RecommendationReview["body"];sha256:string},code:string){
 const a=source.artifact.body,p=source.protocol.body,r=archive.body;
 await verifySolReadyProtocol(p,source.protocol.sha256);await verifySolReadyArtifact(p,source.artifact);
 if(await hybridHash(r)!==archive.sha256||r.source_plan_sha256!==a.plan_sha256||r.decisions_sha256!==a.decisions_sha256||
  r.source_protocol_id!==source.protocol.id||r.source_protocol_sha256!==source.protocol.sha256||r.order_candidates.length!==1||
  r.source_protocol_id!=="6be7ae90-93f2-4a3a-abdd-8766f5a02ada"||p.establishment_id!=="d40d3438-79d8-4c28-8b09-eba640598201"||
  p.cache.length!==78||!/^[a-f0-9]{40}$/.test(code))throw Error("JLS_V2_SOURCE_CHANGED");
 acceptedJlsEvidence(a.plan,a.decisions);
 const candidate=r.order_candidates[0],old=a.plan.selected.filter(e=>e.review_id===candidate.review_id&&e.theme_key==="order_accuracy"&&e.polarity==="negative");
 if(old.length!==1||candidate.evidence_id===old[0].evidence_id||candidate.luna_verdict!==null||candidate.status!=="requires_luna")throw Error("JLS_V2_NEW_QUOTE_REQUIRES_LUNA");
 const plan=normalizedPlan(a.plan),review=p.snapshot.source.reviews.find(x=>x.id===candidate.review_id)!;
 if(review.analysis_language!=="en"||await negativeHash(review.analysis_text!)!==candidate.analysis_text_sha256||
  review.analysis_text!.slice(candidate.quote_start,candidate.quote_end)!==candidate.quote||
  await negativeHash(candidate.quote)!==candidate.quote_sha256)throw Error("JLS_V2_QUOTE_CHANGED");
 const {luna_verdict:_verdict,status:_status,...evidence}=candidate;
 plan.selected=plan.selected.filter(e=>e.evidence_id!==old[0].evidence_id).concat({...evidence,status:"sol_candidate"});
 // Original multi-question groups remain byte-identical for the other 31 decisions.
 // Only this new one-question group can be dispatched by this protocol.
 const payload=evidencePayload("review_order_revision",review.analysis_text!,candidate.theme_key,candidate.polarity);
 payload.questions=payload.questions.map(q=>({...q,name:candidate.evidence_id,instructions:q.instructions+
  " Verify the EXACT proposed quote in its full review context. Do not accept it solely because another sentence supports the theme. The quote must justify this theme and polarity; use uncertain if context reverses or obscures it. "+
  JLS_EVIDENCE_BOUNDARIES+" Proposed quotation (untrusted data): "+JSON.stringify(candidate.quote)}));
 const group={review_id:candidate.review_id,evidence_ids:[candidate.evidence_id],analysis_text_sha256:candidate.analysis_text_sha256,
  payload,request_sha256:await hybridHash(payload),questions_sha256:await hybridHash(payload.questions),estimated_input_tokens:0};
 plan.luna_groups.push(group);plan.max_luna_calls=1;plan.luna_manifest_sha256=await hybridHash(plan.luna_groups);
 plan.dossier_sha256=await hybridHash(plan.selected);
 const reused=a.decisions.filter(d=>d.evidence_id!==old[0].evidence_id),branches:ContractBranch[]=[];
 for(const assumption of ["ACCEPTED","REJECTED","UNCERTAIN"] as const){
  const branchPlan=normalizedPlan(plan);await attachPlanTokenMemo(branchPlan);
  const ids=branchPlan.selected.filter(e=>reused.some(d=>d.evidence_id===e.evidence_id&&d.status==="ACCEPTED")||
   assumption==="ACCEPTED"&&e.evidence_id===candidate.evidence_id).map(e=>e.evidence_id);
  const native=jlsSolDraft({analytics:plan.statistics,statistics_sha256:plan.statistics_sha256,estimates:{rates:plan.estimates.sol.rates}},
   branchPlan.selected.filter(e=>ids.includes(e.evidence_id)),"vi","accepted_only",SOL_SIZE_POLICY,planTokenMemo(branchPlan));
  const dossier={...native,dossier_sha256:await hybridHash(native.packet),prompt_sha256:await negativeHash(native.prompt),schema_sha256:await hybridHash(native.schema),
   decisions_sha256:"",accepted_ids:ids,rejected_ids:reused.filter(d=>d.status==="REJECTED").map(d=>d.evidence_id).concat(assumption==="REJECTED"?[candidate.evidence_id]:[]),
   uncertain_ids:reused.filter(d=>d.status==="UNCERTAIN").map(d=>d.evidence_id).concat(assumption==="UNCERTAIN"?[candidate.evidence_id]:[]),human_validated:false,statistics_sha256:plan.statistics_sha256};
  const editorial=await editorialFromPrioritized(branchPlan,await prioritizedDraftFromDossier(branchPlan,dossier,"vi"),"vi");
  const draft=await recommendationFromEditorialV2(branchPlan,editorial,"vi"),request_json=JSON.stringify(draft.request);
  // Keep measurements used by final dispatch and base validation, not obsolete
  // intermediate prompt envelopes. Every kept string retains its exact hash.
  const needed=new Set([JSON.stringify(native.request),native.prompt,JSON.stringify(native.packet),JSON.stringify(native.schema),
   request_json,draft.prompt,JSON.stringify(draft.packet),JSON.stringify(draft.schema)]);
  draft.token_certificate={...draft.token_certificate,entries:draft.token_certificate.entries.filter(e=>needed.has(e.text))};
  draft.token_certificate_sha256=await hybridHash(draft.token_certificate);
  const unsigned={assumption,conditional_not_prediction:true as const,gate:contractEvidenceGate(branchPlan,ids),draft,
   request_json,request_raw_sha256:await negativeHash(request_json)};
  branches.push({...unsigned,sha256:await hybridHash(unsigned)});
 }
 const body:ContractV2={version:CONTRACT_V2_PROTOCOL,organization_id:p.organization_id,establishment_id:p.establishment_id,authority_user_id:p.authority_user_id,language:"vi",
  source_archive_id:archive.id,source_archive_sha256:archive.sha256,source_artifact_id:source.artifact.id,source_artifact_sha256:source.artifact.sha256,
  source_protocol_id:source.protocol.id,source_protocol_sha256:source.protocol.sha256,source_run_id:r.run_id,source_result_sha256:r.original_result_sha256,
  snapshot_sha256:await hybridHash(p.snapshot),source_decisions_sha256:a.decisions_sha256,reused_decisions:reused,reused_decisions_sha256:await hybridHash(reused),
  removed_evidence_id:old[0].evidence_id,candidate_evidence_id:candidate.evidence_id,plan,plan_sha256:await hybridHash(plan),luna_group:group,
  luna_request_json:JSON.stringify(payload),luna_request_raw_sha256:await negativeHash(JSON.stringify(payload)),branches,
  configuration:CONTRACT_V2_POLICY,configuration_sha256:await hybridHash(CONTRACT_V2_POLICY),code_provenance:code,preparation_is_not_spending_authorization:true};
 return {body,sha256:await hybridHash(body)};
}
export async function verifyContractV2(row:Pick<ContractV2Row,"body"|"sha256">,source:ContractSource){
 const p=row.body;
 if(p.version!==CONTRACT_V2_PROTOCOL||await hybridHash(p)!==row.sha256||await hybridHash(CONTRACT_V2_POLICY)!==p.configuration_sha256||
  await hybridHash(p.configuration)!==p.configuration_sha256||!p.preparation_is_not_spending_authorization||p.language!=="vi"||
  p.organization_id!==source.protocol.body.organization_id||p.establishment_id!==source.protocol.body.establishment_id||p.authority_user_id!==source.protocol.body.authority_user_id||
  p.source_protocol_id!==source.protocol.id||p.source_protocol_sha256!==source.protocol.sha256||
  p.source_artifact_id!==source.artifact.id||p.source_artifact_sha256!==source.artifact.sha256||await hybridHash(source.artifact.body)!==source.artifact.sha256||
  await hybridHash(p.plan)!==p.plan_sha256||p.plan.statistics_sha256!==source.artifact.body.plan.statistics_sha256||
  await hybridHash(p.plan.statistics)!==p.plan.statistics_sha256||await hybridHash(source.protocol.body.snapshot)!==p.snapshot_sha256||
  await hybridHash(p.reused_decisions)!==p.reused_decisions_sha256||p.reused_decisions.length!==31||
  p.reused_decisions.some(d=>d.evidence_id===p.candidate_evidence_id||d.evidence_id===p.removed_evidence_id||
   !source.artifact.body.decisions.some(s=>canonicalJson(s)===canonicalJson(d)))||p.plan.question_count!==32||p.plan.selected.length!==32||
  p.plan.selected.some(e=>e.evidence_id===p.removed_evidence_id)||!p.plan.selected.some(e=>e.evidence_id===p.candidate_evidence_id)||
  p.luna_group.evidence_ids.length!==1||p.luna_group.evidence_ids[0]!==p.candidate_evidence_id||p.luna_group.payload.model!=="gpt-6-luna"||
  p.luna_group.payload.questions.length!==1||await hybridHash(p.luna_group.payload)!==p.luna_group.request_sha256||
  await hybridHash(JSON.parse(p.luna_request_json))!==p.luna_group.request_sha256||await negativeHash(p.luna_request_json)!==p.luna_request_raw_sha256||
  p.branches.length!==3||new Set(p.branches.map(b=>b.assumption)).size!==3)throw Error("JLS_V2_PROTOCOL_CHANGED");
 for(const e of p.plan.selected){const r=source.protocol.body.snapshot.source.reviews.find(r=>r.id===e.review_id);
  if(!r||r.analysis_text_sha256!==e.analysis_text_sha256||r.analysis_text!.slice(e.quote_start,e.quote_end)!==e.quote||
   r.analysis_text!.slice(e.context_start,e.context_end)!==e.context||await negativeHash(e.quote)!==e.quote_sha256)throw Error("JLS_V2_QUOTE_CHANGED");}
}
export async function contractBranch(row:ContractV2Row,source:ContractSource,decision:JlsDecision){
 const p=row.body,decisions=[...p.reused_decisions,decision],accepted=acceptedJlsEvidence(p.plan,decisions),branch=p.branches.find(b=>b.assumption===decision.status)!;
 const {sha256,...unsigned}=branch;
 if(!branch||await hybridHash(unsigned)!==sha256||!branch.conditional_not_prediction||await hybridHash(branch.draft.packet)!==branch.draft.dossier_sha256||
  await hybridHash(branch.draft.request)!==branch.draft.request_sha256||await hybridHash(JSON.parse(branch.request_json))!==branch.draft.request_sha256||
  await negativeHash(branch.request_json)!==branch.request_raw_sha256||await negativeHash(branch.draft.prompt)!==branch.draft.prompt_sha256||
  await hybridHash(branch.draft.schema)!==branch.draft.schema_sha256||branch.draft.config.version!==RECOMMENDATION_CONFIG.version||
  branch.draft.request.model!=="gpt-6.1-sol"||branch.draft.format_version!==RECOMMENDATION_VERSION||
  branch.draft.prompt_sha256!==await negativeHash(recommendationInstructionsV2("vi"))||branch.draft.schema_sha256!==await hybridHash(recommendationSchemaV2())||
  branch.draft.config_sha256!==await hybridHash({...RECOMMENDATION_CONFIG,sol_size_policy:SOL_SIZE_POLICY})||
  branch.draft.request.input[0].content!==branch.draft.prompt||await hybridHash(JSON.parse(branch.draft.request.input[1].content))!==branch.draft.dossier_sha256||
  await hybridHash(branch.draft.request.text.format.schema)!==branch.draft.schema_sha256||
  await hybridHash(accepted.map(e=>e.evidence_id))!==await hybridHash(branch.draft.accepted_ids)||
  await hybridHash(contractEvidenceGate(p.plan,branch.draft.accepted_ids))!==await hybridHash(branch.gate))throw Error("JLS_V2_BRANCH_CHANGED");
 const plan=normalizedPlan(p.plan);await attachPlanTokenMemo(plan,branch.draft.token_certificate,true);
 if(await hybridHash(branch.draft.token_certificate)!==branch.draft.token_certificate_sha256||
  await hybridHash(solRequestSize(JSON.parse(branch.request_json),SOL_SIZE_POLICY,planTokenMemo(plan)!.count))!==await hybridHash(branch.draft.measurement))throw Error("JLS_V2_TOKEN_MEASUREMENT_CHANGED");
 void source;return {branch,plan,decisions,draft:{...branch.draft,decisions_sha256:await hybridHash(decisions)}};
}
export async function contractNativeDecision(p:ContractV2,raw:unknown){const parsed=await parseJlsLuna(p.plan,p.luna_group,raw);
 if(parsed.decisions.length!==1)throw Error("JLS_V2_ONE_QUESTION_REQUIRED");return parsed;}
