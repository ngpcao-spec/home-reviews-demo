// Free compiler + lightweight runtime verification. No provider or credential.
import {restaurantEvidencePlan,restaurantConfiguration,verifyRestaurantProtocol,verifyRestaurantSnapshot,type RestaurantProtocol} from "./jls-restaurant.ts";
import {hybridHash} from "./jev-hybrid-evidence.ts";
import {canonicalJson} from "./jev-exploratory-core.ts";
import {negativeHash} from "./negative-validation-core.ts";
import {conditionalEditorialRequest} from "./jls-prioritized-editorial.ts";
import {SOL_SIZE_POLICY} from "./jls-sol-size.ts";
import {attachPlanTokenMemo,tokenCertificate,planTokenMemo,type TokenCertificate,TOKEN_CERT_VERSION} from "./jls-token-memo.ts";
import {jlsSolDraft,type JlsPlan} from "./jev-luna-sol.ts";
export const PREPARED_RESTAURANT_VERSION="jls-restaurant-prepared-vi-v1";
export const PREPARED_ARTIFACT_VERSION="jls-deterministic-artifacts-v1";
export const PREPARED_POLICY=Object.freeze({version:PREPARED_ARTIFACT_VERSION,token_certificate:TOKEN_CERT_VERSION,
 phases:["jev","luna","prepare_sol","sol"],maximum_stages_per_wake:1,full_reconstruction_at_wake:false,
 source_verification:"immutable_source_and_cache_and_request_hashes_v1",automatic_retry:false});
export interface PreparedRestaurantArtifact {version:string;source_protocol_id:string;source_protocol_sha256:string;source_run_id:string;
 code_provenance:string;plan:JlsPlan;plan_sha256:string;token_certificate:TokenCertificate;token_certificate_sha256:string;
 conditional_sol:Awaited<ReturnType<typeof conditionalEditorialRequest>>;}
export interface PreparedRestaurantRow {body:PreparedRestaurantArtifact;sha256:string}
export async function preparedRestaurantConfiguration(){const c=await restaurantConfiguration(SOL_SIZE_POLICY);
 return {...c,policy:{...c.policy,version:PREPARED_RESTAURANT_VERSION},prepared_execution:PREPARED_POLICY};}
