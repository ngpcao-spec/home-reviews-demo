// Evaluation only. This module never changes the frozen verifier or invokes a provider.
import {
  parseReviewV3,
  type V3Decision,
  verifyGraphV3,
} from "./pilot-evidence-v3.ts";
import { v3PipelineHash } from "./pilot-evidence-v3-audit.ts";
import { canonicalJson } from "./jev-exploratory-core.ts";
import { negativeHash } from "./negative-validation-core.ts";
import {
  economicThemeResults,
  type EconomyCache,
  economyCacheKey,
  economyIdentity,
  reusableEconomyCache,
} from "./jev-economy-cache.ts";
import { GOLD_TAXONOMY, type GoldChoice } from "./gold-taxonomy.ts";
import type { ThemeKey } from "./jev-themes.ts";
import type { EvidenceV21Binding } from "./pilot-evidence-v21-audit.ts";
export const RESERVED_EVALUATION_VERSION =
  "pilot-evidence-v3-reserved40-evaluation-v1";
export const FROZEN_ENGINE_COMMIT = "91e76d8a4c130ce3b3565cbbc74771e286b0df48";
export const FROZEN_REFERENCE_COMMIT =
  "b64f571d36ca389cdf459b1311c35938848ce1f7";
export const FROZEN_PIPELINE_SHA =
  "4fd4dc9eb81e386c9e1c805a74e6494297ce5c640fdf61199e36a556f50d582a";
