// deno-lint-ignore no-import-prefix -- existing project's pinned validation library.
import { z } from "npm:zod@4.6.5";
import {
  HYBRID_ACTIONS,
  hybridHash,
  type HybridPlan,
  verifyHybridPlan,
} from "./jev-hybrid-evidence.ts";
import { THEME_KEYS } from "./jev-themes.ts";
import { PILOT_AXES, type PilotSnapshot } from "./jev-pilot-core.ts";
import { GOLD_TAXONOMY } from "./gold-taxonomy.ts";
const text = z.string().trim().min(1).max(5000),
  ids = z.array(z.string()).max(32),
  axis = z.enum(PILOT_AXES),
  prose = z.object({ text, axis, evidence_ids: ids }).strict();
const responseSchema = z.object({
  statistics_sha256: z.string(),
  verdicts: z.array(
    z.object({
      evidence_id: z.string(),
      theme_key: z.enum(
        THEME_KEYS as [
          typeof THEME_KEYS[number],
          ...typeof THEME_KEYS[number][],
        ],
      ),
      polarity: z.enum(["positive", "negative"]),
      quote: z.string().min(1).max(5000),
      status: z.enum(["supported", "unsupported", "uncertain"]),
      justification: text,
      action_codes: z.array(
        z.enum(
          Object.keys(HYBRID_ACTIONS) as [
            keyof typeof HYBRID_ACTIONS,
            ...(keyof typeof HYBRID_ACTIONS)[],
          ],
        ),
      ).max(20),
    }).strict(),
  ).max(32),
  report: z.object({
    axes: z.array(prose).length(4),
    positive_aspects: z.array(prose).max(32),
    negative_aspects: z.array(prose).max(32),
    conclusion: z.object({ text, evidence_ids: ids }).strict(),
    recommendations: z.array(
      z.object({
        text,
        axis,
        action_code: z.enum(
          Object.keys(HYBRID_ACTIONS) as [
            keyof typeof HYBRID_ACTIONS,
            ...(keyof typeof HYBRID_ACTIONS)[],
          ],
        ),
        evidence_ids: ids,
      }).strict(),
    ).max(16),
  }).strict(),
}).strict();
export async function validateHybridResponse(
  raw: unknown,
  plan: HybridPlan,
  snapshot: PilotSnapshot,
) {
  await verifyHybridPlan(plan, snapshot);
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("HYBRID_INVALID_JSON_SCHEMA");
  const p = parsed.data;
  if (p.statistics_sha256 !== plan.statistics_sha256) {
    throw new Error("HYBRID_STATISTICS_CHANGED");
  }
  if (
    p.verdicts.length !== plan.selected.length ||
    new Set(p.verdicts.map((v) => v.evidence_id)).size !== plan.selected.length
  ) throw new Error("HYBRID_VERDICT_COVERAGE_INVALID");
  for (const v of p.verdicts) {
    const e = plan.selected.find((e) => e.evidence_id === v.evidence_id);
    if (!e) throw new Error("HYBRID_INVENTED_EVIDENCE");
    if (
      v.quote !== e.quote || v.theme_key !== e.theme_key ||
      v.polarity !== e.polarity
    ) throw new Error("HYBRID_EVIDENCE_BINDING_CHANGED");
    if (
      v.action_codes.some((code) =>
        HYBRID_ACTIONS[code].theme !== null &&
          HYBRID_ACTIONS[code].theme !== e.theme_key ||
        HYBRID_ACTIONS[code].polarity !== e.polarity
      ) || v.status !== "supported" && v.action_codes.length
    ) throw new Error("HYBRID_ACTION_BINDING_CHANGED");
  }
  if (p.report.axes.some((a, i) => a.axis !== PILOT_AXES[i])) {
    throw new Error("HYBRID_AXES_INVALID");
  }
  const allTexts = [
    ...p.report.axes,
    ...p.report.positive_aspects,
    ...p.report.negative_aspects,
    p.report.conclusion,
    ...p.report.recommendations,
  ];
  if (
    allTexts.some((x) =>
      /\p{N}|https?:\/\//u.test(x.text) ||
      /\b(?:deux|trois|quatre|cinq|six|sept|huit|neuf|dix|cent|mille)\s+(?:avis|clients|mentions|commentaires)/i
        .test(x.text)
    )
  ) throw new Error("HYBRID_FREE_NUMERIC_CLAIM");
  for (const item of allTexts) {
    if (
      item.evidence_ids.some((id) =>
        !plan.selected.some((e) => e.evidence_id === id)
      )
    ) throw new Error("HYBRID_INVENTED_EVIDENCE");
  }
  const safe = (
    item: { text: string; axis?: string; evidence_ids: string[] },
    polarity?: "positive" | "negative",
  ) => {
    const reasons: string[] = [];
    if (!item.evidence_ids.length) reasons.push("NO_SUPPORTED_EVIDENCE");
    for (const id of item.evidence_ids) {
      const e = plan.selected.find((e) => e.evidence_id === id)!,
        v = p.verdicts.find((v) => v.evidence_id === id)!;
      if (v.status !== "supported") {
        reasons.push("EVIDENCE_UNSUPPORTED_OR_UNCERTAIN");
      }
      if (item.axis && e.axis !== item.axis) reasons.push("AXIS_MISMATCH");
      if (polarity && e.polarity !== polarity) {
        reasons.push("POLARITY_MISMATCH");
      }
    }
    return {
      ...item,
      text: reasons.length ? null : item.text,
      status: reasons.length
        ? "review_needed" as const
        : "supported_by_same_sol_call" as const,
      reasons: [...new Set(reasons)],
    };
  };
  const recommendations = p.report.recommendations.map((r) => {
    const checked = safe(r),
      a = HYBRID_ACTIONS[r.action_code],
      reasons = [...checked.reasons];
    if (r.text !== a[plan.language]) reasons.push("ACTION_TEXT_NOT_IN_CATALOG");
    if (a.theme && GOLD_TAXONOMY[a.theme].axis !== r.axis) {
      reasons.push("ACTION_AXIS_MISMATCH");
    }
    for (const id of r.evidence_ids) {
      if (
        !p.verdicts.find((v) => v.evidence_id === id)!.action_codes.includes(
          r.action_code,
        )
      ) reasons.push("ACTION_NOT_SUPPORTED_BY_EACH_PROOF");
    }
    return {
      ...r,
      text: reasons.length ? null : a[plan.language],
      status: reasons.length ? "review_needed" : "supported_by_same_sol_call",
      reasons: [...new Set(reasons)],
    };
  });
  return {
    statistics: plan.analytics,
    statistics_sha256: plan.statistics_sha256,
    verdicts: p.verdicts.map((v) => ({
      ...v,
      review_id:
        plan.selected.find((e) => e.evidence_id === v.evidence_id)!.review_id,
      analysis_text_sha256:
        plan.selected.find((e) => e.evidence_id === v.evidence_id)!
          .analysis_text_sha256,
      quote_sha256: plan.selected.find((e) => e.evidence_id === v.evidence_id)!
        .quote_sha256,
      source: "sol_same_verification_writing_call",
      human_validated: false,
    })),
    report: {
      axes: p.report.axes.map((a) => safe(a)),
      positive_aspects: p.report.positive_aspects.map((a) =>
        safe(a, "positive")
      ),
      negative_aspects: p.report.negative_aspects.map((a) =>
        safe(a, "negative")
      ),
      conclusion: safe(p.report.conclusion),
      recommendations,
    },
    raw_response_sha256: await hybridHash(raw),
    independent_semantic_validation: false,
    human_validated: false,
    production_enabled: false,
    deterministic_validation_scope:
      "JSON/hash/quote/ID/axis/polarity/action-catalog/numbers; not independent semantic truth",
  };
}
