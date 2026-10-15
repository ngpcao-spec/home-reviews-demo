import {PREPARED_RESTAURANT_VERSION,verifyPreparedProtocol} from "./jls-restaurant-prepared.ts";
import {SOL_SIZE_POLICY,solRequestSize,type SolSizePolicy} from "./jls-sol-size.ts";
import {conditionalEditorialRequest} from "./jls-prioritized-editorial.ts";
// Separate delegated restaurant experiment. Preparation never creates consent.
import { ECONOMY_CONFIG, ECONOMY_THRESHOLDS, economyPayload } from "./jev-economy-config.ts";
import { economyIdentity, economyCacheKey, type EconomyCache } from "./jev-economy-cache.ts";
import { auditPilotCache, pilotStatistics, pilotSourceHash, type PilotSnapshot } from "./jev-pilot-core.ts";
import { hybridHash, hybridAnalytics, localHybridTokens } from "./jev-hybrid-evidence.ts";
import { balancedCandidates, balancedSelectorHash, balancedSummary, selectBalancedEvidence, BALANCED_VERSION } from "./jev-hybrid-balanced.ts";
import { JLS_CONFIG, JLS_EVIDENCE_BOUNDARIES, type JlsPlan, type JlsDecision, jlsSolDraft, acceptedSolDossier } from "./jev-luna-sol.ts";
import { EVIDENCE_CONFIG, evidencePayload } from "./decisions-config.ts";
import { editorialInstructions, JLS_EDITORIAL_CONFIG, buildEditorialDraft } from "./jls-prioritized-editorial.ts";
import { prioritizedSchema } from "./jev-luna-sol-prioritized.ts";
import { negativeHash } from "./negative-validation-core.ts";

export const RESTAURANT_PROTOCOL_VERSION="jls-restaurant-delegated-vi-v1";
export const GARDEN="d40d3438-79d8-4c28-8b09-eba640598201";
export const RESTAURANT_POLICY=Object.freeze({version:RESTAURANT_PROTOCOL_VERSION,
  format_version:"jls-prioritized-recommendations-v1",editorial_version:JLS_EDITORIAL_CONFIG.version,
  language:"vi",jev_configuration:ECONOMY_CONFIG.id,jev_requested_model:"jev-latest",
  luna_model:"gpt-6-luna",sol_model:"gpt-6.1-sol",max_luna_calls:32,max_questions:32,max_sol_calls:1,
  concurrency:8,repeat_count:1,automatic_retry:false,provider_client_retries:0,
  authorization_ttl_hours:24,provider_timeout_ms:110000,input_budget_tokens:20000,
  max_output_tokens:9500,production_enabled:false,apify_calls:0,
  sufficiency:{minimum_accepted:8,minimum_per_axis:1,negative_if_available:3,low_star_if_available:2},
  consent_source:"user_directive_codex_delegation",operator_identity:{kind:"codex_admin",channel:"supabase_mcp"},
  no_monetary_estimate:true,no_amount_confirmation:true});
