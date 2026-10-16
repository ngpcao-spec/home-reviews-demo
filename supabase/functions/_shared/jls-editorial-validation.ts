import { validatePrioritizedReport } from "./jev-luna-sol-prioritized-validation.ts";
import { buildEditorialDraft,JLS_EDITORIAL_VERSION } from "./jls-prioritized-editorial.ts";
import { hybridHash } from "./jev-hybrid-evidence.ts";
import type { JlsPlan,JlsDecision } from "./jev-luna-sol.ts";
import type { PilotSnapshot } from "./jev-pilot-core.ts";
import { THEME_KEYS } from "./jev-themes.ts";
export const JLS_EDITORIAL_VALIDATOR="jls-prioritized-editorial-validation-v1";
// Tripwires for explicit contradictions and internal vocabulary. Incomplete by
// design: passing them cannot guarantee the faithfulness of a free translation.
export function editorialProseReasons(text:string) {
  const reasons:string[]=[];
  if(/khóa\s+tần\s+suất|frequency[_ ]keys?|clé[s]?\s+de\s+fréquence|evidence[_ ]id|quote[_ ]sha256|sha256|\bhash(?:es)?\b|\b(?:ACCEPTED|REJECTED|UNCERTAIN|review_needed|supported_by_rule|technically_bound_proposal)\b|\b[a-f0-9]{64}\b|\b[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\b/iu.test(text))reasons.push("INTERNAL_VOCABULARY_IN_MANAGER_PROSE");
  if(THEME_KEYS.some(key=>text.includes(key))||/\b(?:theme_key|context_summary|proposed_action|distinct_reviews|statistics_sha256|priority\.(?:rank|reason|basis))\b/u.test(text))reasons.push("INTERNAL_VOCABULARY_IN_MANAGER_PROSE");
  return reasons;
}
export function vietnameseDishReasons(source:string,localized:string) {
  // Distinguish an egg-based dish with fish from fish eggs/roe. This is a general
  // dish/ingredient relation, independent of restaurant and evidence identities.
  const eggDish=/\b(?:omelet|omelette)\b.{0,50}\b(?:with|containing|filled with)\b.{0,40}\bfish\b/i.test(source);
  return eggDish&&/trứng\s+cá/iu.test(localized)&&!/trứng\s+(?:chiên|rán)|ốp\s*lết|omelet/iu.test(localized)?["DISH_INGREDIENT_RELATION_NEEDS_REVIEW"]:[];
}
export async function validateEditorialReport(raw:unknown,p:JlsPlan,snapshot:PilotSnapshot,decisions:JlsDecision[],language:"fr"|"vi"=p.language) {
  // Preserve every existing citation, hash, Luna, action and numerical safeguard.
  const base=await validatePrioritizedReport(raw,p,snapshot,decisions,language),draft=await buildEditorialDraft(p,decisions,language);
  return {...base,editorial_version:JLS_EDITORIAL_VERSION,validator_version:JLS_EDITORIAL_VALIDATOR,
    report:editorialReportControls(base.report,p,language),prompt_sha256:draft.prompt_sha256,schema_sha256:draft.schema_sha256,
    accepted_dossier_sha256:draft.dossier_sha256,configuration_sha256:draft.config_sha256,priority_coverage:draft.coverage,
    translation_fidelity_guaranteed:false,priority_selection_semantically_verified:false,raw_response_sha256:await hybridHash(raw)};
}
export function editorialReportControls(report:Awaited<ReturnType<typeof validatePrioritizedReport>>["report"],p:JlsPlan,language:"fr"|"vi") {
  const prose=<T extends {text:string|null;status:string;reasons:string[];evidence_ids?:string[]}>(x:T):T=>{
    const reasons=x.text?editorialProseReasons(x.text):[];
    if(language==="vi"&&x.text)for(const id of x.evidence_ids??[]){const e=p.selected.find(e=>e.evidence_id===id);if(e)reasons.push(...vietnameseDishReasons(e.quote,x.text));}
    return reasons.length?{...x,text:null,status:"review_needed",reasons:[...new Set([...x.reasons,...reasons])]}:x;
  };
  const recommendations=report.recommendations.map(a=>{
    const free=[a.title,a.proposed_action.text,a.priority.reason,...a.observations.flatMap(o=>[o.text,o.context_summary])];
    const reasons=[...a.reasons,...free.flatMap(editorialProseReasons)];
    if(language==="vi")for(const o of a.observations)reasons.push(...vietnameseDishReasons(o.quote,o.text),...vietnameseDishReasons(o.context_quote,o.context_summary));
    return {...a,reasons:[...new Set(reasons)],visible:!reasons.length,status:reasons.length?"review_needed" as const:"technically_bound_proposal" as const};
  });
  return {...report,axes:report.axes.map(prose),positive_aspects:report.positive_aspects.map(prose),negative_aspects:report.negative_aspects.map(prose),conclusion:prose(report.conclusion),recommendations};
}
