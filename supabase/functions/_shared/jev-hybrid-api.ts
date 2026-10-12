import { json, preflight } from "./cors.ts";
import type { HybridPlan } from "./jev-hybrid-evidence.ts";
import type { BalancedPlan } from "./jev-hybrid-balanced.ts";
import { negativeHash } from "./negative-validation-core.ts";
import { canonicalJson } from "./jev-exploratory-core.ts";
export interface HybridPlanRecord {
  id: string;
  body: HybridPlan;
  result_sha256: string;
  created_at: string;
}
export interface HybridView {
  plan: HybridPlanRecord | null;
  balanced?: {
    id: string;
    body: BalancedPlan;
    result_sha256: string;
    created_at: string;
  } | null;
  review_texts?: {
    review_id: string;
    analysis_text: string;
    analysis_text_sha256: string;
  }[];
  control:
    | { id: string; body: Record<string, unknown>; result_sha256: string }
    | null;
  jobs: unknown[];
  paid_enabled: false;
  can_generate: false;
  production_enabled: false;
  new_paid_calls: 0;
}
export interface HybridRepository {
  read: () => Promise<HybridView>;
}
export function hybridHandler(
  repository: (r: Request) => Promise<HybridRepository>,
) {
  return async (request: Request) => {
    const p = preflight(request);
    if (p) return p;
    try {
      if (request.method !== "GET") {
        return json({ error: "HYBRID_PAID_EXECUTION_DISABLED" }, 405);
      }
      const repo = await repository(request), view = await repo.read();
      if (
        view.plan &&
        await negativeHash(canonicalJson(view.plan.body)) !==
          view.plan.result_sha256
      ) throw new Error("HYBRID_PLAN_CHANGED");
      if (
        view.balanced &&
        (await negativeHash(canonicalJson(view.balanced.body)) !==
            view.balanced.result_sha256 ||
          view.balanced.body.comparison.v1_sha256 !==
            view.plan?.result_sha256 ||
          view.balanced.body.statistics_sha256 !==
            view.plan.body.statistics_sha256 ||
          view.balanced.body.paid_enabled !== false)
      ) throw new Error("BALANCED_PLAN_CHANGED");
      return json(view);
    } catch (e) {
      const error = e instanceof Error && /^[A-Z0-9_]+$/.test(e.message)
        ? e.message
        : "HYBRID_READ_FAILED";
      return json(
        { error },
        error === "UNAUTHORIZED" ? 401 : error === "FORBIDDEN" ? 403 : 409,
      );
    }
  };
}
