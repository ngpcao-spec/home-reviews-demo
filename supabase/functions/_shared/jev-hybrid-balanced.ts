// Independent selector; the V1 builder and the V3 rules stay frozen.
import {
  buildHybridPlan,
  HYBRID_LIMITS,
  hybridCandidates,
  type HybridContestation,
  type HybridEvidence,
  hybridHash,
  hybridInstructions,
  type HybridPlan,
  hybridSchema,
  localHybridTokens,
  verifyHybridPlan,
} from "./jev-hybrid-evidence.ts";
import {
  auditPilotCache,
  type PilotSnapshot,
  pilotStatistics,
} from "./jev-pilot-core.ts";
import type { EconomyCache } from "./jev-economy-cache.ts";
import { parseReviewV3 } from "./pilot-evidence-v3.ts";
import { nearDuplicateMemo } from "./pilot-evidence-v3-audit.ts";
import { negativeHash } from "./negative-validation-core.ts";
import { canonicalJson } from "./jev-exploratory-core.ts";
import type { ThemeKey } from "./jev-themes.ts";
import { GOLD_TAXONOMY } from "./gold-taxonomy.ts";

export const BALANCED_VERSION = "jev-hybrid-evidence-report-v1.1-balanced";
export const BALANCED_RULE_VERSION = "theme-bound-excerpt-quality-v1.1";
export const BALANCED_POLICY = {
  one_star_min_if_available: 3,
  low_star_target: .40,
  low_star_range: [.35, .45],
  max_per_review: 2,
  min_target: 23,
  max_target: 32,
  input_budget_tokens: 20000,
  stages: ["priority_coverage", "diversification"],
  decision: "text_first_stars_for_diversity_never_truth",
  contested: "always_exclude",
  ambiguous: "candidate_never_confirmed",
} as const;

// These are excerpt anchors, NOT new JEV definitions or a semantic truth model.
const ANCHORS: Record<ThemeKey, string> = {
  food_quality:
    "food|dish|meal|taste|steak|beef|meat|burger|pancake|salad|pizza|pasta|lasagna|egg|breakfast|brunch|bread|bun|fries|potato|chicken|fish|dessert|cake|sandwich|pastr|soup|rice",
  freshness: "fresh|stale|spoil|rancid",
  cooking: "cook|raw|burn|prepar|season|salt|sugar|pepper|baking soda",
  temperature: "cold|hot|warm|temperature",
  portions: "portion|quantity|amount|small|tiny|size|enough",
  presentation: "plating|presentation|presented",
  drinks:
    "coffee|tea|juice|drink|latte|smoothie|beverage|cappuccino|espresso|cocktail|beer",
  variety: "menu|option|choice|available|stock|variety",
  consistency: "visit|different|vary|inconsistent|this time|last time",
  friendly_staff:
    "friendly|polite|rude|kind|welcom|attitude|nice.*(?:wait|staff)|(?:wait|staff).*nice",
  attentiveness:
    "attentive|responsive|ignored|neglect|request|checked|check on|needed|needs|asked|helped|care of|no (?:waiter|server)|not.*(?:served|help)",
  wait_time: "wait|minute|hour|slow|fast|quick|delay|prompt",
  coordination:
    "organiz|coordinat|synchron|mix.up|order.*(?:together|separately)|forgot|confus",
  communication:
    "explain|understand|language|translator|communicat|listen|inform|speak|told|said",
  order_accuracy:
    "wrong|incorrect|forgot|forget|missing|instead|only gave|didn.t (?:bring|receive)|not what|never (?:arrived|brought)",
  professionalism:
    "professional|competent|knowledge|expert|immature|conduct|capable|serious|skill",
  atmosphere: "atmosphere|ambiance|ambience|vibe|mood|cozy|cosy",
  decor: "decor|interior|design|architecture|beautiful place",
  noise: "noise|music|loud|quiet|calm",
  comfort: "seat|chair|comfort|air.condition|space|cramped|heat|hot inside",
  cleanliness:
    "clean|dirty|hygiene|pest|cockroach|mosquito|toilet|soap|touch.*(?:food|fries)|hands.*(?:food|fries)",
  location:
    "location|located|distance|far|find|access|entrance|center|centre|downtown|drive|driving|across town",
  value:
    "worth|value|money|considering|for what|overpriced|price.*(?:quality|portion|service)|(?:quality|portion|service).*price",
  billing: "bill|charge|fee|tax|vat|supplement",
  price_level: "price|expensive|cheap|affordable|cost|overpriced",
};
const NEGATIVE =
  /\b(?:terrible|bad|poor|awful|tasteless|tough|rubbery|overcook|cold|slow|wait|unreasonable|expensive|overpriced|rude|ignored|wrong|forgot|missing|dirty|burn|raw|unprofessional|immature|disappoint|problem|difficult|far|small|tiny|not|no|too|tax|fee|charge|unavailable|out of stock)\w*/i;