export function normalizedPlan(p:JlsPlan):JlsPlan{return JSON.parse(canonicalJson(p));}
export async function compilePreparedRestaurant(source:{id:string;body:RestaurantProtocol;sha256:string},sourceRun:string,code:string){
 await verifyRestaurantProtocol(source.body,source.sha256);
 const plan=normalizedPlan(await restaurantEvidencePlan(source.body,source.body.cache));
 await attachPlanTokenMemo(plan);
 const conditional_sol=await conditionalEditorialRequest(plan);
 // Measure the all-accepted lexical dossier too, as a hypothetical envelope,
 // without manufacturing any native Luna decision or annotation.
 jlsSolDraft({analytics:plan.statistics,statistics_sha256:plan.statistics_sha256,estimates:{rates:plan.estimates.sol.rates}},plan.selected,"vi","accepted_only",plan.sol_size_policy,planTokenMemo(plan));
 const cert=await tokenCertificate(plan),artifact:PreparedRestaurantArtifact={version:PREPARED_ARTIFACT_VERSION,
 source_protocol_id:source.id,source_protocol_sha256:source.sha256,source_run_id:sourceRun,code_provenance:code,
 plan,plan_sha256:await hybridHash(plan),token_certificate:cert,token_certificate_sha256:await hybridHash(cert),conditional_sol};
 const sha256=await hybridHash(artifact),configuration=await preparedRestaurantConfiguration();
 const body:RestaurantProtocol={...source.body,version:PREPARED_RESTAURANT_VERSION,code_provenance:code,
 configuration,configuration_sha256:await hybridHash(configuration),
 resume:{...source.body.resume!,source_protocol_id:source.id,source_protocol_sha256:source.sha256,source_run_id:sourceRun,conditional_sol},
 prepared:{version:PREPARED_ARTIFACT_VERSION,artifact_sha256:sha256,source_protocol_id:source.id,source_protocol_sha256:source.sha256,source_run_id:sourceRun}};
 return {protocol:{body,sha256:await hybridHash(body)},artifact:{body:artifact,sha256}};
}
export async function verifyPreparedProtocol(p:RestaurantProtocol,sha:string){
 if(p.version!==PREPARED_RESTAURANT_VERSION||!p.prepared||p.prepared.version!==PREPARED_ARTIFACT_VERSION||await hybridHash(p)!==sha||
 p.configuration_sha256!==await hybridHash(p.configuration)||p.configuration_sha256!==await hybridHash(await preparedRestaurantConfiguration())||
 p.max_jev_calls!==0||p.pending.length||p.max_sol_calls!==1||p.max_luna_calls<1||p.max_luna_calls>28||
 p.snapshot.establishment_id!==p.establishment_id||p.snapshot.organization_id!==p.organization_id||p.authority_user_id!==p.snapshot.created_by||
 p.cache_sha256!==await hybridHash(p.cache)||p.pending_sha256!==await hybridHash(p.pending)||
 await hybridHash(p.sol_size_policy)!==await hybridHash(SOL_SIZE_POLICY)||p.preparation_is_not_spending_authorization!==true)
 throw Error("JLS_PREPARED_PROTOCOL_CHANGED");
 await verifyRestaurantSnapshot(p.snapshot);
}
export async function verifyPreparedArtifact(p:RestaurantProtocol,row:PreparedRestaurantRow,cache?:RestaurantProtocol["cache"]){
 const b=row.body,a=b.plan;
 if(row.sha256!==p.prepared?.artifact_sha256||row.sha256!==await hybridHash(b)||b.version!==PREPARED_ARTIFACT_VERSION||
 b.source_protocol_sha256!==p.prepared.source_protocol_sha256||b.source_protocol_id!==p.prepared.source_protocol_id||b.source_run_id!==p.prepared.source_run_id||
 b.plan_sha256!==await hybridHash(a)||a.source_plan_sha256!==b.source_protocol_sha256||a.source_sha256!==p.snapshot.source_sha256||
 a.organization_id!==p.organization_id||a.establishment_id!==p.establishment_id||a.source_snapshot_id!==p.snapshot.id||
 a.dossier_sha256!==p.resume?.evidence_sha256||a.luna_manifest_sha256!==p.resume?.luna_manifest_sha256||a.max_luna_calls!==p.max_luna_calls||
 a.question_count!==a.selected.length||new Set(a.selected.map(e=>e.evidence_id)).size!==a.question_count||
 a.statistics_sha256!==await hybridHash(a.statistics)||a.config_sha256!==await hybridHash(a.config)||
 b.token_certificate_sha256!==await hybridHash(b.token_certificate)||
 b.conditional_sol.prompt_sha256!==p.configuration.sol_prompt_sha256||b.conditional_sol.schema_sha256!==p.configuration.sol_schema_sha256||
 b.conditional_sol.request_sha256!==await hybridHash(b.conditional_sol.request))throw Error("JLS_PREPARED_ARTIFACT_CHANGED");
 if(cache&&await hybridHash([...cache].sort((a,b)=>a.id.localeCompare(b.id)))!==await hybridHash([...p.cache].sort((a,b)=>a.id.localeCompare(b.id))))throw Error("JLS_REUSED_CACHE_CHANGED");
 for(const e of a.selected){const r=p.snapshot.source.reviews.find(r=>r.id===e.review_id);
 if(!r?.analysis_text||r.analysis_text_sha256!==e.analysis_text_sha256||r.analysis_text.slice(e.quote_start,e.quote_end)!==e.quote||
 r.analysis_text.slice(e.context_start,e.context_end)!==e.context||await negativeHash(e.quote)!==e.quote_sha256)throw Error("JLS_PREPARED_QUOTE_CHANGED");}
 for(const g of a.luna_groups){const r=p.snapshot.source.reviews.find(r=>r.id===g.review_id);
 if(g.request_sha256!==await hybridHash(g.payload)||g.questions_sha256!==await hybridHash(g.payload.questions)||
 JSON.parse(g.payload.input).analysis_text!==r?.analysis_text||Object.keys(JSON.parse(g.payload.input)).sort().join(",")!=="analysis_text,review_alias"||
 g.payload.model!=="gpt-6-luna"||g.evidence_ids.some(id=>!a.selected.some(e=>e.evidence_id===id&&e.review_id===g.review_id)))throw Error("JLS_PREPARED_LUNA_REQUEST_CHANGED");}
 const plan=normalizedPlan(a);await attachPlanTokenMemo(plan,b.token_certificate,true);return plan;
}
