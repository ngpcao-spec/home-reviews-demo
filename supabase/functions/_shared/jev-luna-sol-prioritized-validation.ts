// Binding checks do not establish semantic truth. Unresolved prose stays review_needed.
// deno-lint-ignore no-import-prefix
import { z } from "npm:zod@4.6.5";
import { buildPrioritizedDraft, JLS_PRIORITIZED_VERSION, RECOMMENDATION_TOPICS, ACTION_FOCUS } from "./jev-luna-sol-prioritized.ts";
import { type JlsPlan, type JlsDecision } from "./jev-luna-sol.ts";
import { validateJlsReport, jlsActionEvidenceSupported } from "./jev-luna-sol-validation.ts";
import { hybridHash } from "./jev-hybrid-evidence.ts";
import { negativeHash } from "./negative-validation-core.ts";
import { PILOT_AXES, type PilotSnapshot } from "./jev-pilot-core.ts";
import { THEME_KEYS } from "./jev-themes.ts";

const text = z.string().trim().min(1).max(1200), ids = z.array(z.string()).max(25), axis = z.enum(PILOT_AXES),
  prose = z.object({ text, axis, evidence_ids: ids }).strict();
const observation = z.object({ text, evidence_id: z.string(), theme_key: z.enum(THEME_KEYS),
  polarity: z.enum(["positive", "negative"]), quote: z.string().min(1), quote_sha256: z.string(),
  context_quote: z.string().min(1), context_sha256: z.string(), context_summary: text }).strict();
export const prioritizedResponse = z.object({ format_version: z.literal(JLS_PRIORITIZED_VERSION), statistics_sha256: z.string(),
  report: z.object({ axes: z.array(prose).length(4), positive_aspects: z.array(prose).max(25), negative_aspects: z.array(prose).max(25),
    conclusion: z.object({ text: z.string().trim().min(1).max(600), evidence_ids: ids }).strict(),
    recommendations: z.array(z.object({ title: z.string().trim().min(1).max(120), axis,
      topic: z.enum(Object.keys(RECOMMENDATION_TOPICS) as [keyof typeof RECOMMENDATION_TOPICS, ...(keyof typeof RECOMMENDATION_TOPICS)[]]),
      evidence_ids: ids, observations: z.array(observation).min(1).max(25),
      proposed_action: z.object({ text, kind: z.enum(["inspect", "clarify", "review"]),
        focus: z.enum(Object.keys(ACTION_FOCUS) as [keyof typeof ACTION_FOCUS, ...(keyof typeof ACTION_FOCUS)[]]) }).strict(),
      priority: z.object({ rank: z.number().int().min(1).max(5), reason: text,
        basis: z.enum(["sourced_signal", "theme_frequency", "isolated_signal_to_verify", "frequency_unknown"]), frequency_keys: ids }).strict(),
    }).strict()).max(5),
  }).strict(),
}).strict();
export type PrioritizedResponse = z.infer<typeof prioritizedResponse>;
// Conservative tripwires, not a replacement for contextual semantic review.
export const unsupportedClaim = (s: string) => /\p{N}|https?:\/\//u.test(s) || /illég(?:al|ale|aux|ales)/iu.test(s) ||
  /\b(?:recurrent|récurrent|récurrente|systématique|toujours|garantit|garantira|prouvé|illégal|obligation juridique|causé par|responsable de|dû à|deux|trois|quatre|cinq|dix|cent|mille)\b|(?:thường xuyên|lặp đi lặp lại|bảo đảm|đảm bảo|vi phạm pháp luật|nghĩa vụ pháp lý|do đó gây|do nhân viên|hai|ba|bốn|năm|mười)\s+(?:avis|clients|mentions|commentaires|đánh giá|khách|lượt)|(?:thường xuyên|lặp đi lặp lại|bảo đảm|đảm bảo|vi phạm pháp luật|nghĩa vụ pháp lý)/iu.test(s);