const POSITIVE =
  /\b(?:good|great|excellent|delicious|tasty|fresh|beautiful|nice|friendly|polite|helpful|attentive|responsive|professional|comfortable|cozy|cosy|worth|affordable|quick|fast|clean|love|recommend|perfect)\w*/i;
const SPECIFIC =
  /\b(?:minute|hour|ordered|asked|told|paid|bill|tax|vat|steak|burger|beef|pancake|fries|meal|portion|menu|quality|language|translator|price|food|request|ignored|overcooked|raw|distance|find|access|hygiene|dirty|professional)\w*|\d/i;
const SEVERE =
  /\b(?:hygiene|dirty|cockroach|pest|mosquito|touching food|hands on|raw meat)\b/i;
const CONCRETE =
  /\b(?:minutes?|hours?|overcooked|undercooked|raw|burnt|wrong|forgot|missing|charged|tax|vat|ignored|translator|unreasonable|considering|compared|steak|beef|fries|tasteless|too tough)\b/i;
export interface BalancedEvidence extends HybridEvidence {
  jev_result: unknown;
  quality: {
    eligible: boolean;
    specificity: number;
    flags: string[];
    reason: string;
    human_validated: false;
  };
  selection_stage: "priority_coverage" | "diversification";
  selection_reason: string;
}

export function balancedExcerpt(text: string, evidence: HybridEvidence) {
  const graph = parseReviewV3(text),
    anchor = new RegExp(ANCHORS[evidence.theme_key], "i");
  const spans = [...text.matchAll(/[^.!?\n]+(?:[.!?\n]+|$)/g)].map((m) => {
    const start = m.index + m[0].length - m[0].trimStart().length;
    const end = m.index + m[0].trimEnd().length;
    const quote = text.slice(start, end);
    const statement = graph.statements.some((s) =>
      s.theme === evidence.theme_key && s.polarity === evidence.polarity &&
      s.start >= start && s.end <= end
    );
    const matches = anchor.test(quote);
    const valence = (evidence.polarity === "negative" ? NEGATIVE : POSITIVE)
      .test(quote);
    const generic = evidence.theme_key === "professionalism" &&
      !/professional|competen|knowledge|expert|immature|conduct|capable|serious|skill/i
        .test(quote);
    const foodOnly = evidence.theme_key !== "food_quality" ||
      graph.clauses.some((c) =>
        c.start >= start && c.end <= end &&
        c.entities.some((e) => e.kind === "food")
      );
    const selfSelected = evidence.theme_key === "order_accuracy" &&
      /\b(?:I|we) (?:chose|picked|selected) (?:the )?wrong\b/i.test(quote) &&
      !/\b(?:brought|delivered|forgot|missing|received|served the wrong)\b/i
        .test(quote);
    const score =
      matches && (statement || valence) && !generic && foodOnly && !selfSelected
        ? (statement ? 24 : 0) + (valence ? 15 : 0) +
          (SPECIFIC.test(quote) ? 8 : 0) + (CONCRETE.test(quote) ? 18 : 0)
        : 0;
    return { start, end, quote, statement, score };
  }).filter((s) =>
    s.quote.length <= HYBRID_LIMITS.quote_characters && s.score > 0
  )
    .sort((a, b) =>
      b.score - a.score || a.quote.length - b.quote.length || a.start - b.start
    );
  const span = spans[0];
  if (!span) return null;
  const flags: string[] = [];
  if (/\bbot\s+expensive\b/i.test(span.quote)) {
    flags.push("AMBIGUOUS_TYPO_PRICE");
  }
  if (
    /\b(?:used to|previously|before|no longer|now|later|eventually|apologized|corrected|replaced|additional comment)\b/i
      .test(text)
  ) flags.push("TEMPORAL_OR_RESOLUTION_CONTEXT");
  if (/\b(?:but|however|although|only|except|worth it)\b/i.test(span.quote)) {
    flags.push("SCOPED_CONTRAST_OR_LIMITED_CLAIM");
  }
  if (/dengue|illness|poison|sick|diarrh|shit myself/i.test(text)) {
    flags.push("CUSTOMER_HEALTH_REPORT_NOT_ESTABLISHED_CAUSALITY");
  }
  // Full short reviews; otherwise include complete neighboring sentences, never cut inside a negation.
  const all = [...text.matchAll(/[^.!?\n]+(?:[.!?\n]+|$)/g)];
  const i = all.findIndex((m) =>
    m.index <= span.start && m.index + m[0].length >= span.end
  );
  let contextStart = text.length <= HYBRID_LIMITS.context_characters
    ? 0
    : (all[Math.max(0, i - 1)]?.index ?? span.start);
  let contextEnd = text.length <= HYBRID_LIMITS.context_characters
    ? text.length
    : Math.min(
      text.length,
      (all[i + 1]?.index ?? span.end) + (all[i + 1]?.[0].length ?? 0),
    );
  if (contextEnd - contextStart > HYBRID_LIMITS.context_characters) {
    contextStart = span.start;
    contextEnd = span.end;
    flags.push("LONG_CONTEXT_REQUIRES_FULL_REVIEW_CHECK");
  }
  if (
    (contextStart > 0 || contextEnd < text.length) &&
    flags.includes("TEMPORAL_OR_RESOLUTION_CONTEXT")
  ) flags.push("TEMPORAL_CONTEXT_PARTIAL_SOL_MUST_ABSTAIN_IF_UNCLEAR");
  return {
    ...span,
    contextStart,
    contextEnd,
    context: text.slice(contextStart, contextEnd),
    flags,
  };
}

