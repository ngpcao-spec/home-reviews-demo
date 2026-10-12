import { THEME_KEYS, type ThemeKey } from "./jev-themes.ts";
import { GOLD_TAXONOMY, type GoldChoice } from "./gold-taxonomy.ts";
import { economyMetrics } from "./jev-economy-score.ts";
import { decisionsHash, type LunaPrediction } from "./decisions-config.ts";
export interface DecisionReference {
  review_id: string;
  theme_key: ThemeKey;
  choice: GoldChoice;
}
export interface DecisionPrediction extends LunaPrediction {
  review_id: string;
}
const empty = () => ({ tp: 0, fp: 0, fn: 0, support: 0 });
const sum = (cs: ReturnType<typeof empty>[]) =>
  cs.reduce(
    (a, b) => ({
      tp: a.tp + b.tp,
      fp: a.fp + b.fp,
      fn: a.fn + b.fn,
      support: a.support + b.support,
    }),
    empty(),
  );
const has = (c: GoldChoice, p: string) => c === p || c === "both";
export function calibration(rows: { probability: number; truth: boolean }[]) {
  const bins = Array.from(
    { length: 10 },
    (_, i) => ({ low: i / 10, high: (i + 1) / 10, count: 0, p: 0, y: 0 }),
  );
  for (const r of rows) {
    const b = bins[Math.min(9, Math.floor(r.probability * 10))];
    b.count++;
    b.p += r.probability;
    b.y += Number(r.truth);
  }
  return {
    support: rows.length,
    brier: rows.length
      ? rows.reduce((n, r) => n + (r.probability - Number(r.truth)) ** 2, 0) /
        rows.length
      : null,
    ece: rows.length
      ? bins.reduce(
        (n, b) =>
          n + (b.count
            ? b.count / rows.length * Math.abs(b.p / b.count - b.y / b.count)
            : 0),
        0,
      )
      : null,
    bins: bins.map((b) => ({
      low: b.low,
      high: b.high,
      count: b.count,
      mean_probability: b.count ? b.p / b.count : null,
      observed_rate: b.count ? b.y / b.count : null,
    })),
    reference_type: "AI_reference_not_human",
  };
}
export function scoreDecisions(
  ids: string[],
  refs: DecisionReference[],
  preds: DecisionPrediction[],
  selective = false,
) {
  const themes = Object.fromEntries(
    THEME_KEYS.map((k) => [k, { positive: empty(), negative: empty() }]),
  ) as Record<
    ThemeKey,
    { positive: ReturnType<typeof empty>; negative: ReturnType<typeof empty> }
  >;
  const errors: {
      review_id: string;
      theme_key: ThemeKey;
      polarity: string;
      kind: string;
      reference: GoldChoice;
      prediction: GoldChoice;
    }[] = [],
    probRows = {
      positive: [] as { probability: number; truth: boolean }[],
      negative: [] as { probability: number; truth: boolean }[],
    },
    perReview: Record<string, ReturnType<typeof empty>>[] = [];
  let uncertainRefs = 0,
    abstentions = 0,
    unavailable = 0,
    compared = 0,
    same = 0,
    mixedSupport = 0,
    mixedRetained = 0,
    decidedPolarities = 0;
  const confidenceRows: { probability: number; truth: boolean }[] = [];
  for (const id of ids) {
    const row = { positive: empty(), negative: empty(), overall: empty() };
    for (const k of THEME_KEYS) {
      const ref = refs.find((r) => r.review_id === id && r.theme_key === k);
      if (!ref) throw new Error("DECISIONS_REFERENCE_INCOMPLETE");
      const pred = preds.find((r) => r.review_id === id && r.theme_key === k);
      if (!pred || pred.choice === null) {
        unavailable++;
        continue;
      }
      if (ref.choice === "uncertain") {
        uncertainRefs++;
        continue;
      }
      if (pred.choice === "uncertain") abstentions++;
      if (!selective || pred.choice !== "uncertain") compared++;
      if (ref.choice === pred.choice) same++;
      if (ref.choice === "both") {
        mixedSupport++;
        if (pred.choice === "both") mixedRetained++;
      }
      if (pred.confidence !== null) {
        confidenceRows.push({
          probability: pred.confidence,
          truth: (pred.native_choice ?? pred.choice) === ref.choice,
        });
      }
      for (const polarity of ["positive", "negative"] as const) {
        const stated = pred[
          polarity === "positive" ? "positive_present" : "negative_present"
        ];
        const decided = stated !== undefined
          ? stated !== null
          : pred.choice !== "uncertain";
        if (decided) {
          decidedPolarities++;
        }
        if (selective && !decided) continue;
        const truth = has(ref.choice, polarity),
          yes: boolean = stated !== undefined
            ? stated === true
            : has(pred.choice, polarity),
          c = themes[k][polarity],
          key = yes ? truth ? "tp" : "fp" : truth ? "fn" : null;
        if (truth) {
          c.support++;
          row[polarity].support++;
          row.overall.support++;
        }
        if (key) {
          c[key]++;
          row[polarity][key]++;
          row.overall[key]++;
          if (key !== "tp") {
            errors.push({
              review_id: id,
              theme_key: k,
              polarity,
              kind: key === "fp" ? "false_positive" : "false_negative",
              reference: ref.choice,
              prediction: pred.choice,
            });
          }
        }
        const p = pred[polarity];
        if (p !== null) probRows[polarity].push({ probability: p, truth });
      }
    }
    perReview.push(row);
  }
  const pos = THEME_KEYS.map((k) => themes[k].positive),
    neg = THEME_KEYS.map((k) => themes[k].negative),
    supported = [...pos, ...neg].filter((c) => c.support >= 3);
  return {
    overall: economyMetrics(sum([...pos, ...neg])),
    positive: economyMetrics(sum(pos)),
    negative: economyMetrics(sum(neg)),
    macro_f1: supported.length
      ? supported.reduce((n, c) => n + economyMetrics(c).f1!, 0) /
        supported.length
      : null,
    macro_supported_labels: supported.length,
    exact_choice_agreement: compared ? same / compared : null,
    compared_labels: compared,
    uncertain_reference_labels: uncertainRefs,
    abstentions,
    unavailable,
    coverage: ids.length ? compared / (ids.length * 25 - uncertainRefs) : null,
    decided_polarity_coverage: ids.length
      ? decidedPolarities / (2 * (ids.length * 25 - uncertainRefs))
      : null,
    selective,
    abstention_policy: selective
      ? "uncertain_polarity_excluded_with_coverage_other_decided_polarity_retained"
      : "uncertain_polarity_asserts_no_presence_and_can_count_false_negative_other_decided_polarity_retained",
    mixed: {
      reference_support: mixedSupport,
      retained: mixedRetained,
      recall: mixedSupport ? mixedRetained / mixedSupport : null,
    },
    themes: Object.fromEntries(
      THEME_KEYS.map(
        (k) => [k, {
          positive: economyMetrics(themes[k].positive),
          negative: economyMetrics(themes[k].negative),
        }],
      ),
    ),
    axes: Object.fromEntries(
      ["quality", "service", "atmosphere", "price"].map((axis) => {
        const ks = THEME_KEYS.filter((k) => GOLD_TAXONOMY[k].axis === axis);
        return [axis, {
          positive: economyMetrics(sum(ks.map((k) => themes[k].positive))),
          negative: economyMetrics(sum(ks.map((k) => themes[k].negative))),
        }];
      }),
    ),
    calibration: {
      positive: calibration(probRows.positive),
      negative: calibration(probRows.negative),
      native_choice_confidence: calibration(confidenceRows),
    },
    errors,
    perReview,
  };
}
export async function decisionsBootstrap(
  seed: string,
  a: ReturnType<typeof scoreDecisions>,
  b: ReturnType<typeof scoreDecisions>,
  polarity: "positive" | "negative" | "overall",
) {
  if (a.perReview.length !== b.perReview.length) {
    throw new Error("DECISIONS_UNPAIRED");
  }
  const seedSha = await decisionsHash(seed + polarity);
  let state = parseInt(seedSha.slice(0, 8), 16) || 1;
  const values: number[] = [];
  for (let r = 0; r < 2000; r++) {
    const x = [], y = [];
    for (let i = 0; i < a.perReview.length; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      const n = Math.floor((state >>> 0) / 4294967296 * a.perReview.length);
      x.push(a.perReview[n][polarity]);
      y.push(b.perReview[n][polarity]);
    }
    const l = economyMetrics(sum(x)).f1, h = economyMetrics(sum(y)).f1;
    if (l !== null && h !== null) values.push(h - l);
  }
  values.sort((x, y) => x - y);
  const valid = values.length === 2000 &&
    a.perReview.filter((r) => r[polarity].support > 0).length >= 3;
  return {
    resamples: 2000,
    paired_by_review: true,
    seed_sha256: seedSha,
    valid_resamples: values.length,
    delta: a[polarity].f1 === null || b[polarity].f1 === null
      ? null
      : b[polarity].f1! - a[polarity].f1!,
    ci_95_low: valid ? values[49] : null,
    ci_95_high: valid ? values[1949] : null,
    reference_type: "AI_reference_exploratory",
  };
}