export const RESTAURANT_RESUME_VERSION="jls-restaurant-resume-vi-32k-v1";
export async function restaurantConfiguration(sizePolicy?:SolSizePolicy) {
  const policy=sizePolicy?{...RESTAURANT_POLICY,version:RESTAURANT_RESUME_VERSION,input_budget_tokens:sizePolicy.input_budget_tokens,sol_size_policy:sizePolicy}:RESTAURANT_POLICY;
  return {policy,selector_version:BALANCED_VERSION,economy_sha256:await hybridHash(ECONOMY_CONFIG),
    jev_request_template:{model:"jev-latest",questions:economyPayload("unused","unused").questions},
    thresholds_sha256:await hybridHash(ECONOMY_THRESHOLDS),selector_sha256:await balancedSelectorHash(),
    luna_questions_sha256:await hybridHash(EVIDENCE_CONFIG.source_questions),
    luna_boundaries_sha256:await negativeHash(JLS_EVIDENCE_BOUNDARIES),
    editorial_configuration_sha256:await hybridHash(JLS_EDITORIAL_CONFIG),
    sol_prompt_sha256:await negativeHash(editorialInstructions("vi")),sol_schema_sha256:await hybridHash(prioritizedSchema())};
}
export interface RestaurantProtocol {
  version:string;organization_id:string;establishment_id:string;authority_user_id:string;
  prepared?:{version:string;artifact_sha256:string;source_protocol_id:string;source_protocol_sha256:string;source_run_id:string};
  sol_size_policy?:SolSizePolicy;
  resume?:{source_protocol_id:string;source_protocol_sha256:string;source_run_id:string;
    evidence_sha256:string;luna_manifest_sha256:string;conditional_sol:Awaited<ReturnType<typeof conditionalEditorialRequest>>};
  snapshot:PilotSnapshot;cache: (EconomyCache & {theme_results?:unknown})[];
  pending: {review_id:string;identity:Awaited<ReturnType<typeof economyIdentity>>;cache_key:string;payload:Omit<ReturnType<typeof economyPayload>,"questions">;request_sha256:string}[];
  configuration:Omit<Awaited<ReturnType<typeof restaurantConfiguration>>,"policy"> & {policy:Omit<Awaited<ReturnType<typeof restaurantConfiguration>>["policy"],"version"> & {version:string;sol_size_policy?:SolSizePolicy};prepared_execution?:unknown};
  configuration_sha256:string;cache_sha256:string;pending_sha256:string;
  max_jev_calls:number;max_luna_calls:number;max_sol_calls:1;
  english_review_ids:string[];english_manifest_sha256:string;provider_sources:unknown;
  provider_sources_sha256:string;source_captured_at:string;code_provenance:string;
  coverage:ReturnType<typeof pilotStatistics>["coverage"];preparation_is_not_spending_authorization:true;
}
export async function prepareRestaurant(snapshot:PilotSnapshot,cache:RestaurantProtocol["cache"],providerSources:unknown,code:string,expectedModel:string) {
  if(snapshot.establishment_id!==GARDEN||snapshot.production_enabled!==false)throw Error("JLS_RESTAURANT_SCOPE_INVALID");
  await verifyRestaurantSnapshot(snapshot);
  const a=await auditPilotCache(snapshot.source.reviews,cache,snapshot.organization_id,snapshot.establishment_id);
  if(a.blocked_review_ids.length)throw Error("JLS_EXISTING_CACHE_ATTEMPT_UNCERTAIN");
  const configuration=await restaurantConfiguration(),pending=[];
  for(const id of a.missing_review_ids) {
    const r=snapshot.source.reviews.find(r=>r.id===id)!;
    const identity=await economyIdentity(snapshot.organization_id,snapshot.establishment_id,id,r.analysis_text!,expectedModel);
    const payload=economyPayload("review_"+(snapshot.source.reviews.indexOf(r)+1),r.analysis_text!);
    pending.push({review_id:id,identity,cache_key:await economyCacheKey(identity),payload:{model:payload.model,state:payload.state},request_sha256:await hybridHash(payload)});
  }
  const english=snapshot.source.reviews.filter(r=>r.analysis_text&&r.analysis_language==="en").map(r=>r.id);
  return {version:RESTAURANT_PROTOCOL_VERSION,organization_id:snapshot.organization_id,establishment_id:snapshot.establishment_id,
    authority_user_id:snapshot.created_by,snapshot,cache:a.used,pending,configuration,configuration_sha256:await hybridHash(configuration),
    cache_sha256:await hybridHash(a.used),pending_sha256:await hybridHash(pending),max_jev_calls:pending.length,
    max_luna_calls:32,max_sol_calls:1 as const,english_review_ids:english,english_manifest_sha256:await hybridHash(english.map(id=>{
      const r=snapshot.source.reviews.find(r=>r.id===id)!;return {review_id:id,sha256:r.analysis_text_sha256};})),
    provider_sources:providerSources,provider_sources_sha256:await hybridHash(providerSources),source_captured_at:snapshot.created_at,
    code_provenance:code,coverage:pilotStatistics(snapshot.source.reviews,a,snapshot.source.google_total_reviews).coverage,
    preparation_is_not_spending_authorization:true as const} satisfies RestaurantProtocol;
}
export async function verifyRestaurantSnapshot(s:PilotSnapshot) {
  if(s.config_sha256!==await hybridHash(ECONOMY_CONFIG)||s.source_sha256!==await pilotSourceHash(s.source)||
    new Set(s.source.reviews.map(r=>r.id)).size!==s.source.reviews.length||
    s.source.reviews.some(r=>r.organization_id!==s.organization_id||r.establishment_id!==s.establishment_id))throw Error("JLS_RESTAURANT_SNAPSHOT_CHANGED");
  for(const r of s.source.reviews)if(await negativeHash(r.original_text)!==r.original_text_sha256||
    r.analysis_text!==null&&(r.analysis_language!=="en"||!r.analysis_text.trim()||await negativeHash(r.analysis_text)!==r.analysis_text_sha256))throw Error("JLS_RESTAURANT_TEXT_CHANGED");
}
export async function verifyRestaurantProtocol(p:RestaurantProtocol,sha:string) {
  if(p.version===PREPARED_RESTAURANT_VERSION)return verifyPreparedProtocol(p,sha);
  if(await hybridHash(p)!==sha)throw Error("JLS_RESTAURANT_PROTOCOL_CHANGED");
  if(p.version===RESTAURANT_RESUME_VERSION){
    if(!p.resume||!p.sol_size_policy)throw Error("JLS_RESTART_BINDING_MISSING");
    const rebuilt=await prepareRestaurantResume(p.snapshot,p.cache,p.provider_sources,p.code_provenance,p.cache[0]?.served_model??"",p.resume);
    if(await hybridHash(rebuilt)!==sha)throw Error("JLS_RESTAURANT_PROTOCOL_CHANGED");return;
  }
  if(await hybridHash(p)!==sha||p.version!==RESTAURANT_PROTOCOL_VERSION||p.establishment_id!==GARDEN||
    p.authority_user_id!==p.snapshot.created_by||p.organization_id!==p.snapshot.organization_id||
    p.establishment_id!==p.snapshot.establishment_id||p.preparation_is_not_spending_authorization!==true||
    p.max_jev_calls!==p.pending.length||p.max_luna_calls!==32||p.max_sol_calls!==1||
    await hybridHash(await restaurantConfiguration())!==p.configuration_sha256)throw Error("JLS_RESTAURANT_PROTOCOL_CHANGED");
  const expected=p.pending[0]?.identity.expected_served_model??p.cache[0]?.served_model;
  if(!expected)throw Error("JLS_EXPECTED_SERVED_MODEL_MISSING");
  const rebuilt=await prepareRestaurant(p.snapshot,p.cache,p.provider_sources,p.code_provenance,expected);
  if(await hybridHash(rebuilt)!==sha)throw Error("JLS_RESTAURANT_PROTOCOL_CHANGED");
}
export async function restaurantConsent(p:RestaurantProtocol,sha:string,directGo:string,at:string) {
  await verifyRestaurantProtocol(p,sha);
  if(directGo.trim().length<20||!Number.isFinite(Date.parse(at)))throw Error("JLS_NEW_GO_REQUIRED");
  return {consent_source:RESTAURANT_POLICY.consent_source,operator_identity:RESTAURANT_POLICY.operator_identity,
    protocol_sha256:sha,user_directive:directGo,directive_sha256:await negativeHash(directGo),requested_at:at,
    expires_at:new Date(Date.parse(at)+24*3600000).toISOString(),scope:{establishment_id:p.establishment_id,
      organization_id:p.organization_id,language:"vi",configuration_sha256:p.configuration_sha256,
      max_jev_calls:p.max_jev_calls,max_luna_calls:p.max_luna_calls,max_sol_calls:1,automatic_retry:false,provider_client_retries:0,apify_calls:0}};
}
// Reuse the exact V1.1 selector and native Luna bindings; no historical builder
// is changed. Null rates deliberately prevent ANY monetary forecast.
export async function restaurantEvidencePlan(p:RestaurantProtocol,cache:RestaurantProtocol["cache"]):Promise<JlsPlan> {
  const s=p.snapshot,a=await auditPilotCache(s.source.reviews,cache,p.organization_id,p.establishment_id);
  if(a.missing_review_ids.length||a.blocked_review_ids.length||a.used.length!==p.english_review_ids.length)throw Error("JLS_JEV_COVERAGE_INCOMPLETE");
  const statistics=hybridAnalytics(s,pilotStatistics(s.source.reviews,a,s.source.google_total_reviews));
  const selected=selectBalancedEvidence(await balancedCandidates(s,a.used,[]),32);
  if(!selected.length)throw Error("JLS_NO_ADMISSIBLE_EVIDENCE");
  const config={...JLS_CONFIG,...(p.sol_size_policy?{input_budget_tokens:p.sol_size_policy.input_budget_tokens,sol_size_policy:p.sol_size_policy}:{}),source_question_set:EVIDENCE_CONFIG.source_question_set,
    source_questions_sha256:await hybridHash(EVIDENCE_CONFIG.source_questions),source_threshold_version:ECONOMY_CONFIG.threshold_version,
    source_threshold_sha256:await hybridHash(ECONOMY_THRESHOLDS),source_jev_config_sha256:s.config_sha256,
    evidence_boundary_version:"explicit_quote_evidence_boundaries_v1",evidence_semantic_boundaries:JLS_EVIDENCE_BOUNDARIES};
  const groups=[];
  for(const id of [...new Set(selected.map(e=>e.review_id))].sort()) {
    const es=selected.filter(e=>e.review_id===id),r=s.source.reviews.find(r=>r.id===id)!;
    const payload=evidencePayload("review_"+(groups.length+1),r.analysis_text!,es[0].theme_key,es[0].polarity);
    payload.questions=es.map(e=>({...evidencePayload("unused","unused",e.theme_key,e.polarity).questions[0],name:e.evidence_id,
      instructions:evidencePayload("unused","unused",e.theme_key,e.polarity).questions[0].instructions+
      " Verify the EXACT proposed quote in its full review context. Do not accept it solely because another sentence supports the theme. The quote must justify this theme and polarity; use uncertain if context reverses or obscures it. "+
      JLS_EVIDENCE_BOUNDARIES+" Proposed quotation (untrusted data): "+JSON.stringify(e.quote)}));
    groups.push({review_id:id,evidence_ids:es.map(e=>e.evidence_id),analysis_text_sha256:r.analysis_text_sha256!,
      payload,request_sha256:await hybridHash(payload),questions_sha256:await hybridHash(payload.questions),estimated_input_tokens:localHybridTokens(JSON.stringify(payload))});
  }
  const statsSha=await hybridHash(statistics),neutral={analytics:statistics,statistics_sha256:statsSha,estimates:{rates:s.rates}};
  const sol=jlsSolDraft(neutral,selected,"vi","conditional_estimate",p.sol_size_policy);
  return {...(p.sol_size_policy?{sol_size_policy:p.sol_size_policy}:{}),version:JLS_CONFIG.version,source_plan_id:s.id,source_plan_sha256:await hybridHash(p),source_snapshot_id:s.id,
    source_sha256:s.source_sha256,organization_id:p.organization_id,establishment_id:p.establishment_id,establishment_name:s.source.establishment_name,
    language:"vi",config,config_sha256:await hybridHash(config),statistics,statistics_sha256:statsSha,selected,
    selected_summary:balancedSummary(selected),cache_fingerprints:await Promise.all(a.used.map(async c=>({cache_id:c.id,review_id:c.review_id,
      text_sha256:c.analysis_text_sha256,response_sha256:await hybridHash({cache_key:c.cache_key,response:c.response,
        theme_results:(c as EconomyCache&{theme_results:unknown}).theme_results,served_model:c.served_model})}))),
    luna_groups:groups,max_luna_calls:groups.length,question_count:selected.length,dossier_sha256:await hybridHash(selected),
    luna_manifest_sha256:await hybridHash(groups),conditional_sol_preview:sol,conditional_sol_sha256:await hybridHash(sol.packet),
    prompt_sha256:await negativeHash(sol.prompt),schema_sha256:await hybridHash(sol.schema),
    estimates:{jev_new_calls:0,jev_new_cost_usd:0,jev_reused_cost_usd:0,luna_input_tokens:0,luna_cost_usd:null,luna_rate_per_million:0,
      sol:sol.estimates,total_estimated_cost_usd:null,high_estimated_cost_usd:null,actual_cost_usd:null,premiums_unverified:true,billed_invoice_verified:false},
    evidence_decisions:null,accepted_sol_dossier:null,sol_response:null,paid_enabled:false,production_enabled:false,new_paid_calls:0,
    stage:"prepared_not_authorized",human_validated:false};
}
export async function restaurantSol(p:JlsPlan,ds:JlsDecision[]) {
  const bound=await acceptedSolDossier(p,ds),accepted=p.selected.filter(e=>bound.accepted_ids.includes(e.evidence_id));
  const axes=["service","quality","price","atmosphere"];
  const negativeAvailable=p.selected.filter(e=>e.polarity==="negative").length,lowAvailable=p.selected.filter(e=>e.rating<=3).length;
  const reasons=[];
  if(accepted.length<8)reasons.push("ACCEPTED_BELOW_MINIMUM");
  for(const axis of axes)if(!accepted.some(e=>e.axis===axis))reasons.push("AXIS_BELOW_MINIMUM_"+axis.toUpperCase());
  if(accepted.filter(e=>e.polarity==="negative").length<Math.min(3,negativeAvailable))reasons.push("NEGATIVE_EVIDENCE_INSUFFICIENT");
  if(accepted.filter(e=>e.rating<=3).length<Math.min(2,lowAvailable))reasons.push("LOW_STAR_EVIDENCE_INSUFFICIENT");
  const gate={passed:!reasons.length,reasons,accepted:accepted.length,policy:RESTAURANT_POLICY.sufficiency,human_validated:false};
  if(!gate.passed)return {gate,draft:null};
  const draft=await buildEditorialDraft(p,ds,"vi");
  return {gate,draft};
}

