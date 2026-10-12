// Deterministic read-only preparation from existing sealed sources.
import {
  type CompactItem,
  type CompactReference,
  type CompactSeal,
  type CompactSet,
  type CompactTask,
  type CompactText,
  verifyCompactSeal,
} from "./jev-compact-core.ts";
import { validThemeDecision } from "./jev-v12-core.ts";
import { economyPrediction, economyUsage } from "./jev-economy-score.ts";
import { ECONOMY_CONFIG } from "./jev-economy-config.ts";
import { THEME_KEYS, type ThemeKey } from "./jev-themes.ts";
import { negativeHash } from "./negative-validation-core.ts";
import { localHybridTokens } from "./jev-hybrid-evidence.ts";
import {
  DECISIONS_RATE,
  DECISIONS_VERSION,
  decisionsHash,
  EVIDENCE_CONFIG,
  evidencePayload,
  LUNA_CONFIGS,
  lunaPayload,
} from "./decisions-config.ts";
import {
  type DecisionPrediction,
  type DecisionReference,
  decisionsBootstrap,
  scoreDecisions,
} from "./decisions-score.ts";
export const DECISIONS_SOURCE_SET = "e544eea5-1c9d-4b68-909e-38b68061e85f";
export interface DecisionsSource {
  set: CompactSet;
  seal: CompactSeal;
  items: CompactItem[];
  texts: CompactText[];
  references: CompactReference[];
  tasks: CompactTask[];
}
export interface EvidenceSource {
  control: {
    id: string;
    organization_id: string;
    snapshot_id: string;
    result_sha256: string;
    body: {
      items: {
        review_id: string;
        theme_key: ThemeKey;
        polarity: "positive" | "negative";
        analysis_text: string;
        analysis_text_sha256: string;
        position: number;
      }[];
    };
  };
  evaluation: { result: Record<string, unknown>; result_sha256: string };
}
export function estimateDecisionPayload(payload: unknown) {
  const raw = localHybridTokens(JSON.stringify(payload));
  return {
    serialized_request_tokens: raw,
    estimated_input_tokens: Math.ceil(raw * 1.12) + 128,
    input_only_estimated_cost_usd: (Math.ceil(raw * 1.12) + 128) *
      DECISIONS_RATE / 1e6,
    measured_input_tokens: null,
    actual_cost_usd: null,
    method:
      "local o200k_base JSON serialization + 12% + 128 framing; billing serialization/tokenizer not verified",
    regional_and_long_context_premiums_not_verified: true,
  };
}
export async function buildDecisionsPreparation(
  source: DecisionsSource,
  evidence: EvidenceSource,
  reference40: {
    source_control_id: string;
    source_control_sha256: string;
    items: {
      review_id: string;
      theme_key: ThemeKey;
      analysis_text_sha256: string;
      choice: string;
    }[];
  },
) {
  if (
    source.set.id !== DECISIONS_SOURCE_SET || source.set.status !== "sealed" ||
    source.set.organization_id !== evidence.control.organization_id
  ) throw new Error("DECISIONS_SOURCE_REQUIRED");
  await verifyCompactSeal(
    source.items,
    source.texts,
    source.references,
    source.seal,
  );
  const ids = source.items.map((i) => i.review_id);
  if (
    source.tasks.length !== 32 ||
    new Set(source.tasks.map((t) => t.review_id)).size !== 32 ||
    source.tasks.some((t) =>
      t.variant !== "A" || t.configuration_id !== ECONOMY_CONFIG.id ||
      t.status !== "completed" || t.repeat !== 1 ||
      !validThemeDecision(t.response) ||
      t.analysis_text_sha256 !==
        source.texts.find((x) =>
          x.id ===
            source.items.find((i) => i.review_id === t.review_id)?.text_id
        )?.analysis_text_sha256
    )
  ) throw new Error("DECISIONS_JEV_INCOMPLETE");
  const usedModels = [
    ...new Set(
      source.tasks.flatMap((t) => t.served_model ? [t.served_model] : []),
    ),
  ].sort();
  const predictions = ids.flatMap((review_id) =>
    THEME_KEYS.map((theme_key) => {
      const p = economyPrediction(source.tasks, review_id, theme_key, "pass1");
      return {
        review_id,
        theme_key,
        ...p,
        native_choice: source.tasks.find((t) =>
          t.review_id === review_id
        )!.response!.themes[theme_key].choice,
        confidence: null,
        status: "answered" as const,
        reason: null,
      };
    })
  );
  const baseline = scoreDecisions(ids, source.references, predictions),
    { perReview: _perReview, ...jev_score } = baseline;
  void _perReview;
  if (
    evidence.control.id !== reference40.source_control_id ||
    evidence.control.result_sha256 !== reference40.source_control_sha256 ||
    await decisionsHash(evidence.control.body) !==
      evidence.control.result_sha256 ||
    await decisionsHash(evidence.evaluation.result) !==
      evidence.evaluation.result_sha256 ||
    evidence.control.body.items.length !== 40 || reference40.items.length !== 40
  ) throw new Error("DECISIONS_EVIDENCE_CHANGED");
  const refs40 = reference40.items;
  for (const item of evidence.control.body.items) {
    const r = refs40.find((r) =>
      r.review_id === item.review_id && r.theme_key === item.theme_key
    );
    if (
      !r || r.analysis_text_sha256 !== item.analysis_text_sha256 ||
      await negativeHash(item.analysis_text) !== item.analysis_text_sha256
    ) throw new Error("DECISIONS_EVIDENCE_TEXT_CHANGED");
  }
  const configurations = await Promise.all(
    Object.entries(LUNA_CONFIGS).map(async ([variant, c]) => ({
      variant,
      body: c,
      sha256: await decisionsHash(c),
    })),
  );
  configurations.push({
    variant: "evidence",
    body: EVIDENCE_CONFIG as unknown as typeof configurations[number]["body"],
    sha256: await decisionsHash(EVIDENCE_CONFIG),
  });
  const reviews = source.items.map((i) => {
    const t = source.texts.find((t) => t.id === i.text_id)!;
    return {
      review_id: i.review_id,
      review_alias: `sealed_review_${i.position}`,
      analysis_text: t.analysis_text,
      analysis_text_sha256: t.analysis_text_sha256,
      analysis_source: t.source,
    };
  });
  const requests = await Promise.all(
    (["choice", "predicate"] as const).flatMap((variant) =>
      reviews.map(async (r) => {
        const p = lunaPayload(variant, r.review_alias, r.analysis_text);
        return {
          variant,
          review_id: r.review_id,
          analysis_text_sha256: r.analysis_text_sha256,
          request_sha256: await decisionsHash(p),
          ...estimateDecisionPayload(p),
        };
      })
    ),
  );
  const v3Cases = evidence.evaluation.result.cases as {
    review_id: string;
    theme_key: ThemeKey;
    polarity: string;
    v3_status: string;
    reference_choice: string;
  }[];
  const evidenceItems = await Promise.all(
    evidence.control.body.items.map(async (item) => {
      const p = evidencePayload(
          `reserved_case_${item.position}`,
          item.analysis_text,
          item.theme_key,
          item.polarity,
        ),
        r = refs40.find((r) =>
          r.review_id === item.review_id && r.theme_key === item.theme_key
        )!;
      return {
        ...item,
        reference_type: "posthoc_AI_not_human",
        reference_uncertain: r.choice === "uncertain",
        request_sha256: await decisionsHash(p),
        estimate: estimateDecisionPayload(p),
        v3_case: v3Cases.find((c) =>
          c.review_id === item.review_id && c.theme_key === item.theme_key
        ) ?? null,
      };
    }),
  );
  const usage = economyUsage(source.tasks),
    measuredInput = usage.input_tokens,
    jevRate = .042;
  const costs = Object.fromEntries(
    (["choice", "predicate"] as const).map((variant) => {
      const own = requests.filter((r) => r.variant === variant),
        tokens = own.reduce((n, r) => n + r.estimated_input_tokens, 0),
        usd = tokens * DECISIONS_RATE / 1e6;
      return [variant, {
        questions_per_review: variant === "choice" ? 25 : 50,
        planned_calls: 32,
        estimated_input_tokens: tokens,
        average_input_tokens: tokens / 32,
        input_only_estimate_usd: usd,
        actual_cost_usd: null,
        actual_input_tokens: null,
        break_even_input_tokens: measuredInput === null
          ? null
          : measuredInput * jevRate / DECISIONS_RATE,
        break_even_tokens_per_review: measuredInput === null
          ? null
          : measuredInput * jevRate / DECISIONS_RATE / 32,
        estimated_vs_measured_jev_cost_ratio: usage.cost_usd
          ? usd / usage.cost_usd
          : null,
        scenarios: [100, 500, 1000].map((n) => ({
          reviews: n,
          input_only_estimate_usd: usd * n / 32,
        })),
      }];
    }),
  );
  const verificationCost = evidenceItems.reduce(
      (n, r) => n + r.estimate.input_only_estimated_cost_usd,
      0,
    ),
    perEvidence = verificationCost / 40;
  return {
    version: DECISIONS_VERSION,
    organization_id: source.set.organization_id,
    source_set_id: source.set.id,
    created_by: source.set.created_by,
    status: "prepared",
    source_seal: source.seal,
    source_sha256: await decisionsHash({
      seal: source.seal,
      tasks: source.tasks,
    }),
    configurations,
    source_v12_sha256: source.seal.configuration_a_sha256,
    reviews,
    requests,
    reference_type: "sealed_GPT6_AI_not_human_gold",
    reference_count: source.references.length,
    uncertain_reference_count:
      source.references.filter((r) => r.choice === "uncertain").length,
    paired_reviews: 32,
    jev: {
      configuration: ECONOMY_CONFIG.id,
      served_models: usedModels,
      score: jev_score,
      usage,
      reused_reviews: 32,
      new_calls: 0,
      additional_cost_usd: 0,
    },
    costs,
    decision_results: null,
    rates: {
      jev_input_usd_per_million: jevRate,
      decisions_input_usd_per_million: DECISIONS_RATE,
      decisions_output_usd_per_million: 0,
      source:
        "official Decisions guide checked 2026-10-12; JEV frozen run .042",
      pricing_url: "https://developers.openai.com/api/docs/guides/decisions",
      regional_and_long_context_premiums_not_verified: true,
    },
    evidence_verification: {
      configuration: EVIDENCE_CONFIG,
      control_id: evidence.control.id,
      control_sha256: evidence.control.result_sha256,
      reference_sha256: await decisionsHash(reference40),
      reference_uncertain:
        refs40.filter((r) => r.choice === "uncertain").length,
      items: evidenceItems,
      total: 40,
      planned_calls: 40,
      input_only_estimate_usd: verificationCost,
      average_input_only_cost_usd: perEvidence,
      v3_metrics: evidence.evaluation.result.metrics,
      decision_results: null,
      previously_used_control: true,
      not_new_independent_validation: true,
      cannot_generate_quotes_or_explanations: true,
    },
    architectures: {
      common_scenario: {
        reviews: 32,
        verification_cases: 25,
        notes:
          "Illustrative workload, not paired end-to-end evaluation; reserved40 is a different dataset",
        sol_cost_usd: null,
        apify_cost_usd: null,
      },
      jev_decisions_sol: {
        new_jev_estimate_usd: usage.cost_usd,
        jev_if_reused_usd: 0,
        decision_verification_25_estimate_usd: 25 * perEvidence,
        subtotal_when_cached_usd: 25 * perEvidence,
        sol_cost_usd: null,
        total_usd: null,
      },
      decisions_sol: {
        choice_classification_estimate_usd:
          costs.choice.input_only_estimate_usd,
        predicate_classification_estimate_usd:
          costs.predicate.input_only_estimate_usd,
        sol_cost_usd: null,
        total_usd: null,
      },
      results_not_observed: true,
    },
    limitations: [
      "No paid Decisions request; account access, limits and served version unverified",
      "Full V12 definitions retained; Luna thresholds provisional and not fitted to sealed labels",
      "Local token estimates are not billed tokens; regional/long-context multipliers may apply",
      "No joint both probability inferred from predicate marginals",
      "Abstentions retained; main recall counts them as undetected labels; selective scores show coverage separately",
      "No single-pass stability can be measured",
      "GPT-6 references are AI judgments, not independent human Gold",
      "Reserved40 was already used: reuse is a retrospective diagnostic",
      "The two architectures have not been run or scored end-to-end",
      "Decisions returns typed judgments, not quotes, narrative or justifications",
    ],
    paid_enabled: false,
    production_enabled: false,
    new_paid_calls: 0,
  };
}
export type DecisionsPreparation = Awaited<
  ReturnType<typeof buildDecisionsPreparation>