export interface ReservedItem {
  position: number;
  review_id: string;
  theme_key: ThemeKey;
  polarity: "positive" | "negative";
  axis: string;
  binding_id: string;
  analysis_text: string;
  analysis_text_sha256: string;
}
export interface ReservedSource {
  control: {
    id: string;
    result_sha256: string;
    organization_id: string;
    snapshot_id: string;
    created_by: string;
    body: { items: ReservedItem[]; source_sha256: string };
  };
  snapshot: {
    id: string;
    source_sha256: string;
    organization_id: string;
    establishment_id: string;
  };
  v21: { id: string; rule_sha256: string; result_sha256: string };
  rows: {
    item: ReservedItem;
    snapshot_review: {
      id: string;
      analysis_text: string;
      analysis_language: string;
      analysis_text_sha256: string;
      original_text: string;
      original_text_sha256: string;
    };
    v21_binding: EvidenceV21Binding;
    jev_cache: EconomyCache & {
      theme_results: ReturnType<typeof economicThemeResults>;
    };
  }[];
}
export interface ReservedReference {
  schema_version: string;
  annotation_type: string;
  source_control_id: string;
  source_control_sha256: string;
  snapshot_id: string;
  snapshot_sha256: string;
  selection_frozen_before_annotation: boolean;
  annotated_without_v3_on_control: boolean;
  count: number;
  counts: Record<string, number>;
  sampling_limitations: string[];
  items: {
    position: number;
    review_id: string;
    theme_key: ThemeKey;
    analysis_text_sha256: string;
    choice: GoldChoice;
    justification: string;
  }[];
}
export interface EvaluationManifest {
  engine_commit: typeof FROZEN_ENGINE_COMMIT;
  reference_commit: typeof FROZEN_REFERENCE_COMMIT;
  engine_files: { path: string; git_blob_sha256: string }[];
  engine_files_sha256: string;
  reference_file_sha256: string;
  reference_canonical_sha256: string;
  posthoc_file_sha256: string;
  runtime: string;
}
export const evaluationHash = (v: unknown) => negativeHash(canonicalJson(v));
// No reference labels are passed here. Only frozen English text, theme and candidate polarity.
export function runFrozenV3(source: ReservedSource) {
  return source.control.body.items.map((item) => ({
    position: item.position,
    review_id: item.review_id,
    theme_key: item.theme_key,
    polarity: item.polarity,
    analysis_text_sha256: item.analysis_text_sha256,
    decision: verifyGraphV3(
      parseReviewV3(item.analysis_text),
      item.theme_key,
      item.polarity,
    ),
  }));
}
export async function verifyReservedInputs(
  source: ReservedSource,
  reference: ReservedReference,
  posthoc: { cases: { review_id: string; jev_v21_binding_id: string }[] },
  manifest: EvaluationManifest,
) {
  const fail = (error: string): never => {
    throw new Error(error);
  };
  if (
    manifest.engine_commit !== FROZEN_ENGINE_COMMIT ||
    manifest.reference_commit !== FROZEN_REFERENCE_COMMIT ||
    await v3PipelineHash() !== FROZEN_PIPELINE_SHA ||
    await evaluationHash(manifest.engine_files) !==
      manifest.engine_files_sha256 ||
    await evaluationHash(reference) !== manifest.reference_canonical_sha256
  ) fail("RESERVED_FROZEN_ARTIFACT_CHANGED");
  if (
    source.control.id !== reference.source_control_id ||
    source.control.result_sha256 !== reference.source_control_sha256 ||
    await evaluationHash(source.control.body) !==
      source.control.result_sha256 ||
    source.snapshot.id !== source.control.snapshot_id ||
    source.snapshot.id !== reference.snapshot_id ||
    source.snapshot.source_sha256 !== reference.snapshot_sha256 ||
    source.control.body.source_sha256 !== source.snapshot.source_sha256 ||
    source.snapshot.organization_id !== source.control.organization_id
  ) fail("RESERVED_SOURCE_CHANGED");
  if (
    reference.annotation_type !== "chatgpt_ai_reference" ||
    !reference.selection_frozen_before_annotation ||
    !reference.annotated_without_v3_on_control || reference.count !== 40 ||
    reference.items.length !== 40 || source.control.body.items.length !== 40 ||
    source.rows.length !== 40 || posthoc.cases.length !== 199
  ) fail("RESERVED_SCOPE_INVALID");
  const ids = new Set<string>(),
    pairs = new Set<string>(),
    counts: Record<string, number> = {
      absent: 0,
      positive: 0,
      negative: 0,
      both: 0,
      uncertain: 0,
    };
  for (const item of source.control.body.items) {
    const pair = item.review_id + ":" + item.theme_key,
      ref = reference.items.find((r) => r.position === item.position),
      row = source.rows.find((r) => r.item.position === item.position);
    if (!ref || !row) throw new Error("RESERVED_REFERENCE_BINDING_CHANGED");
    if (
      ids.has(item.review_id) || pairs.has(pair) ||
      ref.review_id !== item.review_id || ref.theme_key !== item.theme_key ||
      ref.analysis_text_sha256 !== item.analysis_text_sha256 ||
      !(ref.choice in counts) || item.position < 1 || item.position > 40
    ) fail("RESERVED_REFERENCE_BINDING_CHANGED");
    ids.add(item.review_id);
    pairs.add(pair);
    counts[ref.choice]++;
    if (
      posthoc.cases.some((c) =>
        c.review_id === item.review_id ||
        c.jev_v21_binding_id === item.binding_id
      )
    ) fail("RESERVED_OVERLAP_WITH_199");
    if (
      canonicalJson(row.item) !== canonicalJson(item) ||
      row.snapshot_review.id !== item.review_id ||
      row.snapshot_review.analysis_language !== "en" ||
      row.snapshot_review.analysis_text !== item.analysis_text ||
      await negativeHash(item.analysis_text) !== item.analysis_text_sha256 ||
      row.snapshot_review.analysis_text_sha256 !== item.analysis_text_sha256 ||
      await negativeHash(row.snapshot_review.original_text) !==
        row.snapshot_review.original_text_sha256
    ) fail("RESERVED_TEXT_CHANGED");
    const b = row.v21_binding,
      c = row.jev_cache,
      identity = await economyIdentity(
        source.snapshot.organization_id,
        source.snapshot.establishment_id,
        item.review_id,
        item.analysis_text,
        c.served_model!,
      );
    if (
      b.binding_id !== item.binding_id || b.review_id !== item.review_id ||
      b.theme_key !== item.theme_key || b.polarity !== item.polarity ||
      b.analysis_text_sha256 !== item.analysis_text_sha256 ||
      b.axis !== GOLD_TAXONOMY[item.theme_key].axis || item.axis !== b.axis ||
      c.id !== b.cache_id ||
      !reusableEconomyCache(c, identity, await economyCacheKey(identity))
    ) fail("RESERVED_PREDICTION_BINDING_CHANGED");
    if (
      await evaluationHash({
          cache_key: c.cache_key,
          response: c.response,
          theme_results: c.theme_results,
          served_model: c.served_model,
        }) !== b.cache_response_sha256 ||
      !c.response ||
      canonicalJson(economicThemeResults(c.response)) !==
        canonicalJson(c.theme_results)
    ) fail("RESERVED_CACHE_CHANGED");
  }
  if (
    new Set(reference.items.map((i) => i.position)).size !== 40 ||
    canonicalJson(counts) !== canonicalJson(reference.counts) ||
    counts.uncertain !== 4
  ) fail("RESERVED_REFERENCE_COUNTS_CHANGED");
}
export type EvaluationCategory =
  | "justified_accepted"
  | "unjustified_accepted"
  | "justified_pending"
  | "unjustified_rejected"
  | "justified_rejected"
  | "unjustified_pending"
  | "reference_uncertain";