// Free, separate restart only. Old protocol/run and authorization never reopened.
export async function prepareRestaurantResume(snapshot:PilotSnapshot,cache:RestaurantProtocol["cache"],sources:unknown,code:string,expectedModel:string,
 history:Pick<NonNullable<RestaurantProtocol["resume"]>,"source_protocol_id"|"source_protocol_sha256"|"source_run_id">):Promise<RestaurantProtocol> {
 if(!/^[a-f0-9]{64}$/.test(history.source_protocol_sha256)||!history.source_run_id||!history.source_protocol_id)throw Error("JLS_RESTART_BINDING_MISSING");
 const base=await prepareRestaurant(snapshot,cache,sources,code,expectedModel);
 if(base.pending.length)throw Error("JLS_RESTART_REQUIRES_COMPLETE_COMPATIBLE_CACHE");
 const configuration=await restaurantConfiguration(SOL_SIZE_POLICY);
 const p:RestaurantProtocol={...base,version:RESTAURANT_RESUME_VERSION,configuration,configuration_sha256:await hybridHash(configuration),sol_size_policy:SOL_SIZE_POLICY};
 const plan=await restaurantEvidencePlan(p,cache),conditional_sol=await conditionalEditorialRequest(plan);
 return {...p,max_luna_calls:plan.max_luna_calls,resume:{source_protocol_id:history.source_protocol_id,
  source_protocol_sha256:history.source_protocol_sha256,source_run_id:history.source_run_id,
  evidence_sha256:plan.dossier_sha256,luna_manifest_sha256:plan.luna_manifest_sha256,conditional_sol}};
}
export async function verifyRestaurantResumePlan(p:RestaurantProtocol,plan:JlsPlan) {
 if(!p.resume)return;
 const measured=await conditionalEditorialRequest(plan);
 if(plan.dossier_sha256!==p.resume.evidence_sha256||plan.luna_manifest_sha256!==p.resume.luna_manifest_sha256||
  plan.max_luna_calls!==p.max_luna_calls||await hybridHash(measured)!==await hybridHash(p.resume.conditional_sol))throw Error("JLS_RESTART_PREFLIGHT_CHANGED");
 solRequestSize(measured.request,p.sol_size_policy);
}