export async function balancedCandidates(
  snapshot: PilotSnapshot,
  cache: (EconomyCache & { theme_results?: unknown })[],
  contestations: HybridContestation[],
) {
  const audit = await auditPilotCache(
    snapshot.source.reviews,
    cache,
    snapshot.organization_id,
    snapshot.establishment_id,
  );
  const stats = pilotStatistics(
    snapshot.source.reviews,
    audit,
    snapshot.source.google_total_reviews,
  );
  const initial = await hybridCandidates(snapshot, audit, stats, contestations);
  return balancedCandidateExcerpts(snapshot, audit.used, initial);
}

// Excerpt selection is independent of the cache configuration. Callers must
// validate their own versioned classifications before using this pure adapter.
export async function balancedCandidateExcerpts(
  snapshot: PilotSnapshot,
  cache: (Pick<EconomyCache, "review_id"> & { theme_results?: unknown })[],
  initial: HybridEvidence[],
) {
  return Promise.all(initial.map(async (e): Promise<BalancedEvidence> => {
    const review = snapshot.source.reviews.find((r) => r.id === e.review_id)!;
    const c = cache.find((c) => c.review_id === e.review_id)!;
    const span = balancedExcerpt(review.analysis_text!, e);
    const flags = span?.flags ?? ["NO_THEME_BOUND_PASSAGE"];
    const ambiguous = flags.includes("AMBIGUOUS_TYPO_PRICE") ||
      flags.includes("TEMPORAL_CONTEXT_PARTIAL_SOL_MUST_ABSTAIN_IF_UNCLEAR");
    const result = span
      ? {
        ...e,
        quote: span.quote,
        quote_start: span.start,
        quote_end: span.end,
        quote_sha256: await negativeHash(span.quote),
        context: span.context,
        context_start: span.contextStart,
        context_end: span.contextEnd,
        context_truncated: span.contextStart > 0 ||
          span.contextEnd < review.analysis_text!.length,
        excerpt_method: span.statement
          ? "v11_exact_sentence_bound_to_v3_statement"
          : "v11_theme_polarity_candidate_requires_sol",
      }
      : e;
    return {
      ...result,
      evidence_id: await hybridHash({
        version: BALANCED_VERSION,
        review: e.review_id,
        theme: e.theme_key,
        polarity: e.polarity,
        text_sha: e.analysis_text_sha256,
        quote_sha: result.quote_sha256,
      }),
      status: e.status === "explicitly_contested"
        ? e.status
        : ambiguous || !span?.statement
        ? "sol_candidate"
        : e.status,
      jev_result:
        (c as EconomyCache & { theme_results: Record<string, unknown> })
          .theme_results[e.theme_key],
      quality: {
        eligible: !!span && e.status !== "explicitly_contested",
        specificity: span ? (ambiguous ? 0 : span.score) : 0,
        flags,
        reason: !span
          ? "NO_THEME_BOUND_PASSAGE"
          : ambiguous
          ? "AMBIGUOUS_REQUIRES_SOL"
          : "EXACT_THEME_BOUND_CANDIDATE_NOT_HUMAN_VALIDATION",
        human_validated: false,
      },
      selection_stage: "diversification",
      selection_reason: "not_selected",
    };
  }));
}

