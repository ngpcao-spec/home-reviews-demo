// Dedicated evidence-only runner. Historical Decisions configurations remain locked.
import {
  DECISIONS_RATE,
  decisionsHash,
  EVIDENCE_CONFIG,
  evidencePayload,
} from "./decisions-config.ts";
import { negativeHash } from "./negative-validation-core.ts";
import { THEME_KEYS, type ThemeKey } from "./jev-themes.ts";
import { ECONOMY_CONFIG } from "./jev-economy-config.ts";
import reference from "../../../docs/pilot-evidence-v3-gpt6-reserved40-reference-20261011.json" with {
  type: "json",
};

export const E40_VERSION = "openai-decisions-evidence40-run-v1";
export const E40_EXPERIMENT = "73a7bfe9-c618-4e2f-aa82-3b0fae8eb989";
export const E40_CONTROL = "3988aa10-0c5c-4a52-b1ff-1b576b488c52";
export const E40_EVALUATION = "dae5d565-6a72-4955-aa01-a4e79c218d12";
export const E40_HASHES = Object.freeze({
  preparation:
    "ee8fbe25d43503584bfc91390a74c0378b8bc4a0f81e521f4fcac13ce287db2c",
  configuration:
    "64362dacbf5c5a0a54278c9a70dd0752fe067f1906d5fe1469d449631bfeea91",
  control: "418c0f1a2dccea8bd5f29ce046dcc57a35d645710231ed540cd38dcb1ccb4391",
  evaluation:
    "cb560e3c23087ba87993c3c71c6dd10fa90caf6041f9e199dca6223f2790049a",
  reference: "5022abfc493723dcd838004cbe51088ee04286da0eb16caddba0c94d249eaf22",
  snapshot: "19ea6e88f81a6243792b0a49ec1aa2a7b3d1915272c50790940a6c5c8259bf7e",
});
type Json = Record<string, unknown>;
export interface E40Case {
  position: number;
  review_id: string;
  theme_key: ThemeKey;
  polarity: "positive" | "negative";
  analysis_text: string;
  analysis_text_sha256: string;
}
export interface E40Baseline extends E40Case {
  status: string;
  reference_choice: string;
  reference_annotation_sha256: string;
  jev: { choice: string };
  axis: string;
}
export interface E40Sources {
  experiment: {
    id: string;
    organization_id: string;
    body: {
      evidence_verification: {
        items: (E40Case & {
          request_sha256: string;
          estimate: { estimated_input_tokens: number };
        })[];
      };
    };
    result_sha256: string;
  };
  config: { body: typeof EVIDENCE_CONFIG; config_sha256: string };
  control: {
    id: string;
    organization_id: string;
    snapshot_id: string;
    body: { items: E40Case[] };
    result_sha256: string;
  };
  evaluation: {
    id: string;
    control_id: string;
    result: { cases: E40Baseline[] };
    result_sha256: string;
  };
  snapshot: {
    id: string;
    source_sha256: string;
    source: {
      google_total_reviews: unknown;
      legacy: unknown;
      reviews: (Json & {
        id: string;
        analysis_text: string | null;
        analysis_language: string;
        analysis_text_sha256: string | null;
        analysis_source: string;
        translation_provenance?: unknown;
      })[];
    };
  };
}
export async function evidence40Manifest(s: E40Sources) {
  const snapshotHashInput = {
    google_total_reviews: s.snapshot.source.google_total_reviews,
    reviews: s.snapshot.source.reviews,
    legacy: s.snapshot.source.legacy,
    configuration: ECONOMY_CONFIG.id,
    config_sha256: await decisionsHash(ECONOMY_CONFIG),
  };
  for (
    const [v, sha] of [
      [s.experiment.body, E40_HASHES.preparation],
      [s.config.body, E40_HASHES.configuration],
      [s.control.body, E40_HASHES.control],
      [s.evaluation.result, E40_HASHES.evaluation],
      [snapshotHashInput, E40_HASHES.snapshot],
      [reference, E40_HASHES.reference],
    ] as const
  ) {
    if (await decisionsHash(v) !== sha) {
      throw new Error("EVIDENCE40_SOURCE_CHANGED");
    }
  }
  if (
    s.experiment.id !== E40_EXPERIMENT || s.control.id !== E40_CONTROL ||
    s.evaluation.id !== E40_EVALUATION ||
    s.evaluation.control_id !== E40_CONTROL ||
    s.control.organization_id !== s.experiment.organization_id ||
    s.control.snapshot_id !== s.snapshot.id ||
    s.config.config_sha256 !== E40_HASHES.configuration ||
    s.experiment.result_sha256 !== E40_HASHES.preparation ||
    s.control.result_sha256 !== E40_HASHES.control ||
    s.evaluation.result_sha256 !== E40_HASHES.evaluation ||
    s.snapshot.source_sha256 !== E40_HASHES.snapshot ||
    await decisionsHash(EVIDENCE_CONFIG) !== E40_HASHES.configuration
  ) throw new Error("EVIDENCE40_SCOPE_CHANGED");
  const items = [...s.control.body.items].sort((a, b) =>
    a.position - b.position
  );
  if (
    items.length !== 40 || new Set(items.map((i) => i.review_id)).size !== 40 ||
    s.evaluation.result.cases.length !== 40 ||
    s.experiment.body.evidence_verification.items.length !== 40 ||
    reference.items.length !== 40
  ) throw new Error("EVIDENCE40_COUNT_CHANGED");
  const cases = await Promise.all(items.map(async (i, index) => {
    const r = s.snapshot.source.reviews.find((r) => r.id === i.review_id),
      ref = reference.items.find((r) =>
        r.review_id === i.review_id && r.theme_key === i.theme_key
      ),
      base = s.evaluation.result.cases.find((r) =>
        r.review_id === i.review_id && r.theme_key === i.theme_key
      ),
      prepared = s.experiment.body.evidence_verification.items.find((r) =>
        r.review_id === i.review_id && r.theme_key === i.theme_key
      );
    if (
      i.position !== index + 1 || !THEME_KEYS.includes(i.theme_key) ||
      !["positive", "negative"].includes(i.polarity) || !r ||
      r.analysis_language !== "en" || r.analysis_text !== i.analysis_text ||
      !i.analysis_text.trim() ||
      await negativeHash(i.analysis_text) !== i.analysis_text_sha256 ||
      r.analysis_text_sha256 !== i.analysis_text_sha256 || !ref || !base ||
      !prepared || ref.analysis_text_sha256 !== i.analysis_text_sha256 ||
      base.analysis_text !== i.analysis_text || base.polarity !== i.polarity ||
      base.reference_choice !== ref.choice ||
      base.reference_annotation_sha256 !== await decisionsHash(ref) ||
      prepared.polarity !== i.polarity
    ) throw new Error("EVIDENCE40_TEXT_OR_REFERENCE_CHANGED");
    const payload = evidencePayload(
        `reserved_case_${i.position}`,
        i.analysis_text,
        i.theme_key,
        i.polarity,
      ),
      request_sha256 = await decisionsHash(payload);
    if (request_sha256 !== prepared.request_sha256) {
      throw new Error("EVIDENCE40_PAYLOAD_CHANGED");
    }
    return {
      ...i,
      axis: base.axis,
      payload,
      request_sha256,
      estimated_input_tokens: prepared.estimate.estimated_input_tokens,
      analysis_source: r.analysis_source,
      translation_provenance: r.translation_provenance ?? null,
      reference_choice: ref.choice,
      reference_annotation_sha256: base.reference_annotation_sha256,
      v3_status: base.status,
      jev_choice: base.jev.choice,
    };
  }));
  const estimated_input_tokens = cases.reduce(
    (n, i) => n + i.estimated_input_tokens,
    0,
  );
  return {
    version: E40_VERSION,
    experiment_id: E40_EXPERIMENT,
    control_id: E40_CONTROL,
    organization_id: s.experiment.organization_id,
    configuration_id: EVIDENCE_CONFIG.id,
    hashes: E40_HASHES,
    model: "gpt-6-luna",
    max_calls: 40,
    repeat_count: 1,
    automatic_retry: false,
    production_enabled: false,
    cases,
    estimated_input_tokens,
    estimated_cost_usd: estimated_input_tokens * DECISIONS_RATE / 1e6,
    input_usd_per_million: DECISIONS_RATE,
    output_usd_per_million: 0,
    billed_cost_verified: false,
    premiums_unverified: true,
    reference_type: "posthoc_GPT6_AI_not_human_or_independent",
    uncertain_references: 4,
  };
}
export type E40Manifest = Awaited<ReturnType<typeof evidence40Manifest>>;
export interface E40Task {
  id: string;
  run_id: string;
  position: number;
  review_id: string;
  request_sha256: string;
  analysis_text_sha256: string;
  payload: ReturnType<typeof evidencePayload>;
  status:
    | "queued"
    | "dispatched"
    | "completed"
    | "failed"
    | "billing_uncertain"
    | "cancelled";
  request_count: 0 | 1;
  worker_id: string | null;
  parsed:
    | { status: string; confidence: number | null; refused: boolean }
    | null;
  response: unknown;
  response_sha256: string | null;
  served_model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  error_code: string | null;
}
export interface E40Run {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "billing_uncertain";
  confirmed_at: string;
  manifest_sha256: string;
}
export interface E40View {
  manifest: E40Manifest;
  manifest_sha256: string;
  plan_id: string | null;
  run: E40Run | null;
  tasks: E40Task[];
  result: ReturnType<typeof scoreEvidence40> | null;
  api_key_configured: boolean;
  beta_access_verified: false;
  new_paid_calls_in_this_request: 0;
}
export function scoreEvidence40(m: E40Manifest, tasks: E40Task[]) {
  const cases = m.cases.map((i) => {
    const task = tasks.find((t) => t.position === i.position),
      ref = i.reference_choice === "uncertain"
        ? null
        : i.reference_choice === i.polarity || i.reference_choice === "both";
    return {
      position: i.position,
      review_id: i.review_id,
      theme_key: i.theme_key,
      polarity: i.polarity,
      axis: i.axis,
      reference_supports: ref,
      luna: task?.status === "completed"
        ? task.parsed?.status ?? "uncertain"
        : "uncertain",
      v3: i.v3_status === "supported_by_rule"
        ? "supported"
        : i.v3_status === "unsupported_by_rule"
        ? "unsupported"
        : "uncertain",
      jev: i.jev_choice === i.polarity || i.jev_choice === "both"
        ? "supported"
        : "unsupported",
      error_code: task?.error_code ?? null,
    };
  });
  function metrics(rows: typeof cases, key: "luna" | "v3" | "jev") {
    const binary = rows.filter((r) => r.reference_supports !== null),
      decisive = rows.filter((r) => r[key] !== "uncertain"),
      answered = binary.filter((r) => r[key] !== "uncertain");
    const tp =
        binary.filter((r) => r.reference_supports && r[key] === "supported")
          .length,
      fp = binary.filter((r) => !r.reference_supports && r[key] === "supported")
        .length,
      tn =
        binary.filter((r) => !r.reference_supports && r[key] === "unsupported")
          .length,
      fn =
        binary.filter((r) => r.reference_supports && r[key] === "unsupported")
          .length,
      support = binary.filter((r) => r.reference_supports).length;
    const ratio = (a: number, b: number) => b ? a / b : null;
    return {
      total: rows.length,
      comparable: binary.length,
      uncertain_reference: rows.length - binary.length,
      tp,
      fp,
      tn,
      fn,
      supported_reference: support,
      abstained_supported:
        binary.filter((r) => r.reference_supports && r[key] === "uncertain")
          .length,
      abstentions: rows.length - decisive.length,
      coverage: ratio(decisive.length, rows.length),
      abstention_rate: ratio(rows.length - decisive.length, rows.length),
      selective_precision: ratio(tp, tp + fp),
      selective_agreement: ratio(tp + tn, answered.length),
      supported_recall: ratio(tp, support),
      unjustified_acceptance_rate: ratio(fp, tp + fp),
    };
  }
  return {
    version: E40_VERSION,
    reference_type: m.reference_type,
    independent_human_validation: false,
    cases,
    luna: metrics(cases, "luna"),
    v3: metrics(cases, "v3"),
    jev: metrics(cases, "jev"),
    by_axis: Object.fromEntries(
      ["quality", "service", "price", "atmosphere"].map(
        (a) => [a, metrics(cases.filter((c) => c.axis === a), "luna")],
      ),
    ),
    disagreements: cases.filter((c) => c.luna !== c.v3 || c.luna !== c.jev),
    served_models: [
      ...new Set(tasks.flatMap((t) => t.served_model ? [t.served_model] : [])),
    ],
    request_count: tasks.reduce((n, t) => n + t.request_count, 0),
    input_tokens: tasks.reduce((n, t) => n + (t.input_tokens ?? 0), 0),
    output_tokens: tasks.reduce((n, t) => n + (t.output_tokens ?? 0), 0),
    known_estimated_cost_usd: tasks.reduce((n, t) => n + (t.cost_usd ?? 0), 0),
    cost_unavailable_calls:
      tasks.filter((t) => t.request_count && t.cost_usd === null).length,
    usage_unavailable_calls:
      tasks.filter((t) => t.request_count && t.input_tokens === null).length,
    billed_cost_verified: false,
    duration_sum_ms: tasks.reduce((n, t) => n + (t.duration_ms ?? 0), 0),
    single_pass_stability: null,
  };
}
