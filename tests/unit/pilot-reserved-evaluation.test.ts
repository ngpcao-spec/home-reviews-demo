import { expect, it } from "vitest";
import report from "../../docs/pilot-evidence-v3-reserved40-evaluation-20261011.json";
import reference from "../../docs/pilot-evidence-v3-gpt6-reserved40-reference-20261011.json";
import posthoc from "../../docs/jev-economic-pilot-gpt6-posthoc-audit-20261011.json";
import {
  evaluationCategory,
  evaluationHash,
  referenceSupports,
  type ReservedEvaluation,
  reservedMetrics,
  type ReservedSource,
  runFrozenV3,
} from "../../supabase/functions/_shared/pilot-evidence-v3-reserved-evaluation";
import { negativeHash } from "../../supabase/functions/_shared/negative-validation-core";
const r = report.result as unknown as ReservedEvaluation;
it("sealed result hash, 40 IDs/text hashes, no overlap with 199, references unmodified", async () => {
  expect(await evaluationHash(r)).toBe(report.result_sha256);
  expect(r.cases).toHaveLength(40);
  expect(new Set(r.cases.map((c) => c.review_id)).size).toBe(40);
  for (const c of r.cases) {
    const ref = reference.items.find((x) => x.position === c.position)!;
    expect(c.review_id).toBe(ref.review_id);
    expect(c.theme_key).toBe(ref.theme_key);
    expect(c.reference_choice).toBe(ref.choice);
    expect(c.reference_justification).toBe(ref.justification);
    expect(await negativeHash(c.analysis_text)).toBe(ref.analysis_text_sha256);
    expect(posthoc.cases.some((x) => x.review_id === c.review_id)).toBe(false);
    if (c.decision.statement) {
      expect(
        c.analysis_text.slice(
          c.decision.statement.start,
          c.decision.statement.end,
        ),
      ).toBe(c.decision.statement.quote);
      expect(await negativeHash(c.decision.statement.quote)).toBe(
        c.quote_sha256,
      );
    }
  }
});
it("replays frozen verifier without IA labels or Google metadata as input", async () => {
  const source = {
      control: {
        body: {
          items: r.cases.map((c) => ({
            position: c.position,
            review_id: c.review_id,
            theme_key: c.theme_key,
            polarity: c.polarity,
            analysis_text: c.analysis_text,
            analysis_text_sha256: c.analysis_text_sha256,
          })),
        },
      },
    } as ReservedSource,
    outputs = runFrozenV3(source);
  expect(await evaluationHash(outputs)).toBe(r.frozen_verifier_outputs_sha256);
  expect(outputs.map((c) => c.decision)).toEqual(
    r.cases.map((c) => c.decision),
  );
});
it("actual 5 valid accepts, 0 invalid accepts, 21 supported pending, one incorrect rejection", () => {
  expect(r.metrics.v3.counts).toEqual({
    justified_accepted: 5,
    unjustified_accepted: 0,
    justified_pending: 21,
    unjustified_rejected: 2,
    justified_rejected: 1,
    unjustified_pending: 7,
    reference_uncertain: 4,
  });
  expect(r.metrics.v3.decisive_coverage_all).toEqual({
    numerator: 8,
    denominator: 40,
    value: .2,
  });
  expect(r.metrics.v3.abstention_all.numerator).toBe(32);
  expect(r.metrics.v3.selective_agreement).toEqual({
    numerator: 7,
    denominator: 8,
    value: .875,
  });
});
it("all four uncertain references excluded from every binary denominator", () => {
  const m = reservedMetrics(r.cases);
  expect(m).toEqual(r.metrics.v3);
  expect(m.comparable).toBe(36);
  expect(m.acceptance_precision.denominator).toBe(5);
  const rows = [{
    reference_choice: "uncertain" as const,
    reference_supports: null,
    status: "supported_by_rule" as const,
  }, {
    reference_choice: "positive" as const,
    reference_supports: true,
    status: "supported_by_rule" as const,
  }];
  expect(reservedMetrics(rows).acceptance_precision).toEqual({
    numerator: 1,
    denominator: 1,
    value: 1,
  });
  expect(reservedMetrics([]).selective_agreement.value).toBeNull();
});
it("both validates the proposed polarity; opposite polarity does not", () => {
  expect(referenceSupports("both", "negative")).toBe(true);
  expect(referenceSupports("positive", "negative")).toBe(false);
  expect(referenceSupports("uncertain", "positive")).toBeNull();
  expect(evaluationCategory("unsupported_by_rule", true)).toBe(
    "justified_rejected",
  );
});
it("per-axis counts and V21 / JEV baselines retain their real supports", () => {
  expect(r.by_axis.quality.v3.reference_supported).toBe(11);
  expect(r.by_axis.quality.v3.counts.justified_accepted).toBe(1);
  expect(r.metrics.v21.abstention_all.numerator).toBe(39);
  expect(r.metrics.jev.counts.unjustified_accepted).toBe(9);
  expect(r.jev_exact_choice_agreement).toEqual({
    numerator: 27,
    denominator: 36,
    value: .75,
  });
  expect(
    r.cases.filter((c) => c.category === "reference_uncertain").map((c) =>
      c.position
    ),
  ).toEqual([8, 10, 34, 40]);
});