export function referenceSupports(
  choice: GoldChoice,
  polarity: "positive" | "negative",
) {
  return choice === "uncertain"
    ? null
    : choice === polarity || choice === "both";
}
export function evaluationCategory(
  status: V3Decision["status"],
  supported: boolean | null,
): EvaluationCategory {
  if (supported === null) return "reference_uncertain";
  return supported
    ? status === "supported_by_rule"
      ? "justified_accepted"
      : status === "unsupported_by_rule"
      ? "justified_rejected"
      : "justified_pending"
    : status === "supported_by_rule"
    ? "unjustified_accepted"
    : status === "unsupported_by_rule"
    ? "unjustified_rejected"
    : "unjustified_pending";
}
const ratio = (n: number, d: number) => ({
  numerator: n,
  denominator: d,
  value: d ? n / d : null,
});
export function reservedMetrics(
  rows: {
    reference_choice: GoldChoice;
    reference_supports: boolean | null;
    status: V3Decision["status"];
  }[],
) {
  const all = rows.length,
    comparable = rows.filter((r) => r.reference_supports !== null),
    counts = Object.fromEntries(
      ([
        "justified_accepted",
        "unjustified_accepted",
        "justified_pending",
        "unjustified_rejected",
        "justified_rejected",
        "unjustified_pending",
        "reference_uncertain",
      ] as const).map((c) => [
        c,
        rows.filter((r) =>
          evaluationCategory(r.status, r.reference_supports) === c
        ).length,
      ]),
    ) as Record<EvaluationCategory, number>;
  const accepted = counts.justified_accepted + counts.unjustified_accepted,
    rejected = counts.unjustified_rejected + counts.justified_rejected,
    pending = comparable.length - accepted - rejected,
    totalPending = rows.filter((r) => r.status === "review_needed").length;
  return {
    total: all,
    comparable: comparable.length,
    reference_uncertain: all - comparable.length,
    reference_supported: comparable.filter((r) => r.reference_supports).length,
    reference_unsupported:
      comparable.filter((r) => !r.reference_supports).length,
    counts,
    decisive_coverage_all: ratio(all - totalPending, all),
    decisive_coverage_comparable: ratio(accepted + rejected, comparable.length),
    abstention_all: ratio(totalPending, all),
    abstention_comparable: ratio(pending, comparable.length),
    acceptance_precision: ratio(counts.justified_accepted, accepted),
    unjustified_acceptance_rate: ratio(counts.unjustified_accepted, accepted),
    unjustified_acceptance_per_comparable: ratio(
      counts.unjustified_accepted,
      comparable.length,
    ),
    selective_agreement: ratio(
      counts.justified_accepted + counts.unjustified_rejected,
      accepted + rejected,
    ),
    strict_agreement_all_comparable: ratio(
      counts.justified_accepted + counts.unjustified_rejected,
      comparable.length,
    ),
    justified_acceptance_coverage: ratio(
      counts.justified_accepted,
      comparable.filter((r) => r.reference_supports).length,
    ),
  };
}
export async function buildReservedEvaluation(
  source: ReservedSource,
  outputs: ReturnType<typeof runFrozenV3>,
  reference: ReservedReference,
  posthoc: Parameters<typeof verifyReservedInputs>[2],
  manifest: EvaluationManifest,
) {
  await verifyReservedInputs(source, reference, posthoc, manifest);
  if (canonicalJson(outputs) !== canonicalJson(runFrozenV3(source))) {
    throw new Error("RESERVED_V3_OUTPUT_CHANGED");
  }
  const cases = await Promise.all(outputs.map(async (output) => {
    const item = source.control.body.items.find((i) =>
        i.position === output.position
      )!,
      row = source.rows.find((r) => r.item.position === item.position)!,
      ref = reference.items.find((i) => i.position === item.position)!,
      supported = referenceSupports(ref.choice, item.polarity),
      p = output.decision.statement;
    if (p && (item.analysis_text.slice(p.start, p.end) !== p.quote)) {
      throw new Error("RESERVED_QUOTE_CHANGED");
    }
    return {
      ...output,
      axis: item.axis,
      analysis_text: item.analysis_text,
      reference_choice: ref.choice,
      reference_justification: ref.justification,
      reference_supports: supported,
      reference_annotation_sha256: await evaluationHash(ref),
      category: evaluationCategory(output.decision.status, supported),
      status: output.decision.status,
      quote_sha256: p ? await negativeHash(p.quote) : null,
      v21: {
        status: row.v21_binding.status,
        reason: row.v21_binding.reason,
        excerpt: row.v21_binding.excerpt,
        binding_id: row.v21_binding.binding_id,
      },
      jev: {
        cache_id: row.jev_cache.id,
        cache_response_sha256: row.v21_binding.cache_response_sha256,
        choice: row.jev_cache.theme_results[item.theme_key].choice,
        probabilities: row.jev_cache.theme_results[item.theme_key],
        served_model: row.jev_cache.served_model,
        configuration_id: row.jev_cache.configuration_id,
      },
    };
  }));
  const metricInputs = (version: "v3" | "v21" | "jev") =>
    cases.map((c) => ({
      reference_choice: c.reference_choice,
      reference_supports: c.reference_supports,
      status: version === "v3"
        ? c.status
        : version === "v21"
        ? c.v21.status
        : (c.jev.choice === c.polarity || c.jev.choice === "both"
          ? "supported_by_rule"
          : "unsupported_by_rule") as V3Decision["status"],
    }));
  const versions = ["v3", "v21", "jev"] as const;
  return {
    version: RESERVED_EVALUATION_VERSION,
    control_id: source.control.id,
    control_sha256: source.control.result_sha256,
    snapshot_id: source.snapshot.id,
    snapshot_sha256: source.snapshot.source_sha256,
    organization_id: source.control.organization_id,
    v21_audit_id: source.v21.id,
    v21_result_sha256: source.v21.result_sha256,
    manifest,
    rule_sha256: FROZEN_PIPELINE_SHA,
    frozen_verifier_outputs_sha256: await evaluationHash(outputs),
    reference_type: "chatgpt_ai_reference_not_human_gold",
    independent_human_validation: false,
    sampling_limitations: reference.sampling_limitations,
    definitions: {
      decisive_coverage:
        "supported_by_rule or unsupported_by_rule, divided by all or comparable cases as labelled",
      selective_agreement:
        "correct accepts plus correct rejections / decisive comparable cases; abstentions excluded",
      strict_agreement:
        "correct accepts plus correct rejections / all comparable cases; abstentions not counted as agreement",
      unjustified_acceptance_rate:
        "incorrect accepts / accepted comparable associations; not global JEV precision",
      justified_acceptance_coverage:
        "justified accepted / reference-supported associations",
      jev_baseline:
        "selected JEV associations, not all 25-theme predictions; no absent-theme accuracy inferred",
    },
    cases,
    metrics: Object.fromEntries(
      versions.map((v) => [v, reservedMetrics(metricInputs(v))]),
    ),
    by_axis: Object.fromEntries(
      ["service", "quality", "price", "atmosphere"].map(
        (axis) => [
          axis,
          Object.fromEntries(
            versions.map(
              (v) => [
                v,
                reservedMetrics(
                  metricInputs(v).filter((_, i) => cases[i].axis === axis),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
    jev_exact_choice_agreement: ratio(
      cases.filter((c) =>
        c.reference_choice !== "uncertain" &&
        c.reference_choice === c.jev.choice
      ).length,
      cases.filter((c) => c.reference_choice !== "uncertain").length,
    ),
    overlap_with_199: 0,
    reference_labels_changed: false,
    engine_changed: false,
    production_enabled: false,
    new_paid_calls: 0,
    immutable: true,
  };
}
export type ReservedEvaluation = Awaited<
  ReturnType<typeof buildReservedEvaluation>
>;
