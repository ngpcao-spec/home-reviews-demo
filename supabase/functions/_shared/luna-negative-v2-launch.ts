// Manual execution adapter. Frozen preparation/instructions/references remain unchanged.
import { DECISIONS_RATE } from "./decisions-config.ts";
import { estimateDecisionPayload } from "./decisions-preparation.ts";
import {
  NEG_CONFIG,
  NEG_ORG,
  negativeMetrics,
  type NegReferenceInput,
  type NegSet,
  parseNegativeGroup,
  scoreNegativeSet,
  verifyNegativeReferences,
  verifyNegativeSet,
} from "./luna-negative-v2.ts";
import type { E40Task } from "./decisions-evidence40.ts";
export const NV2_SET = "c8b3eee7-2554-43d9-a16b-5e12413af793";
export const NV2_SEAL = "c4031dc6-e0a3-4992-bb35-f790ecccd034";
export const NV2_DATASET_SHA =
  "6e464e2f0fa13ae1f83168b65a04e3de3e396fc0c1150d08ba71e8e30b008189";
export const NV2_REFERENCE_SHA =
  "048df28c19e95a25e426ebb08fbb58665634027f85906712072b94e788818592";
export const NV2_RUN_VERSION = "luna-negative-v2-manual-run-v1";
export const NV2_CONSENT = "luna-negative-v2-cost-confirmation-v1";
export interface NegativeLaunchSource {
  record: { id: string; body: NegSet; body_sha256: string };
  seal: {
    id: string;
    set_id: string;
    dataset_sha256: string;
    reference_sha256: string;
    body: NegReferenceInput;
  };
}
export async function negativeLaunchManifest(
  s: NegativeLaunchSource,
  testPins?: { dataset: string; reference: string },
) {
  const r = s.record, seal = s.seal;
  if (
    r.id !== NV2_SET || seal.id !== NV2_SEAL || seal.set_id !== r.id ||
    r.body_sha256 !== (testPins?.dataset ?? NV2_DATASET_SHA) ||
    seal.reference_sha256 !== (testPins?.reference ?? NV2_REFERENCE_SHA) ||
    seal.dataset_sha256 !== r.body_sha256
  ) throw new Error("NEGATIVE_V2_LAUNCH_SCOPE_CHANGED");
  await verifyNegativeSet(r.body, r.body_sha256);
  if (
    await verifyNegativeReferences(r.body, r.body_sha256, seal.body) !==
      seal.reference_sha256
  ) throw new Error("NEGATIVE_V2_REFERENCE_CHANGED");
  if (
    r.body.reviews.length !== 28 || r.body.question_count !== 32 ||
    new Set(r.body.reviews.map((x) => x.review_id)).size !== 28 ||
    new Set(r.body.reviews.map((x) => x.establishment_id)).size !== 13 ||
    r.body.config.model !== "gpt-6-luna"
  ) throw new Error("NEGATIVE_V2_LAUNCH_COUNT_CHANGED");
  const cases = r.body.reviews.map((x) => ({
    position: x.position,
    review_id: x.review_id,
    establishment_id: x.establishment_id,
    analysis_text_sha256: x.analysis_text_sha256,
    review_sha256: x.review_sha256,
    request_sha256: x.request_sha256,
    payload: x.payload,
    associations: x.associations.map((a) => ({
      association_id: a.association_id,
      theme_key: a.theme_key,
      polarity: a.polarity,
    })),
    estimated_input_tokens:
      estimateDecisionPayload(x.payload).estimated_input_tokens,
  }));
  const tokens = cases.reduce((n, x) => n + x.estimated_input_tokens, 0);
  return {
    version: NV2_RUN_VERSION,
    set_id: r.id,
    seal_id: seal.id,
    organization_id: NEG_ORG,
    dataset_sha256: r.body_sha256,
    reference_sha256: seal.reference_sha256,
    configuration_id: NEG_CONFIG.id,
    config_sha256: r.body.config_sha256,
    model: "gpt-6-luna",
    endpoint: "/v1/decisions",
    max_calls: 28,
    question_count: 32,
    repeat_count: 1,
    automatic_retry: false,
    production_enabled: false,
    estimated_input_tokens: tokens,
    estimated_cost_usd: Number((tokens * DECISIONS_RATE / 1e6).toFixed(12)),
    input_rate_per_million: DECISIONS_RATE,
    output_rate_per_million: 0,
    premiums_unverified: true,
    billed_cost_verified: false,
    cases,
  };
}
export type NegativeManifest = Awaited<
  ReturnType<typeof negativeLaunchManifest>
