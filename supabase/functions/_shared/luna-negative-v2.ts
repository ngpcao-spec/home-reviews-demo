// Free preparation only: candidates are neither JEV predictions nor reference labels.
import {
  type AnalysisReview,
  analysisTextForFreshReview,
} from "./analysis-text.ts";
import {
  decisionsHash,
  EVIDENCE_CONFIG,
  evidencePayload,
} from "./decisions-config.ts";
import { estimateDecisionPayload } from "./decisions-preparation.ts";
import { THEME_KEYS, type ThemeKey } from "./jev-themes.ts";
import {
  GOLD_CHOICES,
  GOLD_TAXONOMY,
  type GoldChoice,
} from "./gold-taxonomy.ts";
import { parseReviewV3 } from "./pilot-evidence-v3.ts";
import { canonicalJson } from "./jev-exploratory-core.ts";
import { v3PipelineHash } from "./pilot-evidence-v3-audit.ts";
import { calibration } from "./decisions-score.ts";
import {
  parseDecisionEnvelope,
  parseEvidenceDecision,
} from "./decisions-config.ts";

export const NEG_VERSION = "luna-negative-focused-v2";
export const NEG_ORG = "93228bbb-6397-41e3-b8be-21ee7060eda7";
export const NEG_CONFIG = Object.freeze({
  ...EVIDENCE_CONFIG,
  id: "luna-negative-focused-v2-choice-v1",
  protocol: NEG_VERSION,
  model: "gpt-6-luna",
  max_reviews: 32,
  max_questions: 40,
  max_future_calls: 32,
  repeat_count: 1,
  automatic_retry: false,
  paid_enabled: false,
  production_enabled: false,
  reference_seal_required: true,
  new_authorization_required: true,
  manual_cost_confirmation_required: true,
});
// Lexical candidate screening only; no claim of complete semantic understanding.
export const NEG_SELECTOR = Object.freeze({
  version: "negative-focused-stratified-text-v1",
  targets: { low_mid: 8, mixed_five: 12, positive_control: 12 },
  priorities: [
    "food_quality",
    "temperature",
    "cooking",
    "portions",
    "wait_time",
    "attentiveness",
    "professionalism",
    "communication",
    "price_level",
    "value",
    "billing",
    "atmosphere",
  ] as ThemeKey[],
  review_ranking: "least_selected_restaurant_then_sha256",
  association_ranking: "negative_signal_then_priority_then_sha256",
  control_probe: "every_fourth_positive_control_opposite_polarity_same_theme",
  historical_exclusion:
    "all_uuid_values_and_keys_in_all_analysis_and_historical_tables_including_json_arrays; conservative",
  max_per_review: 2,
  max_questions: 40,
  selection_uses_reference: false,
  selection_uses_predictions: false,
});
type Polarity = "positive" | "negative";
type Bucket = keyof typeof NEG_SELECTOR.targets;
export interface NegInput extends AnalysisReview {
  review_id: string;
  organization_id: string;
  establishment_id: string;
  establishment_name: string;
  rating: number;
  original_text: string;
  original_language: string | null;
}
export interface NegInventory {
  history_tables: string[];
  historical_review_ids: number;
  total_text_reviews: number;
  unused: NegInput[];
}
export interface NegAssociation {
  association_id: string;
  theme_key: ThemeKey;
  polarity: Polarity;
  method: string;
  selection_hash: string;
  quote: string | null;
}
export interface NegReview {
  position: number;
  review_id: string;
  establishment_id: string;
  establishment_name: string;
  overall_rating: number;
  original_language: string | null;
  original_text: string;
  original_text_sha256: string;
  analysis_text: string;
  analysis_text_sha256: string;
  analysis_source: string;
  translation_provenance: unknown;
  selection_bucket: Bucket;
  selection_hash: string;
  associations: NegAssociation[];
  payload: ReturnType<typeof evidencePayload>;
  request_sha256: string;
  review_sha256: string;
  estimated_input_tokens: number;
  estimated_cost_usd: number;
}
export interface NegSet {
  version: typeof NEG_VERSION;
  organization_id: string;
  config: typeof NEG_CONFIG;
  config_sha256: string;
  selector: typeof NEG_SELECTOR;
  selector_sha256: string;
  created_at: string;
  reviews: NegReview[];
  reviews_sha256: string;
  review_count: number;
  question_count: number;
  future_calls: number;
  estimated_input_tokens: number;
  estimated_cost_usd: number;
  ungrouped_estimated_input_tokens: number;
  ungrouped_estimated_cost_usd: number;
  star_distribution: Record<string, number>;
  theme_distribution: Record<string, { positive: number; negative: number }>;
  restaurants: { id: string; name: string; reviews: number }[];
  inventory: {
    history_tables: string[];
    historical_review_ids: number;
    total_text_reviews: number;
    unused_with_original: number;
    english_admissible: number;
    available: Record<Bucket, number>;
    selected: Record<Bucket, number>;
    shortfalls: Record<Bucket, number>;
    excluded_counts: Record<string, number>;
    excluded: { review_id: string; establishment_id: string; reason: string }[];
  };
  reference_count: 0;
  paid_enabled: false;
  production_enabled: false;
  new_paid_calls: 0;
  limits: string[];
}
const negativePatterns: Partial<Record<ThemeKey, RegExp>> = {
  food_quality:
    /\b(?:tasteless|bland|greasy|not (?:very )?(?:tasty|good|delicious)|wasn't very good|food (?:tastes? )?(?:so-so|bad|average)|too tough)\b/i,
  temperature:
    /\b(?:food|dish|soup|meal|pizza)\b.{0,32}\b(?:cold|lukewarm|not hot)\b/i,
  cooking:
    /\b(?:overcooked|undercooked|burnt|burned|raw inside|too salty|too sweet|too much salt)\b/i,
  portions:
    /\b(?:portion|combo|oyster|dish|meal)s?\b.{0,35}\b(?:small|tiny|not enough)\b|\b(?:wasn't full|still hungry|small portions?)\b/i,
  wait_time:
    /\b(?:slow service|long wait|waited.{0,15}(?:minutes|hour)|service.{0,15}slow)\b/i,
  attentiveness:
    /\b(?:difficult to get the staff|could be.{0,15}more attentive|ignored us|no (?:waiter|staff)|nobody.{0,20}(?:help|serve))\b/i,
  professionalism:
    /\b(?:unprofessional|incompetent|staff.{0,15}(?:didn't know|did not know))\b/i,
  communication:
    /\b(?:could not understand|couldn't understand|language barrier|misunderstood|didn't explain|did not explain)\b/i,
  price_level: /\b(?:expensive|overpriced|pricey)\b/i,
  value:
    /\b(?:not worth|isn't worth|wasn't worth|expensive for.{0,30}(?:service|food|what|you get))\b/i,
  billing:
    /\b(?:markup|surcharge|VAT.{0,20}added|DOES NOT INCLUDE VAT|VAT is added|overcharged|bill.{0,15}(?:wrong|error))\b/i,
  atmosphere:
    /\b(?:bad atmosphere|unpleasant atmosphere|atmosphere.{0,20}(?:bad|unpleasant))\b/i,
  noise: /\b(?:noisy|too loud)\b/i,
  comfort:
    /\b(?:no air conditioning|almost cold during|noisy and hot|too hot|uncomfortable)\b/i,
  order_accuracy:
    /\b(?:forgot (?:our|the)|wrong order|missing.{0,15}(?:order|dish))\b/i,
  cleanliness: /\b(?:dirty|cockroach|unhygienic)\b/i,
};
export async function negativeSelectorHash() {
  return decisionsHash({
    selector: NEG_SELECTOR,
    criticism_patterns: Object.entries(negativePatterns).map(([theme, re]) => ({
      theme,
      source: re.source,
      flags: re.flags,
    })),
    english_screen_version: "conservative_source_script_sentence_marker_v1",
    v3_rules_sha256: await v3PipelineHash(),
  });
}
export function englishFlags(text: string, source: string) {
  const flags: string[] = [];
  if (
    ![
      "original_en",
      "google_translation_en",
      "verified_translation_override_en",
    ].includes(source)
  ) flags.push("MISSING_VERIFIED_EN_SOURCE");
  if (!text.trim()) flags.push("TEXTLESS");
  if (
    /[\p{Script=Cyrillic}\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Hebrew}\p{Script=Arabic}]/u
      .test(text)
  ) flags.push("MIXED_OR_NON_EN_SCRIPT");
  if (
    /\b(?:nhân viên|chúng tôi|đồ ăn|món ăn|không ngon|rất ngon|cảm ơn|le service|très bon|pas cher|la nourriture)\b/iu
      .test(text)
  ) flags.push("NON_EN_SENTENCE");
  if (
    !/\b(?:the|and|is|are|was|were|food|service|staff|good|great|nice|delicious|friendly|place|pizza|restaurant|very|we|i|it|but|with|best|tasty|excellent|recommend|coffee|atmosphere)\b/i
      .test(text)
  ) flags.push("EN_LANGUAGE_UNCERTAIN");
  return flags;
}
export async function candidates(review_id: string, text: string) {
  const graph = parseReviewV3(text);
  const all: {
    theme_key: ThemeKey;
    polarity: Polarity;
    method: string;
    quote: string | null;
    selection_hash: string;
  }[] = [];
  for (const theme of THEME_KEYS) {
    const pattern = negativePatterns[theme];
    if (!pattern) continue;
    const match = text.match(pattern);
    if (!match) continue;
    // Not expensive is not a negative price signal; negations remain context for Luna.
    if (
      theme === "price_level" &&
      /\b(?:not|isn't|wasn't)\s+(?:that\s+|very\s+)?expensive\b/i.test(text) &&
      !text.replace(
        /\b(?:not|isn't|wasn't)\s+(?:that\s+|very\s+)?expensive\b/ig,
        "",
      ).match(pattern)
    ) continue;
    all.push({
      theme_key: theme,
      polarity: "negative",
      method: "lexical_criticism_candidate_unverified",
      quote: match[0],
      selection_hash: await decisionsHash(
        NEG_VERSION + review_id + theme + "negative",
      ),
    });
  }
  for (const s of graph.statements) {
    if (
      s.time !== "past" &&
      !all.some((c) => c.theme_key === s.theme && c.polarity === s.polarity)
    ) {
      all.push({
        theme_key: s.theme,
        polarity: s.polarity,
        method: "v3_statement_candidate_not_reference",
        quote: s.quote,
        selection_hash: await decisionsHash(
          NEG_VERSION + review_id + s.theme + s.polarity,
        ),
      });
    }
  }
  all.sort((a, b) =>
    Number(b.polarity === "negative") - Number(a.polarity === "negative") ||
    (NEG_SELECTOR.priorities.indexOf(a.theme_key) < 0
        ? 99
        : NEG_SELECTOR.priorities.indexOf(a.theme_key)) -
      (NEG_SELECTOR.priorities.indexOf(b.theme_key) < 0
        ? 99
        : NEG_SELECTOR.priorities.indexOf(b.theme_key)) ||
    a.selection_hash.localeCompare(b.selection_hash)
  );
  return all;
}
export function groupedPayload(
  alias: string,
  text: string,
  associations: NegAssociation[],
) {
  if (
    associations.length < 1 || associations.length > 2 ||
    new Set(associations.map((a) => a.theme_key)).size !== associations.length
  ) throw new Error("NEGATIVE_V2_GROUP_INVALID");
  const payload = evidencePayload(
    alias,
    text,
    associations[0].theme_key,
    associations[0].polarity,
  );
  payload.questions = associations.map((a) => ({
    ...evidencePayload(alias, text, a.theme_key, a.polarity).questions[0],
    name: a.association_id,
  }));
  return payload;
}
export async function prepareNegativeSet(
  inv: NegInventory,
  asOf: string,
): Promise<NegSet> {
  if (
    !Number.isFinite(Date.parse(asOf)) ||
    new Set(inv.unused.map((r) => r.review_id)).size !== inv.unused.length
  ) throw new Error("NEGATIVE_V2_INVENTORY_INVALID");
  const excluded: NegSet["inventory"]["excluded"] = [],
    excluded_counts: Record<string, number> = {};
  const pool: {
    r: NegInput;
    resolved: Awaited<ReturnType<typeof analysisTextForFreshReview>>;
    c: Awaited<ReturnType<typeof candidates>>;
    bucket: Bucket;
    hash: string;
  }[] = [];
  let english_admissible = 0;
  for (
    const r of [...inv.unused].sort((a, b) =>
      a.review_id.localeCompare(b.review_id)
    )
  ) {
    if (r.organization_id !== NEG_ORG) throw new Error("FORBIDDEN");
    const resolved = await analysisTextForFreshReview(
        { ...r, id: r.review_id },
        undefined,
        asOf,
      ),
      flags = englishFlags(resolved.analysis_text, resolved.analysis_source);
    if (flags.length) {
      for (const reason of flags) {
        excluded_counts[reason] = (excluded_counts[reason] || 0) + 1;
      }
      excluded.push({
        review_id: r.review_id,
        establishment_id: r.establishment_id,
        reason: flags.join(","),
      });
      continue;
    }
    english_admissible++;
    const c = await candidates(r.review_id, resolved.analysis_text),
      negative = c.some((x) => x.polarity === "negative"),
      positive = c.some((x) => x.polarity === "positive");
    const bucket: Bucket | undefined = r.rating >= 1 && r.rating <= 4
      ? "low_mid"
      : r.rating === 5 && negative
      ? "mixed_five"
      : r.rating === 5 && positive
      ? "positive_control"
      : undefined;
    if (!bucket) {
      excluded_counts.NO_RELEVANT_CANDIDATE =
        (excluded_counts.NO_RELEVANT_CANDIDATE || 0) + 1;
      excluded.push({
        review_id: r.review_id,
        establishment_id: r.establishment_id,
        reason: "NO_RELEVANT_CANDIDATE",
      });
      continue;
    }
    if (!c.length) {
      excluded_counts.NO_RELEVANT_CANDIDATE =
        (excluded_counts.NO_RELEVANT_CANDIDATE || 0) + 1;
      excluded.push({
        review_id: r.review_id,
        establishment_id: r.establishment_id,
        reason: "NO_RELEVANT_CANDIDATE",
      });
      continue;
    }
    pool.push({
      r,
      resolved,
      c,
      bucket,
      hash: await decisionsHash(NEG_ORG + NEG_VERSION + r.review_id),
    });
  }
  const available = { low_mid: 0, mixed_five: 0, positive_control: 0 },
    selected = { ...available },
    shortfalls = { ...available };
  for (const p of pool) available[p.bucket]++;
  const counts = new Map<string, number>(), reviews: NegReview[] = [];
  for (
    const bucket of ["low_mid", "mixed_five", "positive_control"] as Bucket[]
  ) {
    const remaining = pool.filter((p) => p.bucket === bucket);
    while (
      remaining.length && selected[bucket] < NEG_SELECTOR.targets[bucket]
    ) {
      remaining.sort((a, b) =>
        (counts.get(a.r.establishment_id) || 0) -
          (counts.get(b.r.establishment_id) || 0) ||
        a.hash.localeCompare(b.hash)
      );
      const p = remaining.shift()!, r = p.r, position = reviews.length + 1;
      const unique = p.c.filter((c, i, a) =>
        a.findIndex((x) => x.theme_key === c.theme_key) === i
      );
      const chosen = unique.slice(0, bucket === "low_mid" ? 2 : 1);
      if (bucket === "positive_control" && selected[bucket] % 4 === 3) {
        chosen[0] = {
          ...chosen[0],
          polarity: chosen[0].polarity === "positive" ? "negative" : "positive",
          method: "opposite_polarity_boundary_probe_not_reference",
          quote: null,
        };
      }
      const associations = chosen.map((c, i) => ({
        ...c,
        association_id: `r${position}_q${i + 1}`,
      }));
      const text = p.resolved.analysis_text,
        payload = groupedPayload(`r${position}`, text, associations),
        estimate = estimateDecisionPayload(payload);
      const translation = r.review_translations?.find((t) =>
        t.language === "en" && t.translated_text.trim()
      );
      const body = {
        position,
        review_id: r.review_id,
        establishment_id: r.establishment_id,
        establishment_name: r.establishment_name,
        overall_rating: r.rating,
        original_language: r.original_language,
        original_text: r.original_text,
        original_text_sha256: await decisionsHashText(r.original_text),
        analysis_text: text,
        analysis_text_sha256: await decisionsHashText(text),
        analysis_source: p.resolved.analysis_source,
        translation_provenance: translation
          ? {
            table: "review_translations",
            id: translation.id ?? null,
            provider: "google_translation_en",
            provider_name: "not_recorded_in_legacy_schema",
            sha256: await decisionsHashText(translation.translated_text),
            created_at: translation.created_at ?? null,
            updated_at: translation.updated_at ?? null,
          }
          : { source: "original_en" },
        selection_bucket: bucket,
        selection_hash: p.hash,
        associations,
        payload,
        request_sha256: await decisionsHash(payload),
        estimated_input_tokens: estimate.estimated_input_tokens,
        estimated_cost_usd: estimate.input_only_estimated_cost_usd,
      };
      reviews.push({ ...body, review_sha256: await decisionsHash(body) });
      selected[bucket]++;
      counts.set(r.establishment_id, (counts.get(r.establishment_id) || 0) + 1);
    }
    shortfalls[bucket] = NEG_SELECTOR.targets[bucket] - selected[bucket];
  }
  const themes: NegSet["theme_distribution"] = {},
    stars: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  let ungrouped = 0;
  for (const r of reviews) {
    stars[r.overall_rating]++;
    for (const a of r.associations) {
      themes[a.theme_key] ??= { positive: 0, negative: 0 };
      themes[a.theme_key][a.polarity]++;
      ungrouped += estimateDecisionPayload(
        evidencePayload(
          "r" + r.position,
          r.analysis_text,
          a.theme_key,
          a.polarity,
        ),
      ).estimated_input_tokens;
    }
  }
  return {
    version: NEG_VERSION,
    organization_id: NEG_ORG,
    config: NEG_CONFIG,
    config_sha256: await decisionsHash(NEG_CONFIG),
    selector: NEG_SELECTOR,
    selector_sha256: await negativeSelectorHash(),
    created_at: asOf,
    reviews,
    reviews_sha256: await decisionsHash(reviews),
    review_count: reviews.length,
    question_count: reviews.reduce((n, r) => n + r.associations.length, 0),
    future_calls: reviews.length,
    estimated_input_tokens: reviews.reduce(
      (n, r) => n + r.estimated_input_tokens,
      0,
    ),
    estimated_cost_usd: reviews.reduce((n, r) => n + r.estimated_cost_usd, 0),
    ungrouped_estimated_input_tokens: ungrouped,
    ungrouped_estimated_cost_usd: ungrouped * .1 / 1e6,
    star_distribution: stars,
    theme_distribution: themes,
    restaurants: [...counts].map(([id, n]) => ({
      id,
      name: reviews.find((r) => r.establishment_id === id)!.establishment_name,
      reviews: n,
    })).sort((a, b) => a.id.localeCompare(b.id)),
    inventory: {
      history_tables: inv.history_tables,
      historical_review_ids: inv.historical_review_ids,
      total_text_reviews: inv.total_text_reviews,
      unused_with_original: inv.unused.length,
      english_admissible,
      available,
      selected,
      shortfalls,
      excluded_counts,
      excluded,
    },
    reference_count: 0,
    paid_enabled: false,
    production_enabled: false,
    new_paid_calls: 0,
    limits: [
      "Candidate signals are deterministic lexical proposals, not JEV predictions or reference labels.",
      "A stratified diagnostic set is not representative of restaurant problem prevalence.",
      "English language screening is conservative and does not certify translation accuracy.",
      "GPT-6 references must be annotated separately and sealed before any future Luna execution.",
      "No spending authorization, provider call, paid job or automatic retry exists in this preparation.",
    ],
  };
}
import { analysisTextSha256 as decisionsHashText } from "./analysis-text.ts";
export function blindNegativeExport(set: NegSet) {
  return set.reviews.flatMap((r) =>
    r.associations.map((a) => ({
      review_id: r.review_id,
      analysis_text: r.analysis_text,
      theme_key: a.theme_key,
      analysis_text_sha256: r.analysis_text_sha256,
    }))
  );
}
export interface NegReference {
  review_id: string;
  theme_key: ThemeKey;
  analysis_text_sha256: string;
  choice: GoldChoice;
  justification: string;
}
export interface NegReferenceInput {
  dataset_sha256: string;
  annotation_model: "GPT-6";
  reference_type: "GPT6_AI_reference_not_independent_human_Gold";
  items: NegReference[];
}
export async function verifyNegativeReferences(
  set: NegSet,
  sha: string,
  input: NegReferenceInput,
) {
  if (
    input?.dataset_sha256 !== sha || input.annotation_model !== "GPT-6" ||
    input.reference_type !== "GPT6_AI_reference_not_independent_human_Gold" ||
    !Array.isArray(input.items) || input.items.length !== set.question_count
  ) throw new Error("NEGATIVE_V2_REFERENCE_INVALID");
  const keys = new Set<string>();
  for (const x of input.items) {
    const key = x.review_id + ":" + x.theme_key,
      r = set.reviews.find((r) => r.review_id === x.review_id);
    if (
      keys.has(key) || !r || !r.associations.some((a) =>
        a.theme_key === x.theme_key
      ) || x.analysis_text_sha256 !== r.analysis_text_sha256 ||
      !GOLD_CHOICES.includes(x.choice) || !x.justification?.trim()
    ) throw new Error("NEGATIVE_V2_REFERENCE_ITEM_CHANGED");
    keys.add(key);
  }
  return await decisionsHash(input);
}
export async function verifyNegativeSet(set: NegSet, sha: string) {
  if (
    set.version !== NEG_VERSION || set.organization_id !== NEG_ORG ||
    await decisionsHash(set) !== sha ||
    set.config_sha256 !== await decisionsHash(NEG_CONFIG) ||
    set.selector_sha256 !== await negativeSelectorHash() ||
    await decisionsHash(set.reviews) !== set.reviews_sha256 ||
    new Set(set.reviews.map((r) => r.review_id)).size !== set.review_count ||
    set.review_count !== set.reviews.length || set.review_count > 32 ||
    set.question_count > 40 || set.future_calls !== set.review_count
  ) throw new Error("NEGATIVE_V2_SET_CHANGED");
  for (const r of set.reviews) {
    const { review_sha256, ...body } = r;
    if (
      await decisionsHash(body) !== review_sha256 ||
      await decisionsHashText(r.analysis_text) !== r.analysis_text_sha256 ||
      await decisionsHashText(r.original_text) !== r.original_text_sha256 ||
      englishFlags(r.analysis_text, r.analysis_source).length ||
      await decisionsHash(
          groupedPayload("r" + r.position, r.analysis_text, r.associations),
        ) !== r.request_sha256 ||
      await decisionsHash(r.payload) !== r.request_sha256
    ) throw new Error("NEGATIVE_V2_REVIEW_CHANGED");
  }
}
export interface NegObservation {
  review_id: string;
  theme_key: ThemeKey;
  choice: "supported" | "unsupported" | "uncertain";
  probabilities?: Record<string, number>;
  cost_usd?: number;
  input_tokens?: number;
  duration_ms?: number;
}
export function negativeMetrics(
  set: NegSet,
  refs: NegReference[],
  obs: NegObservation[],
  sampleIds?: string[],
) {
  const ids = sampleIds ?? set.reviews.map((r) => r.review_id);
  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0,
    abstentions = 0,
    evaluable = 0,
    missing = 0,
    valid_abstentions = 0,
    valid_missing = 0,
    negative_support = 0,
    negative_accepted = 0;
  for (const id of ids) {
    const r = set.reviews.find((r) => r.review_id === id);
    if (!r) continue;
    for (const a of r.associations) {
      const ref = refs.find((x) =>
        x.review_id === id && x.theme_key === a.theme_key
      );
      if (!ref || ref.choice === "uncertain") continue;
      evaluable++;
      const valid = ref.choice === "both" || ref.choice === a.polarity;
      if (a.polarity === "negative" && valid) negative_support++;
      const o = obs.find((x) =>
        x.review_id === id && x.theme_key === a.theme_key
      );
      if (!o) {
        missing++;
        if (valid) valid_missing++;
        continue;
      }
      if (o.choice === "uncertain") {
        abstentions++;
        if (valid) valid_abstentions++;
        continue;
      }
      if (o.choice === "supported") {
        if (valid) {
          tp++;
          if (a.polarity === "negative") negative_accepted++;
        } else fp++;
      } else if (valid) fn++;
      else tn++;
    }
  }
  const div = (n: number, d: number) => d ? n / d : null;
  return {
    evaluable,
    tp,
    fp,
    tn,
    fn,
    abstentions,
    missing,
    valid_abstentions,
    valid_missing,
    selective_precision: div(tp, tp + fp),
    recall: div(tp, tp + fn + valid_abstentions + valid_missing),
    criticism_recall: div(negative_accepted, negative_support),
    coverage: div(tp + fp + tn + fn, evaluable),
    negative_support,
  };
}
export async function negativeBootstrap(
  set: NegSet,
  refs: NegReference[],
  obs: NegObservation[],
  seed: string,
  resamples = 2000,
) {
  const ids = set.reviews.filter((r) =>
    refs.some((x) => x.review_id === r.review_id && x.choice !== "uncertain")
  ).map((r) => r.review_id);
  if (ids.length < 2 || !obs.length) {
    return { unit: "review", resamples, intervals: null };
  }
  let state = parseInt((await decisionsHashText(seed)).slice(0, 8), 16) || 1;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const values: {
    selective_precision: number[];
    criticism_recall: number[];
    coverage: number[];
  } = { selective_precision: [], criticism_recall: [], coverage: [] };
  for (let i = 0; i < resamples; i++) {
    const m = negativeMetrics(
      set,
      refs,
      obs,
      Array.from(
        { length: ids.length },
        () => ids[Math.floor(random() * ids.length)],
      ),
    );
    for (const k of Object.keys(values) as (keyof typeof values)[]) {
      if (m[k] !== null) values[k].push(m[k]!);
    }
  }
  const intervals = Object.fromEntries(
    Object.entries(values).map(([k, v]) => {
      v.sort((a, b) => a - b);
      return [
        k,
        v.length >= resamples * .9
          ? [
            v[Math.floor(v.length * .025)],
            v[Math.min(v.length - 1, Math.floor(v.length * .975))],
          ]
          : null,
      ];
    }),
  );
  return { unit: "review", resamples, intervals };
}
export function negativeBreakdowns(
  set: NegSet,
  refs: NegReference[],
  obs: NegObservation[],
) {
  return {
    themes: Object.fromEntries(
      THEME_KEYS.map(
        (t) => [
          t,
          negativeMetrics(
            {
              ...set,
              reviews: set.reviews.map((r) => ({
                ...r,
                associations: r.associations.filter((a) => a.theme_key === t),
              })),
            },
            refs,
            obs,
          ),
        ],
      ),
    ),
    restaurants: Object.fromEntries(
      set.restaurants.map(
        (e) => [
          e.id,
          negativeMetrics(
            set,
            refs,
            obs,
            set.reviews.filter((r) => r.establishment_id === e.id).map((r) =>
              r.review_id
            ),
          ),
        ],
      ),
    ),
    axes: Object.fromEntries(
      ["quality", "service", "atmosphere", "price"].map(
        (axis) => [
          axis,
          negativeMetrics(
            {
              ...set,
              reviews: set.reviews.map((r) => ({
                ...r,
                associations: r.associations.filter((a) =>
                  GOLD_TAXONOMY[a.theme_key].axis === axis
                ),
              })),
            },
            refs,
            obs,
          ),
        ],
      ),
    ),
  };
}
export const negativeCanonical = canonicalJson;
/** Future response parsing only. Does not call any provider or create a paid job. */
export function parseNegativeGroup(review: NegReview, raw: unknown) {
  const e = parseDecisionEnvelope(
    raw,
    review.associations.map((a) => a.association_id),
  );
  return {
    model: e.model,
    usage: e.usage,
    cost_usd: e.input_only_estimated_cost_usd,
    observations: review.associations.map((a) => {
      const parsed = parseEvidenceDecision({
        ...raw as object,
        answers: [{
          ...e.answers.get(a.association_id),
          name: "evidence_support",
        }],
      });
      const choice: NegObservation["choice"] = parsed.status === "supported"
        ? "supported"
        : parsed.status === "unsupported"
        ? "unsupported"
        : "uncertain";
      return {
        review_id: review.review_id,
        theme_key: a.theme_key,
        choice,
        native_choice: e.answers.get(a.association_id)?.choice ?? null,
        probabilities: "probabilities" in parsed
          ? parsed.probabilities
          : undefined,
        confidence: parsed.confidence,
        refused: parsed.refused,
      };
    }),
  };
}
export async function scoreNegativeSet(
  set: NegSet,
  refs: NegReference[],
  obs: NegObservation[],
  calls: {
    review_id: string;
    input_tokens: number;
    cost_usd: number;
    duration_ms: number;
  }[],
  seed: string,
) {
  const keys = obs.map((o) => o.review_id + ":" + o.theme_key);
  if (
    new Set(keys).size !== keys.length ||
    new Set(calls.map((c) => c.review_id)).size !== calls.length ||
    obs.some((o) =>
      !set.reviews.some((r) =>
        r.review_id === o.review_id &&
        r.associations.some((a) => a.theme_key === o.theme_key)
      )
    ) ||
    calls.some((c) => !set.reviews.some((r) => r.review_id === c.review_id))
  ) throw new Error("NEGATIVE_V2_RESULT_BINDING_INVALID");
  const rows = obs.flatMap((o) => {
    const ref = refs.find((r) =>
        r.review_id === o.review_id && r.theme_key === o.theme_key
      ),
      a = set.reviews.find((r) => r.review_id === o.review_id)!.associations
        .find((a) => a.theme_key === o.theme_key)!,
      p = o.probabilities?.supported;
    return ref && ref.choice !== "uncertain" && typeof p === "number" &&
        Number.isFinite(p) && p >= 0 && p <= 1
      ? [{
        probability: p,
        truth: ref.choice === "both" || ref.choice === a.polarity,
      }]
      : [];
  });
  const total = calls.reduce((s, c) => s + c.cost_usd, 0);
  return {
    metrics: negativeMetrics(set, refs, obs),
    breakdowns: negativeBreakdowns(set, refs, obs),
    bootstrap: await negativeBootstrap(set, refs, obs, seed),
    calibration: calibration(rows),
    probabilities: obs.map((o) => ({
      review_id: o.review_id,
      theme_key: o.theme_key,
      probabilities: o.probabilities ?? null,
    })),
    cost_usd: total,
    cost_per_decision: obs.length ? total / obs.length : null,
    input_tokens: calls.reduce((s, c) => s + c.input_tokens, 0),
    duration_ms_sum: calls.reduce((s, c) => s + c.duration_ms, 0),
    api_calls: calls.length,
    reference_type: "GPT6_AI_reference_not_independent_human_Gold",
    jev_comparison: null,
  };
}
