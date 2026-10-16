// Separate, free preparation contract. Historical V1 instructions/schema stay frozen.
// deno-lint-ignore no-import-prefix
import {z} from "npm:zod@4.6.5";
import {ACTION_FOCUS,prioritizedSchema} from "./jev-luna-sol-prioritized.ts";
import {prioritizedResponse,validatePrioritizedBindings,type BoundResponse} from "./jev-luna-sol-prioritized-validation.ts";
import {buildEditorialDraft,editorialInstructions,JLS_EDITORIAL_CONFIG} from "./jls-prioritized-editorial.ts";
import {editorialReportControls} from "./jls-editorial-validation.ts";
import {JLS_DISCLOSURE_VALIDATOR} from "./jls-fee-disclosure.ts";
import {hybridHash} from "./jev-hybrid-evidence.ts";
import {negativeHash} from "./negative-validation-core.ts";
import {attachPlanTokenMemo,planTokens,planTokenMemo,tokenCertificate} from "./jls-token-memo.ts";
import {solRequestSize,SOL_SIZE_POLICY} from "./jls-sol-size.ts";
import {THEME_KEYS} from "./jev-themes.ts";
import {actionSupportV2} from "./jls-order-evidence-v2.ts";
import type {JlsPlan,JlsDecision} from "./jev-luna-sol.ts";
import type {PilotSnapshot} from "./jev-pilot-core.ts";

export const RECOMMENDATION_VERSION="jls-prioritized-recommendations-v2";
export const RECOMMENDATION_VALIDATOR="jls-observation-action-statistics-validation-v2";
export const ACTION_FOCUS_V2=Object.freeze({...structuredClone(ACTION_FOCUS),
  food_temperature:{theme:"temperature",claims:["served_temperature"]},
});
export const RECOMMENDATION_CONFIG=Object.freeze({...JLS_EDITORIAL_CONFIG,version:"jls-recommendation-contract-v2",
  input_budget_tokens:SOL_SIZE_POLICY.input_budget_tokens,
  format_version:RECOMMENDATION_VERSION,validator_version:RECOMMENDATION_VALIDATOR,
  temperature_policy:"served_temperature_never_cooking_v1",priority_policy:"direct_observations_and_snapshot_comparison_v2",
  selector_version:"jls-autonomous-order-evidence-v2",paid_enabled:false,production_enabled:false});