// Structural typing lets the four-category preparation reuse the same selection
// algorithm without projecting its classifications into historical themes.
export type BalancedSelectionInput=Pick<BalancedEvidence,'evidence_id'|'review_id'|'quote'|'polarity'|'axis'|'rating'|
 'mixed_review'|'status'|'quality'|'selection_stage'|'selection_reason'>&{theme_key:string};
export function selectBalancedEvidence<T extends BalancedSelectionInput>(
  candidates: T[],
  max: number,
  options: {same_review_distinct_associations?:boolean} = {},
) {
  const selected: T[] = [],
    eligible = candidates.filter((c) =>
      c.quality.eligible && c.status !== "explicitly_contested"
    );
  const duplicates = new Map<string, boolean>(),nearDuplicate=nearDuplicateMemo();
  const sameQuote = (a: T, b: T) => {
    const key = [a.evidence_id, b.evidence_id].sort().join(":");
    if (!duplicates.has(key)) {
      duplicates.set(key, nearDuplicate(a.quote, b.quote));
    }
    return duplicates.get(key)!;
  };
  const available = () =>
    eligible.filter((c) =>
      !selected.some((s) =>
        s.evidence_id === c.evidence_id || (sameQuote(s, c) && !(options.same_review_distinct_associations &&
          s.review_id === c.review_id && (s.theme_key !== c.theme_key || s.polarity !== c.polarity)))
      ) && selected.filter((s) =>
          s.review_id === c.review_id
        ).length < BALANCED_POLICY.max_per_review
    );
  const themeFrequency = new Map<string, number>();
  for (const c of eligible.filter((e) => e.polarity === "negative")) {
    themeFrequency.set(c.theme_key, (themeFrequency.get(c.theme_key) ?? 0) + 1);
  }
  const rank = (pool: T[]) => {
    const score = (c: T) =>
      c.quality.specificity + (c.polarity === "negative"
        ? 12 +
          Math.min(
            12,
            Math.log2(1 + (themeFrequency.get(c.theme_key) ?? 0)) * 2,
          )
        : 0) +
      (!selected.some((s) => s.review_id === c.review_id) ? 12 : 0) +
      (!selected.some((s) => s.axis === c.axis && s.polarity === c.polarity)
        ? 16
        : 0) +
      (c.mixed_review ? 2 : 0) + (c.status === "rule_confirmed" ? 3 : 0) -
      selected.filter((s) =>
          s.theme_key === c.theme_key && s.polarity === c.polarity
        ).length * 8 +
      (c.polarity === "negative" && SEVERE.test(c.quote) ? 3 : 0) -
      (c.quality.flags.includes("AMBIGUOUS_TYPO_PRICE") ? 100 : 0);
    const scores = new Map(pool.map((c) => [c.evidence_id, score(c)]));
    return pool.sort((a, b) =>
      scores.get(b.evidence_id)! - scores.get(a.evidence_id)! ||
      a.quote.length - b.quote.length ||
      a.evidence_id.localeCompare(b.evidence_id)
    );
  };
  const take = (
    filter: (e: T) => boolean,
    reason: string,
    stage: BalancedEvidence["selection_stage"] = "priority_coverage",
  ) => {
    if (selected.length >= max) return false;
    const c = rank(available().filter(filter))[0];
    if (!c) return false;
    selected.push({ ...c, selection_stage: stage, selection_reason: reason });
    return true;
  };
  // Stage A: conditional targets; a star never makes a passage admissible.
  for (let i = 0; i < BALANCED_POLICY.one_star_min_if_available; i++) {
    take(
      (e) =>
        e.rating === 1 && e.polarity === "negative" &&
        e.quality.specificity > 0,
      "one_star_concrete_criticism",
    );
  }
  for (const axis of ["quality", "price", "service"]) {
    for (let i = 0; i < 2; i++) {
      if (
        selected.filter((e) => e.axis === axis && e.polarity === "negative")
          .length < 2
      ) {
        take((e) =>
          e.axis === axis && e.polarity === "negative" &&
          e.quality.specificity > 0, "main_problem_distinct_examples");
      }
    }
  }
  for (const theme of ["billing", "order_accuracy", "cleanliness"]) {
    if (
      !selected.some((e) => e.theme_key === theme && e.polarity === "negative")
    ) {
      take(
        (e) =>
          e.theme_key === theme && e.polarity === "negative" &&
          e.quality.specificity >= 25,
        "specific_actionable_problem_not_frequency_claim",
      );
    }
  }
  for (const theme of ["value", "price_level"]) {
    if (
      !selected.some((e) => e.theme_key === theme && e.polarity === "negative")
    ) {
      take((e) =>
        e.theme_key === theme && e.polarity === "negative" &&
        e.quality.specificity >= 25, "main_price_dimension_distinct_example");
    }
  }
  for (const axis of ["service", "quality", "price", "atmosphere"]) {
    for (const polarity of ["negative", "positive"]) {
      if (
        !selected.some((e) => e.axis === axis && e.polarity === polarity)
      ) {
        take((e) =>
          e.axis === axis && e.polarity === polarity &&
          e.quality.specificity > 0, "axis_polarity_coverage");
      }
    }
  }
  const lowTarget = Math.round(max * BALANCED_POLICY.low_star_target);
  while (
    selected.filter((e) => e.rating <= 3).length < lowTarget &&
    take(
      (e) => e.rating <= 3 && e.quality.specificity > 0,
      "low_star_conditional_target",
    )
  ) { /* bounded by max */ }
  if (!selected.some((e) => e.rating === 4 && e.polarity === "negative")) {
    take(
      (e) => e.rating === 4 && e.polarity === "negative",
      "four_star_mixed_criticism",
    );
  }
  if (!selected.some((e) => e.rating === 5 && e.polarity === "positive")) {
    take(
      (e) => e.rating === 5 && e.polarity === "positive",
      "five_star_strength",
    );
  }
  // Stage B: precise examples before secondary breadth; cap low-star overrepresentation when alternatives exist.
  while (selected.length < max) {
    const low = selected.filter((e) => e.rating <= 3).length;
    const preferHigh =
      low >= Math.floor(max * BALANCED_POLICY.low_star_range[1]);
    if (
      take(
        (e) => !preferHigh || e.rating >= 4,
        "precise_diverse_secondary_example",
        "diversification",
      )
    ) continue;
    if (
      !take(
        () => true,
        "available_evidence_despite_stratum_shortage",
        "diversification",
      )
    ) break;
  }
  return selected;
}