>;
export async function compareDecisionsModels(
  id: string,
  ids: string[],
  refs: DecisionReference[],
  jev: DecisionPrediction[],
  choice: DecisionPrediction[],
  predicate: DecisionPrediction[],
) {
  const all = { jev, choice, predicate },
    common = ids.filter((id) =>
      Object.values(all).every((rows) =>
        THEME_KEYS.every((k) =>
          rows.some((r) =>
            r.review_id === id && r.theme_key === k && r.choice !== null
          )
        )
      )
    );
  const scores = Object.fromEntries(
    Object.entries(all).map(([v, p]) => [v, scoreDecisions(common, refs, p)]),
  );
  const bootstrap = Object.fromEntries(
    await Promise.all(
      (["choice", "predicate"] as const).map(
        async (v) => [
          v,
          Object.fromEntries(
            await Promise.all(
              (["negative", "positive", "overall"] as const).map(
                async (p) => [
                  p,
                  await decisionsBootstrap(id + v, scores.jev, scores[v], p),
                ],
              ),
            ),
          ),
        ],
      ),
    ),
  );
  return {
    paired_reviews: common.length,
    total_reviews: ids.length,
    excluded_ids: ids.filter((id) => !common.includes(id)),
    scores: Object.fromEntries(
      Object.entries(scores).map(([v, s]) => {
        const { perReview, ...rest } = s;
        void perReview;
        return [v, rest];
      }),
    ),
    selective_scores: {
      choice: scoreDecisions(common, refs, choice, true),
      predicate: scoreDecisions(common, refs, predicate, true),
    },
    bootstrap,
    reference_type: "AI_reference_not_human_gold",
    production_enabled: false,
  };
}
