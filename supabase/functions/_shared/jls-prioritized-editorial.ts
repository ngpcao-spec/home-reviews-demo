// Future-generation preparation only. Historical prompts and execution stay frozen.
import { buildPrioritizedDraft, prioritizedInstructions, JLS_PRIORITIZED_VERSION, JLS_PRIORITIZED_CONFIG } from "./jev-luna-sol-prioritized.ts";
import { hybridHash, localHybridTokens } from "./jev-hybrid-evidence.ts";
import { negativeHash } from "./negative-validation-core.ts";
import type { JlsPlan, JlsDecision } from "./jev-luna-sol.ts";
export const JLS_EDITORIAL_VERSION = "jls-prioritized-editorial-v1";
export const JLS_EDITORIAL_ACTION = "prioritized_editorial_prepared_v1";
export const JLS_EDITORIAL_CONFIG = Object.freeze({ ...JLS_PRIORITIZED_CONFIG,
  version:JLS_EDITORIAL_VERSION,format_version:JLS_PRIORITIZED_VERSION,
  translation_policy:"dish_ingredient_relations_and_ambiguity_v1",
  language_policy:"manager_prose_separate_from_audit_v1",
  priority_policy:"frequency_severity_specificity_actionability_v1",
  validator_version:"jls-prioritized-editorial-validation-v1",
  jev_new_calls:0,luna_new_calls:0,apify_new_calls:0,
});
export function editorialInstructions(language:"fr"|"vi") {
  // Replace the old two-factor priority instruction in this COPY only.
  const base=prioritizedInstructions(language).split("\n").filter(line=>!line.startsWith("priority.rank follows array order.")).join("\n");
  return base+"\n"+[
    "TRANSLATION FIDELITY: Preserve the dish, ingredients, preparation and their relationships. A dish WITH an ingredient must not become another ingredient or a different dish. Preserve source ambiguity instead of inventing precision. Preserve qualifications and mixed opinions. When unsure, retain the source dish name with a cautious localized account. No free translation is guaranteed by deterministic checks.",
    "MANAGER LANGUAGE: Write natural, simple restaurateur-facing prose. Never mention frequency keys, field names, internal statuses, evidence identifiers, hashes or configuration names in titles, observations, context summaries, proposed actions, conclusions or priority reasons. Keep mandatory identifiers ONLY in structured audit fields. In Vietnamese do not write 'khóa tần suất'. Say what the analysed reviews report, without internal vocabulary.",
    "PRIORITY REVIEW: Examine ALL themes in priority_review and ALL admissible evidence before choosing actions. Weigh available whole-snapshot theme frequency, severity of the reported signal, specificity of accepted quotations and whether a concrete reviewable action is supported. Frequency alone does not explain priority. Popularity is not severity. Do not impose a price recommendation or a price reduction. Zero to five actions remain valid, and fewer than three may be appropriate.",
    "priority.rank follows array order. For each selected priority explain its position in plain language using relevant factors, without invented causes or counts. Selected quotation counts are NOT problem frequency. Theme frequency is NOT the frequency of the quoted incident. Never say a quoted incident is recurrent. Several reviews about waiting do not establish repeated incidents in a specific area. An isolated potentially serious allegation merits verification, never confirmed causality. No reliable count means frequency unknown, not zero; use frequency_unknown when no reliable key applies.",
    "COVERAGE: Themes without accepted negative evidence remain visible in the audit coverage but cannot ground a recommendation. Limited examples are not representative frequency measurements. Do not fill gaps with rejected/uncertain evidence, other themes in full context or information from audits. The server displays coverage limitations separately. Keep technical priority keys in priority.frequency_keys only, never in priority.reason.",
  ].join("\n");
}
export async function buildEditorialDraft(p:JlsPlan,decisions:JlsDecision[],language:"fr"|"vi"=p.language) {
  const legacy=await buildPrioritizedDraft(p,decisions,language),evidence=legacy.packet.evidence;
  const coverage=p.statistics.themes.map(t=>{
    const accepted=evidence.filter(e=>e.theme_key===t.theme_key&&e.polarity==="negative");
    const reliable=p.statistics.theme_frequency_denominator===p.statistics.coverage.analysed_reviews &&
      Number.isSafeInteger(t.negative_reviews)&&t.negative_reviews>=0&&t.negative_reviews<=p.statistics.coverage.analysed_reviews&&
      Number.isSafeInteger(t.negative_mentions)&&t.negative_mentions>=t.negative_reviews;
    return {theme_key:t.theme_key,axis:t.axis,negative_mentions:t.negative_mentions,negative_reviews:t.negative_reviews,
      denominator:p.statistics.coverage.analysed_reviews,frequency_reliable:reliable,
      accepted_negative_reviews:new Set(accepted.map(e=>e.review_id)).size,accepted_evidence_ids:accepted.map(e=>e.evidence_id),
      coverage_status:accepted.length?"available" as const:t.negative_reviews>0?"missing_accepted_evidence" as const:"no_negative_signal" as const};
  });
  // Omit verbose group-size/meal-type metadata; preserve all counts relevant to
  // themes, four axes, coverage, stars and Google cross-rating diagnostics.
  const {structured_context_stats:_context,...statistics}=legacy.packet.statistics;
  const packet={...legacy.packet,statistics,editorial_version:JLS_EDITORIAL_VERSION,
    // Counts already exist in statistics.themes; do not send them twice per key.
    frequency:legacy.packet.frequency.map(({key,reliable})=>({key,reliable})),
    priority_review:{columns:["theme_key","accepted_negative_reviews","frequency_reliable"],
      rows:coverage.map(c=>[c.theme_key,c.accepted_negative_reviews,c.frequency_reliable]),
      denominator:p.statistics.coverage.analysed_reviews,scope:"all_themes_snapshot_counts_not_incident_frequency"},
    statistics_projection:"structured_context_stats_omitted_only",frequency_counts_source:"statistics.themes"};
  const prompt=editorialInstructions(language),schema=legacy.schema;
  const request={...legacy.request,input:[{role:"system",content:prompt},{role:"user",content:JSON.stringify(packet)}],
    text:{format:{...legacy.request.text.format,name:"jls_prioritized_editorial_v1"}}};
  const tokens=Math.ceil(localHybridTokens(JSON.stringify(request))*1.12)+256;
  if(tokens>JLS_EDITORIAL_CONFIG.input_budget_tokens)throw Error("JLS_SOL_TOKEN_BUDGET_EXCEEDED",{cause:{estimated_input_tokens:tokens}});
  const rates=legacy.estimates.rates,cost=(output:number)=>rates.sol_input===null||rates.sol_output===null?null:(tokens*rates.sol_input+output*rates.sol_output)/1e6;
  return {...legacy,version:JLS_EDITORIAL_VERSION,format_version:JLS_PRIORITIZED_VERSION,config:JLS_EDITORIAL_CONFIG,
    config_sha256:await hybridHash(JLS_EDITORIAL_CONFIG),packet,prompt,schema,request,
    prompt_sha256:await negativeHash(prompt),schema_sha256:await hybridHash(schema),dossier_sha256:await hybridHash(packet),request_sha256:await hybridHash(request),
    previous_request_sha256:legacy.request_sha256,coverage,
    estimates:{...legacy.estimates,estimated_input_tokens:tokens,estimated_cost_usd:cost(legacy.estimates.estimated_output_tokens),
      high_estimated_cost_usd:cost(JLS_EDITORIAL_CONFIG.max_output_tokens),dossier_bytes:new TextEncoder().encode(JSON.stringify(packet)).length},
    execution_protocol:null,spending_authorization:null,new_paid_calls:0 as const,result:null,
  };
}
export type EditorialDraft=Awaited<ReturnType<typeof buildEditorialDraft>>;
export async function verifyEditorialDraft(d:EditorialDraft,p:JlsPlan,decisions:JlsDecision[]) {
  if(await hybridHash(d)!==await hybridHash(await buildEditorialDraft(p,decisions,d.language)))throw Error("JLS_EDITORIAL_PREPARATION_CHANGED");
}
