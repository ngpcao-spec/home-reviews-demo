import {
  HYBRID_PAID_ENABLED,
  hybridHash,
  type HybridPlan,
  verifyHybridPlan,
} from "./jev-hybrid-evidence.ts";
import { validateHybridResponse } from "./jev-hybrid-validation.ts";
import type { PilotSnapshot } from "./jev-pilot-core.ts";
export interface HybridAuthorization {
  plan_sha256: string;
  dossier_sha256: string;
  prompt_sha256: string;
  schema_sha256: string;
  manual_confirmation: true;
  max_calls: 1;
  max_cost_usd: number;
  language: "fr" | "vi";
}
export interface HybridMockStore {
  begin: () => Promise<boolean>;
  finish: (result: unknown) => Promise<void>;
}
export interface ExplicitMockSol {
  kind: "explicit_test_mock";
  call: (
    request: HybridPlan["request_preview"],
  ) => Promise<
    {
      data: unknown;
      model: string;
      input_tokens: number;
      output_tokens: number;
      duration_ms: number;
      response_id: string;
    }
  >;
}
// Deployed entry point is closed regardless of env variables, saved records or API keys.
export function processHybridJob(): Promise<never> {
  if (!HYBRID_PAID_ENABLED) {
    return Promise.reject(new Error("HYBRID_PAID_EXECUTION_DISABLED"));
  }
  return Promise.reject(new Error("HYBRID_PROVIDER_BINDING_NOT_INSTALLED"));
}
// Exercise durable one-attempt semantics with injected mocks only, never a real provider binding.
export async function simulateSingleHybridJob(
  plan: HybridPlan,
  snapshot: PilotSnapshot,
  authorization: HybridAuthorization,
  store: HybridMockStore,
  sol: ExplicitMockSol,
) {
  await verifyHybridPlan(plan, snapshot);
  if (
    sol.kind !== "explicit_test_mock" ||
    authorization.manual_confirmation !== true ||
    authorization.max_calls !== 1 || authorization.language !== plan.language ||
    authorization.plan_sha256 !== await hybridHash(plan) ||
    authorization.dossier_sha256 !== plan.dossier_sha256 ||
    authorization.prompt_sha256 !== plan.prompt_sha256 ||
    authorization.schema_sha256 !== plan.schema_sha256 ||
    plan.estimates.max_sol_cost_usd === null ||
    !Number.isFinite(authorization.max_cost_usd) ||
    authorization.max_cost_usd < plan.estimates.max_sol_cost_usd
  ) throw new Error("HYBRID_EXPLICIT_AUTHORIZATION_REQUIRED");
  if (!await store.begin()) {
    return { status: "already_dispatched", new_calls: 0 };
  }
  let response;
  try {
    response = await sol.call(plan.request_preview);
  } catch {
    await store.finish({
      status: "billing_uncertain",
      request_count: 1,
      origin: "explicit_test_mock",
      automatic_retry: false,
    });
    return { status: "billing_uncertain", new_calls: 1 };
  }
  const validUsage = response && Number.isSafeInteger(response.input_tokens) &&
    response.input_tokens > 0 && Number.isSafeInteger(response.output_tokens) &&
    response.output_tokens >= 0 && typeof response.model === "string" &&
    response.model.trim() &&
    typeof response.response_id === "string" && response.response_id.trim();
  if (!validUsage) {
    await store.finish({
      status: "billing_uncertain",
      request_count: 1,
      raw_response: response,
      origin: "explicit_test_mock",
      automatic_retry: false,
    });
    return { status: "billing_uncertain", new_calls: 1 };
  }
  const cost = (response.input_tokens * plan.estimates.rates.sol_input! +
    response.output_tokens * plan.estimates.rates.sol_output!) / 1e6;
  let result, status = "completed", error_code: null | string = null;
  try {
    if (
      response.model !== "gpt-6.1-sol" &&
      !response.model.startsWith("gpt-6.1-sol-")
    ) throw new Error("HYBRID_SERVED_MODEL_CHANGED");
    result = await validateHybridResponse(response.data, plan, snapshot);
  } catch (e) {
    status = "invalid_output";
    error_code = e instanceof Error ? e.message : "HYBRID_INVALID_OUTPUT";
  }
  await store.finish({
    status,
    result: result ?? null,
    error_code,
    raw_response: response.data,
    request_count: 1,
    served_model: response.model,
    response_id: response.response_id,
    input_tokens: response.input_tokens,
    output_tokens: response.output_tokens,
    cost_usd: cost,
    duration_ms: response.duration_ms,
    origin: "explicit_test_mock",
    automatic_retry: false,
  });
  return { status, new_calls: 1 };
}
