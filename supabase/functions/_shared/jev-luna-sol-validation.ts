// deno-lint-ignore no-import-prefix -- reuse project's pinned schema validation.
import { z } from "npm:zod@4.6.5";
import { acceptedSolDossier, type JlsDecision, type JlsPlan } from "./jev-luna-sol.ts";
import { hybridHash, HYBRID_ACTIONS } from "./jev-hybrid-evidence.ts";
import { PILOT_AXES, type PilotSnapshot } from "./jev-pilot-core.ts";
import { GOLD_TAXONOMY } from "./gold-taxonomy.ts";
import { parseReviewV3, verifyGraphV3 } from "./pilot-evidence-v3.ts";
import { negativeHash } from "./negative-validation-core.ts";
const text = z.string().trim().min(1).max(5000), ids = z.array(z.string()).max(32),
  axis = z.enum(PILOT_AXES), prose = z.object({ text, axis, evidence_ids: ids }).strict();
const schema = z.object({ statistics_sha256: z.string(), report: z.object({
  axes: z.array(prose).length(4), positive_aspects: z.array(prose).max(32),
  negative_aspects: z.array(prose).max(32),
  conclusion: z.object({ text, evidence_ids: ids }).strict(),
  recommendations: z.array(z.object({ text, axis, evidence_ids: ids,
    action_code: z.enum(Object.keys(HYBRID_ACTIONS) as [keyof typeof HYBRID_ACTIONS, ...(keyof typeof HYBRID_ACTIONS)[]]),
  }).strict()).max(16),
}).strict() }).strict();
const ACTION_CLAIMS: Partial<Record<keyof typeof HYBRID_ACTIONS, string[]>> = {
  wait: ["service_delays"], care: ["customer_care_missing"],
  communication: ["communication_difficulty"],
  conduct: ["explicit_competence_gap"], organization: ["service_organization_problem"],
  orders: ["order_error"], cooking: ["cooking_defect"],
  value: ["value_mismatch"], price: ["high_price"], bill: ["bill_charge"],
  wayfinding: ["wayfinding_problem"], distance: ["distance_problem"],
};
type ActionEvidence = Pick<JlsPlan["selected"][number],
  "context" | "quote" | "theme_key" | "polarity" | "quote_start" | "quote_end" | "context_start">;
