import { DECISIONS_RATE, decisionsHash } from "./decisions-config.ts";
import { negativeHash } from "./negative-validation-core.ts";
import {
  MULTI_CONFIG,
  MULTI_ORG,
  MULTI_SOURCE_ID,
  MULTI_SOURCE_SHA,
  type MultiObservation,
  type MultiReferenceInput,
  type MultiSet,
  type parseMultiDecision,
  scoreMultirest,
  verifyMultiReferences,
} from "./luna-multirest.ts";
import type { E40Task } from "./decisions-evidence40.ts";
export const MULTI_SET_ID = "929bef2d-e841-43e0-a055-3d924d5f88b2";
export const MULTI_SEAL_ID = "44f489ae-6f7f-4e9d-8c2f-ae6cfc955d7a";
export const MULTI_LAUNCH_VERSION = "luna-multirest-manual-run-v1";
export const MULTI_CONSENT = "luna-multirest-cost-confirmation-v1";
export interface MultiLaunchSources {
  record: { id: string; body: MultiSet; body_sha256: string };
  seal: {
    id: string;
    set_id: string;
    dataset_sha256: string;
    reference_sha256: string;
    body: MultiReferenceInput;
  };
}
export async function multiLaunchManifest(s: MultiLaunchSources) {
  const { record: r, seal } = s, b = r.body;
  if (
    r.id !== MULTI_SET_ID || seal.id !== MULTI_SEAL_ID ||
    seal.set_id !== r.id || b.organization_id !== MULTI_ORG ||
    b.source_control_id !== MULTI_SOURCE_ID ||
    b.source_sha256 !== MULTI_SOURCE_SHA ||
    await decisionsHash(b) !== r.body_sha256 ||
    seal.dataset_sha256 !== r.body_sha256 ||
    b.config_sha256 !== await decisionsHash(MULTI_CONFIG) ||
    await decisionsHash(b.cases) !== b.cases_sha256 || b.cases.length !== 40 ||
    new Set(b.cases.map((c) => c.review_id)).size !== 40
  ) throw new Error("MULTIREST_LAUNCH_SOURCE_CHANGED");
  const refs = await verifyMultiReferences(b, r.body_sha256, seal.body);
  if (refs.reference_sha256 !== seal.reference_sha256) {
    throw new Error("MULTIREST_REFERENCE_CHANGED");
  }
  for (const c of b.cases) {
    const { case_sha256, ...content } = c;
    if (
      await decisionsHash(content) !== case_sha256 ||
      await negativeHash(c.analysis_text) !== c.analysis_text_sha256 ||
      await negativeHash(c.original_text) !== c.original_text_sha256 ||
      await decisionsHash(c.payload) !== c.request_sha256
    ) throw new Error("MULTIREST_CASE_CHANGED");
  }
  const eligible = b.cases.filter((c) =>
      c.evaluation_eligible && c.position !== 32 &&
      c.translation_flags.length === 0
    ),
    excluded = b.cases.filter((c) => !eligible.includes(c));
  if (
    eligible.length !== 39 || excluded.length !== 1 ||
    excluded[0].position !== 32 || excluded[0].evaluation_eligible ||
    !excluded[0].translation_flags.length
  ) throw new Error("MULTIREST_ELIGIBLE_COUNT_CHANGED");
  const cases = eligible.map((c) => ({
    position: c.position,
    review_id: c.review_id,
    establishment_id: c.establishment_id,
    theme_key: c.candidate.theme_key,
    polarity: c.candidate.polarity,
    analysis_text_sha256: c.analysis_text_sha256,
    case_sha256: c.case_sha256,
    request_sha256: c.request_sha256,
    payload: c.payload,
  }));
  const input = eligible.reduce(
    (n, c) => n + c.estimate.estimated_input_tokens,
    0,
  );
  if (
    b.estimated_input_tokens !== input ||
    b.estimated_cost_usd !== input * DECISIONS_RATE / 1e6
  ) throw new Error("MULTIREST_ESTIMATE_CHANGED");
  return {
    version: MULTI_LAUNCH_VERSION,
    set_id: r.id,
    seal_id: seal.id,
    organization_id: MULTI_ORG,
    dataset_sha256: r.body_sha256,
    reference_sha256: seal.reference_sha256,
    config_sha256: b.config_sha256,
    configuration_id: MULTI_CONFIG.id,
    model: "gpt-6-luna",
    endpoint: "/v1/decisions",
    max_calls: 39,
    repeat_count: 1,
    automatic_retry: false,
    production_enabled: false,
    estimated_input_tokens: input,
    estimated_cost_usd: input * DECISIONS_RATE / 1e6,
    input_rate_per_million: DECISIONS_RATE,
    excluded: excluded.map((c) => ({
      position: c.position,
      review_id: c.review_id,
      reason: "FROZEN_MULTILINGUAL_TEXT",
      analysis_text_sha256: c.analysis_text_sha256,
    })),
    cases,
  };
}
export type MultiManifest = Awaited<ReturnType<typeof multiLaunchManifest>>;
export interface MultiTask extends Omit<E40Task, "parsed"> {
  parsed: Awaited<ReturnType<typeof parseMultiDecision>> | null;
}
export interface MultiRun {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "billing_uncertain";
  manifest_sha256: string;
  confirmed_at: string;
  result: ReturnType<typeof scoreMultiRun> | null;
  result_sha256: string | null;
}
export interface MultiLaunchView {
  manifest: MultiManifest;
  manifest_sha256: string;
  plan_id: string | null;
  run: MultiRun | null;
  tasks: MultiTask[];
  api_key_configured: boolean;
  can_confirm: boolean;
}
export function scoreMultiRun(source: MultiLaunchSources, tasks: MultiTask[]) {
  const observations = tasks.filter((t) =>
    !["queued", "dispatched", "cancelled"].includes(t.status)
  ).map((t) => ({
    review_id: t.review_id,
    theme_key:
      source.record.body.cases.find((c) => c.review_id === t.review_id)!
        .candidate.theme_key,
    request_sha256: t.request_sha256,
    analysis_text_sha256: t.analysis_text_sha256,
    status: t.status,
    parsed: t.parsed,
    duration_ms: t.duration_ms ?? 0,
    cost_usd: t.cost_usd,
  })) as MultiObservation[];
  const score = scoreMultirest(
    source.record.body,
    source.seal.body.items,
    observations,
  );
  return {
    ...score,
    execution: {
      version: MULTI_LAUNCH_VERSION,
      max_calls: 39,
      excluded_position: 32,
      attempts: tasks.reduce((n, t) => n + t.request_count, 0),
      invalid_calls: tasks.filter((t) => t.status === "failed").length,
      billing_uncertain_calls:
        tasks.filter((t) => t.status === "billing_uncertain").length,
      cancelled_unsent: tasks.filter((t) => t.status === "cancelled").length,
      usage_unavailable_calls:
        tasks.filter((t) => t.request_count === 1 && t.input_tokens === null)
          .length,
      served_models: [
        ...new Set(
          tasks.flatMap((t) => t.served_model ? [t.served_model] : []),
        ),
      ],
      input_tokens: tasks.reduce((n, t) => n + (t.input_tokens ?? 0), 0),
      output_tokens: tasks.reduce((n, t) => n + (t.output_tokens ?? 0), 0),
      duration_sum_ms: tasks.reduce((n, t) => n + (t.duration_ms ?? 0), 0),
    },
  };
}