>;
export interface NegativeTask extends Omit<E40Task, "parsed"> {
  organization_id: string;
  parsed: ReturnType<typeof parseNegativeGroup> | null;
}
export type NegativeRunResult = Awaited<ReturnType<typeof negativeRunScore>>;
export interface NegativeRun {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "billing_uncertain";
  manifest_sha256: string;
  confirmed_at: string;
  result: NegativeRunResult | null;
  result_sha256: string | null;
}
export interface NegativeLaunchView {
  manifest: NegativeManifest;
  manifest_sha256: string;
  plan_id: string | null;
  run: NegativeRun | null;
  tasks: NegativeTask[];
  api_key_configured: boolean;
  can_confirm: boolean;
}
export async function negativeRunScore(
  source: NegativeLaunchSource,
  tasks: NegativeTask[],
  seed: string,
) {
  const s = source.record.body;
  const observations = tasks.flatMap((t) =>
      t.status === "completed" && t.parsed ? t.parsed.observations : []
    ),
    calls = tasks.filter((t) =>
      t.request_count === 1 && t.input_tokens !== null && t.cost_usd !== null
    ).map((t) => ({
      review_id: t.review_id,
      input_tokens: t.input_tokens!,
      cost_usd: t.cost_usd!,
      duration_ms: t.duration_ms ?? 0,
    }));
  const score = await scoreNegativeSet(
    s,
    source.seal.body.items,
    observations,
    calls,
    seed,
  );
  const cases = s.reviews.flatMap((r) =>
    r.associations.map((a) => {
      const ref = source.seal.body.items.find((x) =>
          x.review_id === r.review_id && x.theme_key === a.theme_key
        )!,
        t = tasks.find((t) => t.review_id === r.review_id),
        obs = observations.find((o) =>
          o.review_id === r.review_id && o.theme_key === a.theme_key
        ),
        valid = ref.choice === "both" || ref.choice === a.polarity,
        classification = ref.choice === "uncertain"
          ? "reference_uncertain"
          : !obs
          ? "response_unavailable"
          : obs.choice === "uncertain"
          ? "abstention"
          : obs.choice === "supported"
          ? valid ? "tp" : "fp"
          : valid
          ? "fn"
          : "tn";
      return {
        review_id: r.review_id,
        establishment_id: r.establishment_id,
        establishment_name: r.establishment_name,
        question_id: a.association_id,
        theme_key: a.theme_key,
        polarity: a.polarity,
        reference_choice: ref.choice,
        choice: obs?.choice ?? null,
        native_choice: typeof obs?.native_choice === "string"
          ? obs.native_choice
          : null,
        probabilities: obs?.probabilities ?? null,
        confidence: obs?.confidence ?? null,
        refused: obs?.refused ?? false,
        classification,
        status: t?.status ?? "missing",
        error_code: t?.error_code ?? null,
        analysis_text_sha256: r.analysis_text_sha256,
      };
    })
  );
  const unknown =
    tasks.filter((t) =>
      t.request_count === 1 && (t.cost_usd === null || t.input_tokens === null)
    ).length;
  return {
    ...score,
    cases,
    negative: negativeMetrics(
      {
        ...s,
        reviews: s.reviews.map((r) => ({
          ...r,
          associations: r.associations.filter((a) => a.polarity === "negative"),
        })),
      },
      source.seal.body.items,
      observations,
    ),
    execution: {
      attempts: tasks.reduce((n, t) => n + t.request_count, 0),
      max_calls: 28,
      question_count: 32,
      valid_questions: observations.length,
      successful_calls: tasks.filter((t) => t.status === "completed").length,
      failed_calls: tasks.filter((t) => t.status === "failed").length,
      billing_uncertain_calls:
        tasks.filter((t) => t.status === "billing_uncertain").length,
      cancelled_unsent: tasks.filter((t) => t.status === "cancelled").length,
      unknown_cost_calls: unknown,
      known_cost_usd: score.cost_usd,
      total_cost_usd: unknown ? null : score.cost_usd,
      api_calls: tasks.filter((t) => t.request_count === 1).length,
      input_tokens: tasks.reduce((n, t) => n + (t.input_tokens ?? 0), 0),
      output_tokens: tasks.reduce((n, t) => n + (t.output_tokens ?? 0), 0),
      duration_sum_ms: tasks.reduce((n, t) => n + (t.duration_ms ?? 0), 0),
      served_models: [
        ...new Set(
          tasks.flatMap((t) => t.served_model ? [t.served_model] : []),
        ),
      ],
      cost_is_calculated_not_verified_invoice: true,
      reference_uncertain:
        source.seal.body.items.filter((x) => x.choice === "uncertain").length,
      reference_type: "GPT6_AI_reference_not_independent_human_Gold",
    },
  };
}