export function balancedSummary(selected: BalancedEvidence[]) {
  return {
    total: selected.length,
    distinct_reviews: new Set(selected.map((e) => e.review_id)).size,
    rule_confirmed:
      selected.filter((e) => e.status === "rule_confirmed").length,
    sol_candidate: selected.filter((e) => e.status === "sol_candidate").length,
    by_axis_polarity: Object.fromEntries(
      ["service", "quality", "price", "atmosphere"].flatMap((axis) =>
        ["positive", "negative"].map((
          p,
        ) => [
          axis + ":" + p,
          selected.filter((e) => e.axis === axis && e.polarity === p).length,
        ])
      ),
    ),
    star_distribution: Object.fromEntries(
      [1, 2, 3, 4, 5].map((s) => [
        String(s),
        selected.filter((e) => e.rating === s).length,
      ]),
    ),
    mixed: selected.filter((e) => e.mixed_review).length,
    negative_despite_high_rating:
      selected.filter((e) => e.high_rating_criticism).length,
    covered_theme_polarities:
      new Set(selected.map((e) => e.theme_key + ":" + e.polarity)).size,
    covered_themes: new Set(selected.map((e) => e.theme_key)).size,
    low_star_citations: selected.filter((e) => e.rating <= 3).length,
    low_star_negative:
      selected.filter((e) => e.rating <= 3 && e.polarity === "negative").length,
    high_star_negative:
      selected.filter((e) => e.rating >= 4 && e.polarity === "negative").length,
  };
}

// Compact only repeated metadata in the provider packet. Audit plan retains the complete provenance/results.
export function balancedPacketEvidence(e: BalancedEvidence) {
  return {
    evidence_id: e.evidence_id,
    review_id: e.review_id,
    theme_key: e.theme_key,
    polarity: e.polarity,
    axis: e.axis,
    quote: e.quote,
    quote_start: e.quote_start,
    quote_end: e.quote_end,
    quote_sha256: e.quote_sha256,
    context: e.context === e.quote ? null : e.context,
    context_start: e.context_start,
    context_end: e.context_end,
    context_truncated: e.context_truncated,
    analysis_text_sha256: e.analysis_text_sha256,
    rating: e.rating,
    category_ratings: e.category_ratings,
    translation_source: e.translation_source,
    translation_provenance: e.translation_provenance,
    configuration_jev: e.configuration_jev,
    served_model: e.served_model,
    jev_result: e.jev_result,
    v3_status: e.v3_status,
    status: e.status,
    scope_flags: e.quality.flags,
  };
}