export function jlsActionEvidenceSupported(e: ActionEvidence, claims?: readonly string[]) {
  const graph = parseReviewV3(e.context),
    rule = verifyGraphV3(graph, e.theme_key, e.polarity),
    start = e.quote_start - e.context_start, end = e.quote_end - e.context_start;
  // Keep full-context negation, antecedents, contradictions and temporal reversals.
  // The globally ranked statement may be outside the selected citation: inspect
  // all matching statements, but bind them to this exact source span.
  if (rule.status !== "supported_by_rule" || !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) || start < 0 || end <= start || end > e.context.length ||
    e.context.slice(start, end) !== e.quote) return false;
  return graph.statements.some(s => s.theme === e.theme_key && s.polarity === e.polarity &&
    s.actionable && s.start >= start && s.end <= end && e.quote.includes(s.quote) &&
    (!claims || claims.includes(s.claim)));
}
export async function validateJlsReport(raw: unknown, p: JlsPlan, snapshot: PilotSnapshot, decisions: JlsDecision[]) {
  const dossier = await acceptedSolDossier(p, decisions);
  if (snapshot.id !== p.source_snapshot_id || snapshot.organization_id !== p.organization_id ||
    snapshot.establishment_id !== p.establishment_id || snapshot.source_sha256 !== p.source_sha256) {
    throw new Error("JLS_SNAPSHOT_CHANGED");
  }
  for (const e of p.selected) {
    const r = snapshot.source.reviews.find(r => r.id === e.review_id);
    if (!r?.analysis_text || r.analysis_language !== "en" ||
      await negativeHash(r.analysis_text) !== e.analysis_text_sha256 ||
      r.analysis_text.slice(e.quote_start, e.quote_end) !== e.quote ||
      r.analysis_text.slice(e.context_start, e.context_end) !== e.context ||
      await negativeHash(e.quote) !== e.quote_sha256 || GOLD_TAXONOMY[e.theme_key].axis !== e.axis) {
      throw new Error("JLS_EXACT_QUOTE_CHANGED");
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error("JLS_INVALID_SOL_JSON");
  const r = parsed.data;
  if (r.statistics_sha256 !== p.statistics_sha256 || await hybridHash(p.statistics) !== p.statistics_sha256) {
    throw new Error("JLS_STATISTICS_CHANGED");
  }
  if (r.report.axes.some((a, i) => a.axis !== PILOT_AXES[i])) throw new Error("JLS_AXES_INVALID");
  const all = [...r.report.axes, ...r.report.positive_aspects, ...r.report.negative_aspects,
    r.report.conclusion, ...r.report.recommendations];
  if (all.some(a => /\p{N}|https?:\/\//u.test(a.text) ||
    /\b(?:deux|trois|quatre|cinq|six|sept|huit|neuf|dix|cent|mille)\s+(?:avis|clients|mentions|commentaires)/i.test(a.text) ||
    /(?:hai|ba|bốn|năm|sáu|bảy|tám|chín|mười|trăm|nghìn)\s+(?:đánh giá|khách|lượt)/iu.test(a.text))) throw new Error("JLS_FREE_NUMERIC_CLAIM");
  for (const a of all) if (new Set(a.evidence_ids).size !== a.evidence_ids.length ||
    a.evidence_ids.some(id => !p.selected.some(e => e.evidence_id === id))) throw new Error("JLS_INVENTED_EVIDENCE");
  const safe = (a: { text: string; axis?: string; evidence_ids: string[] }, polarity?: string) => {
    const reasons: string[] = [];
    if (!a.evidence_ids.length) reasons.push("NO_ACCEPTED_EVIDENCE");
    for (const id of a.evidence_ids) {
      const e = p.selected.find(e => e.evidence_id === id)!;
      if (!dossier.accepted_ids.includes(id)) reasons.push("LUNA_REJECTED_OR_UNCERTAIN");
      if (a.axis && e.axis !== a.axis) reasons.push("AXIS_MISMATCH");
      if (polarity && e.polarity !== polarity) reasons.push("POLARITY_MISMATCH");
    }
    return { ...a, text: reasons.length ? null : a.text,
      status: reasons.length ? "review_needed" : "grounded_in_luna_accepted_evidence",
      reasons: [...new Set(reasons)] };
  };
  const recommendations = r.report.recommendations.map(a => {
    const checked = safe(a), action = HYBRID_ACTIONS[a.action_code], reasons = [...checked.reasons];
    if (a.text !== action[p.language]) reasons.push("ACTION_NOT_IN_FIXED_CATALOG");
    for (const id of a.evidence_ids) {
      const e = p.selected.find(e => e.evidence_id === id)!;
      if (action.theme && action.theme !== e.theme_key || action.polarity !== e.polarity) reasons.push("ACTION_THEME_OR_POLARITY_MISMATCH");
      // Luna verifies theme/polarity, NOT this precise recommended action.
      // V3 uncertainty never invalidates the evidence, but action grounding must abstain.
      if (!jlsActionEvidenceSupported(e, ACTION_CLAIMS[a.action_code])) reasons.push("PRECISE_ACTION_REQUIRES_REVIEW");
    }
    return { ...a, text: reasons.length ? null : action[p.language],
      status: reasons.length ? "review_needed" : "grounded_in_luna_accepted_evidence_and_rules",
      reasons: [...new Set(reasons)] };
  });
  return { statistics: p.statistics, statistics_sha256: p.statistics_sha256,
    luna_decisions: decisions, accepted_dossier_sha256: dossier.dossier_sha256,
    report: { axes: r.report.axes.map(a => safe(a)),
      positive_aspects: r.report.positive_aspects.map(a => safe(a, "positive")),
      negative_aspects: r.report.negative_aspects.map(a => safe(a, "negative")),
      conclusion: safe(r.report.conclusion), recommendations },
    raw_response_sha256: await hybridHash(raw), human_validated: false, production_enabled: false,
    limitations: "AI judgments; deterministic binding/action checks do not independently establish semantic truth" };
}