const keys=THEME_KEYS.flatMap(k=>["positive","negative"].map(p=>k+":"+p)) as [string,...string[]];
const oldRec=prioritizedResponse.shape.report.shape.recommendations.element;
export const recommendationResponseV2=prioritizedResponse.extend({
 format_version:z.literal(RECOMMENDATION_VERSION),
 report:prioritizedResponse.shape.report.extend({recommendations:z.array(oldRec.extend({
  proposed_action:oldRec.shape.proposed_action.extend({focus:z.enum(Object.keys(ACTION_FOCUS_V2) as [string,...string[]])}),
  priority:oldRec.shape.priority.extend({comparison_context:z.array(z.object({
   key:z.enum(keys),statistics_sha256:z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()).max(50)}),
 }).strict()).max(5)}).strict(),
}).strict();
export function recommendationInstructionsV2(language:"fr"|"vi"){
 const base=editorialInstructions(language).replace("Keep technical priority keys in priority.frequency_keys only, never in priority.reason.",
  "Keep direct keys in priority.frequency_keys and global comparison keys in priority.comparison_context. Never put either in manager prose.");
 return base+"\n"+[
  "ACTION CONTRACT V2: Use food_temperature only for an explicit complaint about the temperature of food as served. food_preparation remains cooking and must not be used for cold serving temperature. Room temperature, a cold beverage, a dish cooling during a wait, an intended cold dish or a merely hypothetical complaint cannot establish a negative food temperature claim.",
  "ORDER EVIDENCE: An order action needs an autonomous exact ACCEPTED quotation describing the missing/wrong ordered item. General 'getting things wrong' wording is insufficient. A more precise sentence found only in context has no inherited Luna verdict: do not quote it as accepted. Omit the recommendation if its exact accepted quotation cannot support the action.",
  "PRIORITY ROLES V2: priority.frequency_keys are DIRECT supporting theme/polarity frequencies and must each match an associated observation. Separate global comparisons in priority.comparison_context, each with its exact key and the supplied statistics_sha256. They refer ONLY to frozen statistics.themes across the analysed snapshot, never the frequency of a specific incident or an extra accepted quotation.",
  "A global comparison cannot supply a missing observation, action anchor or direct frequency. Use theme_frequency only with direct, reliable observation-matching frequency_keys. Preserve mixed opinions without relabelling positive/global comparisons as supporting negative observations. Never remove binding checks to fill three recommendations."
 ].join("\n");
}
type Node={properties?:Record<string,Node>;items?:Node;required?:string[];enum?:string[];[key:string]:unknown};
export function recommendationSchemaV2(){
 const s=structuredClone(prioritizedSchema()) as Node;
 s.properties!.format_version.enum=[RECOMMENDATION_VERSION];
 const rec=s.properties!.report.properties!.recommendations.items!;
 rec.properties!.proposed_action.properties!.focus.enum=Object.keys(ACTION_FOCUS_V2);
 const pri=rec.properties!.priority;
 pri.properties!.comparison_context={type:"array",items:{type:"object",additionalProperties:false,
  properties:{key:{type:"string",enum:keys},statistics_sha256:{type:"string"}},required:["key","statistics_sha256"]}};
 pri.required!.push("comparison_context");return s;
}
export async function buildRecommendationDraftV2(plan:JlsPlan,decisions:JlsDecision[],language:"fr"|"vi"=plan.language){
 // Offline preparation uses its own token memo, never unseals a historical one.
 const p={...plan};await attachPlanTokenMemo(p);
 const old=await buildEditorialDraft(p,decisions,language);
 return recommendationFromEditorialV2(p,old,language,plan);
}
export async function recommendationFromEditorialV2(p:JlsPlan,old:Awaited<ReturnType<typeof buildEditorialDraft>>,language:"fr"|"vi",sourcePlan:JlsPlan=p){
 const frequency=old.packet.frequency.map(f=>{
  const [key,polarity]=f.key.split(":"),t=p.statistics.themes.find(t=>t.theme_key===key)!;
  const side=polarity as "positive"|"negative";
  return {...f,mentions:t[`${side}_mentions`],distinct_reviews:t[`${side}_reviews`],denominator:p.statistics.coverage.analysed_reviews};
 });
 const packet={...old.packet,format_version:RECOMMENDATION_VERSION,editorial_version:RECOMMENDATION_CONFIG.version,
  frequency,
  action_focus:ACTION_FOCUS_V2,global_comparison:{statistics_sha256:p.statistics_sha256,
   scope:"snapshot_theme_counts_not_incident_frequency",available_keys:keys},
  priority_frequency_contract:{frequency_keys:"direct_observation_support_only",comparison_context:"snapshot_context_only_not_evidence"}};
 const prompt=recommendationInstructionsV2(language),schema=recommendationSchemaV2();
 const request={...old.request,input:[{role:"system",content:prompt},{role:"user",content:JSON.stringify(packet)}],
  text:{format:{...old.request.text.format,name:"jls_prioritized_recommendations_v2",schema}}};
 const size=solRequestSize(request,p.sol_size_policy,planTokenMemo(p)?.count);
 const config={...RECOMMENDATION_CONFIG,...(p.sol_size_policy?{input_budget_tokens:p.sol_size_policy.input_budget_tokens,sol_size_policy:p.sol_size_policy}:{})};
 const certificate=await tokenCertificate(p);
 return {...old,version:RECOMMENDATION_CONFIG.version,format_version:RECOMMENDATION_VERSION,config,
  config_sha256:await hybridHash(config),packet,prompt,schema,request,
  prompt_sha256:await negativeHash(prompt),schema_sha256:await hybridHash(schema),dossier_sha256:await hybridHash(packet),
  request_sha256:await hybridHash(request),source_plan_sha256:await hybridHash(sourcePlan),measurement:size,
  local_request_tokens:planTokens(p,JSON.stringify(request)),token_certificate:certificate,token_certificate_sha256:await hybridHash(certificate),
  // No monetary estimate in this preparation.
  estimates:{...old.estimates,estimated_cost_usd:null,high_estimated_cost_usd:null},
  new_paid_calls:0,spending_authorization:null,execution_protocol:null,paid_enabled:false,production_enabled:false};
}
export async function validateRecommendationReportV2(raw:unknown,p:JlsPlan,snapshot:PilotSnapshot,decisions:JlsDecision[],language:"fr"|"vi"=p.language,
 prepared?:Awaited<ReturnType<typeof buildRecommendationDraftV2>>){
 const parsed=recommendationResponseV2.parse(raw),draft=prepared??await buildRecommendationDraftV2(p,decisions,language);
 const base=await validatePrioritizedBindings(raw,parsed as BoundResponse,p,snapshot,decisions,language,
  JLS_DISCLOSURE_VALIDATOR,draft,ACTION_FOCUS_V2,true,actionSupportV2);
 return {...base,editorial_version:RECOMMENDATION_CONFIG.version,validator_version:RECOMMENDATION_VALIDATOR,
  report:editorialReportControls(base.report,p,language),configuration_sha256:draft.config_sha256,priority_coverage:draft.coverage,
  translation_fidelity_guaranteed:false,priority_selection_semantically_verified:false};
}