export function balancedSelectorHash() {
  return hybridHash({
    version: BALANCED_VERSION,
    rules: BALANCED_RULE_VERSION,
    policy: BALANCED_POLICY,
    anchors: ANCHORS,
    negative: NEGATIVE.source,
    positive: POSITIVE.source,
    specific: SPECIFIC.source,
    severe: SEVERE.source,
    concrete: CONCRETE.source,
    algorithm:
      "exact_complete_sentence_bound_theme_entity_polarity_then_neighbor_context_two_stages_conditional_quotas_reselect_after_budget_v1.1",
    ranking:
      "specificity(statement24,valence15,specific8,concrete18)+negative12+frequency_log2_cap12+new_review12+axis_polarity16+mixed2+rule3+severe3-repeat_theme8-typo100; self_selected_wrong_dish_excluded; price_and_value_examples",
  });
}
export async function buildBalancedPlan(
  snapshot: PilotSnapshot,
  cache: (EconomyCache & { theme_results?: unknown })[],
  contestations: HybridContestation[],
  language: "fr" | "vi",
  frozenV1?: HybridPlan,
  selectorSourceSha256: string | null = null,
) {
  const base = frozenV1 ??
    await buildHybridPlan(snapshot, cache, contestations, language);
  await verifyHybridPlan(base, snapshot);
  if (
    base.source_sha256 !== snapshot.source_sha256 || base.language !== language
  ) throw new Error("BALANCED_V1_SCOPE_CHANGED");
  const candidates = await balancedCandidates(snapshot, cache, contestations);
  const schema = hybridSchema(),
    prompt = hybridInstructions(language) +
      "\nBalanced selector V1.1: check scope flags, exact named dishes and corrections over time. A complaint about one steak is not all food; distance is not missing directions. Typographical ambiguity must remain uncertain unless context resolves it. Verify candidates and rule confirmations equally. Multiple examples support a topic but selected citation counts are never restaurant prevalence. A severe isolated report is a check to perform, never an established trend or medical cause.";
  let target: number = BALANCED_POLICY.max_target,
    selected = selectBalancedEvidence(candidates, target);
  const packet = () => ({
    ...base.packet,
    pipeline: BALANCED_VERSION,
    evidence: selected.map(balancedPacketEvidence),
    selection_is_not_representative_sample: true,
  });
  const request = () => ({
    ...base.request_preview,
    input: [{ role: "system", content: prompt }, {
      role: "user",
      content: JSON.stringify(packet()),
    }],
    text: { format: { ...base.request_preview.text.format, schema } },
  });
  const tokens = () =>
    Math.ceil(localHybridTokens(JSON.stringify(request())) * 1.12) + 256;
  while (target > 0 && tokens() > BALANCED_POLICY.input_budget_tokens) {
    target--;
    selected = selectBalancedEvidence(candidates, target);
  }
  const inputTokens = tokens(),
    outputTokens = Math.min(
      HYBRID_LIMITS.max_output_tokens,
      Math.ceil(
        1500 + selected.length * 115 +
          selected.reduce((n, e) => n + localHybridTokens(e.quote), 0),
      ),
    );
  if (inputTokens > BALANCED_POLICY.input_budget_tokens) {
    throw new Error("BALANCED_BASE_PACKET_OVER_BUDGET");
  }
  const cost = (out: number) =>
    snapshot.rates.sol_input !== null && snapshot.rates.sol_output !== null
      ? (inputTokens * snapshot.rates.sol_input +
        out * snapshot.rates.sol_output) / 1e6
      : null;
  const summary = balancedSummary(selected),
    selector_sha256 = await balancedSelectorHash();
  const eligible = candidates.filter((e) => e.quality.eligible),
    oneStars = eligible.filter((e) =>
      e.rating === 1 && e.polarity === "negative" && e.quality.specificity > 0
    );
  const shortages = [
    ...(summary.star_distribution["1"] < 3
      ? [{
        code: "ONE_STAR_SHORTAGE",
        target: 3,
        selected: summary.star_distribution["1"],
        admissible_distinct_reviews: new Set(oneStars.map((e) =>
          e.review_id
        )).size,
      }]
      : []),
    ...(summary.total < 23
      ? [{
        code: "EVIDENCE_BUDGET_OR_QUALITY_SHORTAGE",
        target: 23,
        selected: summary.total,
        admissible_distinct_reviews: new Set(eligible.map((e) =>
          e.review_id
        )).size,
      }]
      : []),
    ...(summary.low_star_citations < Math.ceil(summary.total * .35)
      ? [{
        code: "LOW_STAR_SHORTAGE",
        target: Math.ceil(summary.total * .35),
        selected: summary.low_star_citations,
        admissible_distinct_reviews: new Set(
          eligible.filter((e) => e.rating <= 3).map((e) => e.review_id),
        ).size,
      }]
      : []),
  ];
  const key = (e: HybridEvidence) =>
    `${e.review_id}:${e.theme_key}:${e.polarity}`;
  const changes = base.selected.filter((old) =>
    !selected.some((e) =>
      key(e) === key(old) && e.quote_sha256 === old.quote_sha256
    )
  ).map((old) => {
    const replacement = selected.find((e) => key(e) === key(old));
    const current = candidates.find((e) => key(e) === key(old));
    return {
      review_id: old.review_id,
      theme_key: old.theme_key,
      polarity: old.polarity,
      old_quote: old.quote,
      old_quote_sha256: old.quote_sha256,
      new_quote: replacement?.quote ?? null,
      new_quote_sha256: replacement?.quote_sha256 ?? null,
      reason: replacement
        ? "MORE_PRECISE_THEME_BOUND_EXCERPT"
        : current?.status === "explicitly_contested"
        ? "EXPLICIT_CONTESTATION_EXCLUDED"
        : !current?.quality.eligible
        ? "NO_THEME_BOUND_ADMISSIBLE_PASSAGE"
        : current.quality.flags.includes("AMBIGUOUS_TYPO_PRICE")
        ? "AMBIGUOUS_PRICE_DEPRIORITIZED"
        : "BALANCED_PRIORITY_DIVERSITY_AND_TOKEN_BUDGET",
    };
  });
  const plan = {
    ...base,
    version: BALANCED_VERSION,
    selected,
    selected_summary: summary,
    selector_sha256,
    selector_source_sha256: selectorSourceSha256,
    selector_rule_version: BALANCED_RULE_VERSION,
    selection_policy: BALANCED_POLICY,
    evidence_pool: {
      total: candidates.length,
      rule_confirmed:
        candidates.filter((e) => e.status === "rule_confirmed").length,
      sol_candidate:
        candidates.filter((e) => e.status === "sol_candidate").length,
      explicitly_contested:
        candidates.filter((e) => e.status === "explicitly_contested").length,
    },
    contested: candidates.filter((e) => e.status === "explicitly_contested"),
    quality_exclusions: candidates.filter((e) =>
      !e.quality.eligible && e.status !== "explicitly_contested"
    ).map((e) => ({
      review_id: e.review_id,
      theme_key: e.theme_key,
      polarity: e.polarity,
      reason: e.quality.reason,
    })),
    ambiguity_downgrades: candidates.filter((e) =>
      e.quality.flags.includes("AMBIGUOUS_TYPO_PRICE")
    ).map((e) => ({
      review_id: e.review_id,
      theme_key: e.theme_key,
      polarity: e.polarity,
      quote: e.quote,
      status: e.status,
    })),
    shortages,
    selected_review_texts: [...new Set(selected.map((e) => e.review_id))].map(
      (id) => {
        const r = snapshot.source.reviews.find((r) => r.id === id)!;
        return {
          review_id: id,
          analysis_text: r.analysis_text!,
          analysis_text_sha256: r.analysis_text_sha256!,
        };
      },
    ),
    main_problems: base.analytics.axes.filter((a) =>
      ["price", "quality", "service"].includes(a.key)
    ).sort((a, b) => b.negative_review_count - a.negative_review_count).map((
      a,
    ) => ({
      axis: a.key,
      negative_mentions: a.negative_mentions,
      negative_review_count: a.negative_review_count,
      selected_negative_citations:
        selected.filter((e) => e.axis === a.key && e.polarity === "negative")
          .length,
      distinct_evidence_reviews: new Set(
        selected.filter((e) => e.axis === a.key && e.polarity === "negative")
          .map((e) => e.review_id),
      ).size,
    })),
    comparison: {
      source_sha256: base.source_sha256,
      v1_sha256: await hybridHash(base),
      v1_summary: {
        ...base.selected_summary,
        covered_themes: new Set(base.selected.map((e) => e.theme_key)).size,
        low_star_negative:
          base.selected.filter((e) =>
            e.rating <= 3 && e.polarity === "negative"
          ).length,
        high_star_negative:
          base.selected.filter((e) =>
            e.rating >= 4 && e.polarity === "negative"
          ).length,
      },
      v1_estimates: base.estimates,
      v1_dossier_bytes:
        new TextEncoder().encode(JSON.stringify(base.packet)).length,
      replaced: changes,
      added: selected.filter((e) =>
        !base.selected.some((old) => key(old) === key(e))
      ).map((e) => ({
        review_id: e.review_id,
        theme_key: e.theme_key,
        polarity: e.polarity,
        quote: e.quote,
        reason: e.selection_reason,
      })),
    },
    packet: packet(),
    dossier_sha256: await hybridHash(packet()),
    prompt,
    prompt_sha256: await negativeHash(prompt),
    schema,
    schema_sha256: await hybridHash(schema),
    request_preview: request(),
    estimates: {
      ...base.estimates,
      estimated_input_tokens: inputTokens,
      estimated_output_tokens: outputTokens,
      estimated_sol_cost_usd: cost(outputTokens),
      total_estimated_cost_usd: cost(outputTokens),
      max_sol_cost_usd: cost(HYBRID_LIMITS.max_output_tokens),
      dossier_bytes: new TextEncoder().encode(JSON.stringify(packet())).length,
    },
  };
  await verifyBalancedPlan(plan, snapshot);
  return plan;
}
export type BalancedPlan = Awaited<ReturnType<typeof buildBalancedPlan>>;
export async function verifyBalancedPlan(
  plan: BalancedPlan,
  snapshot: PilotSnapshot,
) {
  if (
    plan.version !== BALANCED_VERSION ||
    plan.source_sha256 !== snapshot.source_sha256 ||
    plan.selector_sha256 !== await balancedSelectorHash() ||
    plan.statistics_sha256 !== await hybridHash(plan.analytics) ||
    plan.dossier_sha256 !== await hybridHash(plan.packet) ||
    plan.prompt_sha256 !== await negativeHash(plan.prompt) ||
    plan.schema_sha256 !== await hybridHash(plan.schema) ||
    canonicalJson(plan.packet.evidence) !==
      canonicalJson(plan.selected.map(balancedPacketEvidence)) ||
    canonicalJson(plan.analytics) !== canonicalJson(plan.packet.statistics) ||
    plan.request_preview.input[1].content !== JSON.stringify(plan.packet) ||
    plan.request_preview.input[0].content !== plan.prompt ||
    plan.paid_enabled !== false || plan.production_enabled !== false ||
    plan.sol_response !== null || plan.estimates.estimated_input_tokens > 20000
  ) throw new Error("BALANCED_PLAN_CHANGED");
  for (const e of plan.selected) {
    const r = snapshot.source.reviews.find((r) => r.id === e.review_id);
    if (
      !r?.analysis_text || r.rating !== e.rating ||
      GOLD_TAXONOMY[e.theme_key]?.axis !== e.axis ||
      r.analysis_text_sha256 !== e.analysis_text_sha256 ||
      await negativeHash(r.analysis_text) !== e.analysis_text_sha256 ||
      r.analysis_text.slice(e.quote_start, e.quote_end) !== e.quote ||
      r.analysis_text.slice(e.context_start, e.context_end) !== e.context ||
      await negativeHash(e.quote) !== e.quote_sha256 ||
      !e.context.includes(e.quote) || !e.quality.eligible ||
      e.status === "explicitly_contested"
    ) throw new Error("BALANCED_QUOTE_CHANGED");
    if (plan.selected.filter((x) => x.review_id === e.review_id).length > 2) {
      throw new Error("BALANCED_DUPLICATE_REVIEW");
    }
  }
  if (
    new Set(plan.selected.map((e) => e.evidence_id)).size !==
      plan.selected.length
  ) throw new Error("BALANCED_DUPLICATE_EVIDENCE");
  for (const r of plan.selected_review_texts) {
    const frozen = snapshot.source.reviews.find((s) => s.id === r.review_id);
    if (
      frozen?.analysis_text !== r.analysis_text ||
      frozen.analysis_text_sha256 !== r.analysis_text_sha256 ||
      await negativeHash(r.analysis_text) !== r.analysis_text_sha256
    ) {
      throw new Error("BALANCED_FULL_TEXT_CHANGED");
    }
  }
}