export async function validatePrioritizedReport(raw: unknown, p: JlsPlan, snapshot: PilotSnapshot, decisions: JlsDecision[], language: "fr" | "vi" = p.language) {
  const r = prioritizedResponse.parse(raw), draft = await buildPrioritizedDraft(p, decisions, language);
  // Reuse the existing snapshot, exact quotation, theme, polarity, statistics and
  // Luna-binding verifier. No legacy recommendation/catalogue is submitted here.
  const base = await validateJlsReport({ statistics_sha256: r.statistics_sha256,
    report: { axes: r.report.axes, positive_aspects: r.report.positive_aspects,
      negative_aspects: r.report.negative_aspects, conclusion: r.report.conclusion, recommendations: [] } }, p, snapshot, decisions);
  const seen = new Set<string>(), proposals = r.report.recommendations.map((a, i) => {
    const reasons: string[] = [], bound = a.observations.map(o => {
      const e = p.selected.find(e => e.evidence_id === o.evidence_id);
      if (!e || !draft.accepted_ids.includes(o.evidence_id)) reasons.push("OBSERVATION_NOT_LUNA_ACCEPTED");
      if (e && (o.theme_key !== e.theme_key || o.polarity !== e.polarity || e.axis !== a.axis ||
        !(RECOMMENDATION_TOPICS[a.topic] as readonly string[]).includes(e.theme_key))) reasons.push("OBSERVATION_THEME_POLARITY_OR_TOPIC_MISMATCH");
      if (e && (o.quote !== e.quote || o.quote_sha256 !== e.quote_sha256 || o.context_quote !== e.context)) reasons.push("OBSERVATION_EXACT_SOURCE_CHANGED");
      const expected = draft.packet.evidence.find(e => e.evidence_id === o.evidence_id);
      if (!expected || o.context_sha256 !== expected.context_sha256) reasons.push("OBSERVATION_CONTEXT_HASH_CHANGED");
      // Explicit context markers require a corresponding qualifier in localized
      // prose. This catches common omissions, without claiming full understanding.
      if(e){
        const summary=o.context_summary.toLocaleLowerCase();
        if(/\b(?:discount|refund|compensation|complimentary|free (?:meal|dish)|offered (?:to )?replace)/i.test(e.context)&&
          !/remise|réduction|rembours|compens|offert|remplac|giảm|hoàn tiền|bồi thường|miễn phí|thay/iu.test(summary))reasons.push("COMPENSATION_CONTEXT_OMITTED");
        if(/\b(?:apologis|apologiz|staff noticed|asked why|took our comments|staff explained)/i.test(e.context)&&
          !/personnel|serveur|excuse|réaction|explic|pris en compte|nhân viên|xin lỗi|giải thích|ghi nhận/iu.test(summary))reasons.push("STAFF_RESPONSE_CONTEXT_OMITTED");
        if(/\b(?:delicious|tasty)\b/i.test(e.context)&&e.theme_key==="portions"&&
          !/goût|savoureux|délicieu|bon|ngon|hương vị/iu.test(summary))reasons.push("MIXED_TASTE_CONTEXT_OMITTED");
        if(e.theme_key==="location"&&/\batmosphere.{0,30}(?:lovely|pleasant|beautiful|great)/i.test(e.context)&&
          !/ambiance|atmosphère|không gian|bầu không khí/iu.test(summary))reasons.push("MIXED_AMBIANCE_CONTEXT_OMITTED");
      }
      return { ...o, customer_report_not_established_fact: true as const };
    });
    const observed = new Set(a.observations.map(o => o.evidence_id));
    if (!a.evidence_ids.length || new Set(a.evidence_ids).size !== a.evidence_ids.length ||
      observed.size !== a.observations.length || observed.size !== a.evidence_ids.length || a.evidence_ids.some(id => !observed.has(id))) reasons.push("OBSERVATION_EVIDENCE_SET_MISMATCH");
    if (a.priority.rank !== i + 1) reasons.push("PRIORITY_ORDER_CHANGED");
    const focus = ACTION_FOCUS[a.proposed_action.focus], anchors = a.evidence_ids.map(id => p.selected.find(e => e.evidence_id === id));
    const disclosure = (e: JlsPlan["selected"][number]) => e.theme_key === "billing" && e.polarity === "negative" &&
      /\b(?:fee|charge|vat|tax|surcharge|bill)\b/i.test(e.quote) &&
      /\b(?:not (?:announced|mentioned|disclosed)|no (?:mention|notice)|hidden|without (?:notice|warning)|didn.t (?:see|know)|unannounced)/i.test(e.quote);
    const supported = anchors.filter(e => e && draft.accepted_ids.includes(e.evidence_id) && e.polarity === "negative" &&
      (focus.theme === null ? e.axis === "atmosphere" : e.theme_key === focus.theme) &&
      (jlsActionEvidenceSupported(e, focus.claims ?? undefined) || a.proposed_action.focus === "billing_disclosure" && disclosure(e)));
    if (!supported.length) reasons.push("PRECISE_ACTION_REQUIRES_REVIEW");
    if (a.proposed_action.focus === "billing_accuracy" && !supported.some(e => /\b(?:miscalculat|incorrect total|wrong total|charged twice|double charged|arithmetic|calculation error)/i.test(e!.quote))) reasons.push("BILLING_DISCLOSURE_IS_NOT_CALCULATION_ERROR");
    if (a.proposed_action.focus === "billing_disclosure" && !supported.some(e => disclosure(e!))) reasons.push("PRECISE_DISCLOSURE_SUPPORT_REQUIRED");
    if (/formation|former le personnel|đào tạo/iu.test(a.proposed_action.text) && a.proposed_action.focus !== "staff_competence") reasons.push("DELAY_DOES_NOT_ESTABLISH_TRAINING_NEED");
    if (/indications|signalétique|directions|chỉ dẫn|biển chỉ/iu.test(a.proposed_action.text) && a.proposed_action.focus !== "location_wayfinding") reasons.push("DISTANCE_IS_NOT_WAYFINDING");
    if (/calcul|arithmetic|tính toán/iu.test(a.proposed_action.text) && a.proposed_action.focus === "billing_disclosure") reasons.push("BILLING_DISCLOSURE_IS_NOT_CALCULATION_ERROR");
    if (seen.has(a.topic)) reasons.push("REDUNDANT_RECOMMENDATION_TOPIC"); seen.add(a.topic);
    // Distinct topic codes do not make a copied action a new recommendation.
    const norm = (s: string) => s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (r.report.recommendations.slice(0, i).some(b => norm(b.proposed_action.text) === norm(a.proposed_action.text))) reasons.push("REDUNDANT_PROPOSED_ACTION");
    const proseTexts = [a.title, ...a.observations.flatMap(o => [o.text, o.context_summary]), a.proposed_action.text, a.priority.reason];
    if (proseTexts.some(unsupportedClaim)) reasons.push("UNSUPPORTED_FREQUENCY_NUMERIC_OR_CAUSAL_CLAIM");
    const frequencies = a.priority.frequency_keys.map(key => draft.packet.frequency.find(f => f.key === key));
    if (new Set(a.priority.frequency_keys).size !== a.priority.frequency_keys.length || frequencies.some(f => !f?.reliable ||
      !a.observations.some(o => `${o.theme_key}:${o.polarity}` === f.key))) reasons.push("UNRELIABLE_OR_UNRELATED_FREQUENCY");
    if (a.priority.basis === "theme_frequency" && !frequencies.length ||
      a.priority.basis === "frequency_unknown" && frequencies.length) reasons.push("PRIORITY_FREQUENCY_BASIS_MISMATCH");
    if (a.priority.basis === "isolated_signal_to_verify" && new Set(a.observations.map(o => p.selected.find(e => e.evidence_id === o.evidence_id)?.review_id)).size !== 1) reasons.push("ISOLATED_SIGNAL_SCOPE_MISMATCH");
    return { ...a, observations: bound, proposed_action: { ...a.proposed_action, proposal_not_validated_solution: true as const },
      frequency: frequencies.filter(f => f !== undefined),
      status: reasons.length ? "review_needed" as const : "technically_bound_proposal" as const,
      visible: !reasons.length, reasons: [...new Set(reasons)], semantic_truth_guaranteed: false as const };
  });
  // Additional prose tripwires also cover the short conclusion and axes.
  const safeProse = <T extends { text: string | null; status: string; reasons: string[] }>(a: T): T =>
    a.text && unsupportedClaim(a.text) ? { ...a, text: null, status: "review_needed", reasons: [...a.reasons, "UNSUPPORTED_FREE_CLAIM"] } : a;
  return { format_version: JLS_PRIORITIZED_VERSION, language, statistics: base.statistics, statistics_sha256: base.statistics_sha256,
    accepted_dossier_sha256: draft.dossier_sha256, prompt_sha256: draft.prompt_sha256, schema_sha256: draft.schema_sha256,
    decisions_sha256: draft.decisions_sha256, raw_response_sha256: await hybridHash(raw),
    report: { axes: base.report.axes.map(safeProse), positive_aspects: base.report.positive_aspects.map(safeProse),
      negative_aspects: base.report.negative_aspects.map(safeProse), conclusion: safeProse(base.report.conclusion), recommendations: proposals },
    methodology_note: draft.methodology_note, human_validated: false, semantic_truth_guaranteed: false, production_enabled: false,
  };
}
export async function observationHashes(quote: string, context: string) {
  return { quote_sha256: await negativeHash(quote), context_sha256: await negativeHash(context) };
}
