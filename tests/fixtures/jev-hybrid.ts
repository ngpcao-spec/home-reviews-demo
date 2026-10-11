import { syntheticEvidence } from "./pilot-evidence.ts";
import {
  buildHybridPlan,
  HYBRID_ACTIONS,
  hybridHash,
  type HybridPlan,
} from "../../supabase/functions/_shared/jev-hybrid-evidence.ts";
import { PILOT_AXES } from "../../supabase/functions/_shared/jev-pilot-core.ts";
import type { HybridAuthorization } from "../../supabase/functions/_shared/jev-hybrid-worker.ts";
export async function hybridFixture(language: "fr" | "vi" = "fr") {
  const f = await syntheticEvidence();
  const plan = await buildHybridPlan(f.snapshot, f.cache, [], language);
  return { ...f, plan };
}
// Only explicit unit-test mocks; never persisted or shown as a real Sol response.
export function mockHybridSol(plan: HybridPlan) {
  const codes = (e: HybridPlan["selected"][number]) =>
    Object.entries(HYBRID_ACTIONS).filter(([, a]) =>
      (a.theme === null || a.theme === e.theme_key) && a.polarity === e.polarity
    ).map(([code]) => code);
  const negative = plan.selected.find((e) =>
      e.polarity === "negative" && codes(e).length
    ),
    code = negative ? codes(negative)[0] as keyof typeof HYBRID_ACTIONS : null;
  return {
    statistics_sha256: plan.statistics_sha256,
    verdicts: plan.selected.map((e) => ({
      evidence_id: e.evidence_id,
      theme_key: e.theme_key,
      polarity: e.polarity,
      quote: e.quote,
      status: "supported",
      justification: "Explicit test mock, not a real model verification.",
      action_codes: codes(e),
    })),
    report: {
      axes: PILOT_AXES.map((axis) => ({
        axis,
        text: plan.language === "fr"
          ? "Consulter les preuves pour cet axe."
          : "Xem bằng chứng cho trục này.",
        evidence_ids: plan.selected.filter((e) => e.axis === axis).slice(0, 1)
          .map((e) => e.evidence_id),
      })),
      positive_aspects: [],
      negative_aspects: [],
      conclusion: {
        text: plan.language === "fr"
          ? "La conclusion reste limitée aux avis analysés."
          : "Kết luận chỉ giới hạn trong đánh giá đã phân tích.",
        evidence_ids: plan.selected.slice(0, 1).map((e) => e.evidence_id),
      },
      recommendations: negative && code
        ? [{
          axis: negative.axis,
          text: HYBRID_ACTIONS[code][plan.language],
          action_code: code,
          evidence_ids: [negative.evidence_id],
        }]
        : [],
    },
  };
}
export async function mockHybridAuthorization(
  plan: HybridPlan,
): Promise<HybridAuthorization> {
  return {
    plan_sha256: await hybridHash(plan),
    dossier_sha256: plan.dossier_sha256,
    prompt_sha256: plan.prompt_sha256,
    schema_sha256: plan.schema_sha256,
    manual_confirmation: true,
    max_calls: 1,
    max_cost_usd: plan.estimates.max_sol_cost_usd!,
    language: plan.language,
  };
}
