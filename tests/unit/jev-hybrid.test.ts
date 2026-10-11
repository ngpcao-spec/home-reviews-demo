import { expect, it, vi } from "vitest";
import {
  hybridFixture,
  mockHybridAuthorization,
  mockHybridSol,
} from "../fixtures/jev-hybrid";
import {
  candidateExcerpt,
  diversifyHybridEvidence,
  verifyHybridPlan,
} from "../../supabase/functions/_shared/jev-hybrid-evidence";
import {
  parseReviewV3,
  verifyGraphV3,
} from "../../supabase/functions/_shared/pilot-evidence-v3";
import { validateHybridResponse } from "../../supabase/functions/_shared/jev-hybrid-validation";
import {
  processHybridJob,
  simulateSingleHybridJob,
} from "../../supabase/functions/_shared/jev-hybrid-worker";
it("25 themes, exact mentions/distinct review counts, hashes, no contested reinsertion or invented quote", async () => {
  const f = await hybridFixture();
  await verifyHybridPlan(f.plan, f.snapshot);
  expect(f.plan.analytics.themes).toHaveLength(25);
  expect(f.plan.analytics.price_rating).toBeNull();
  expect(f.plan.selected.every((e) => e.status !== "explicitly_contested"))
    .toBe(true);
  for (const e of f.plan.selected) {
    const r = f.snapshot.source.reviews.find((r) => r.id === e.review_id)!;
    expect(r.analysis_text!.slice(e.quote_start, e.quote_end)).toBe(e.quote);
    expect(e.context).toContain(e.quote);
  }
  expect(f.plan.estimates.jev_new_requests).toBe(0);
  expect(f.plan.sol_response).toBeNull();
  expect(f.plan.paid_enabled).toBe(false);
});
it("candidate excerpt preserves newline and ambiguous text instead of demanding a lexical pass", () => {
  const text = "The food is incredibly delicious\nStaff polite.";
  const v = verifyGraphV3(parseReviewV3(text), "food_quality", "positive"),
    span = candidateExcerpt(text, "food_quality", v);
  expect(text.slice(span.start, span.end)).toContain("incredibly delicious");
  expect(span.method).not.toBe("v3_exact_bound_clause");
});
it("diversity, mixed sentiment and no redundant selection", async () => {
  const f = await hybridFixture();
  const selected = diversifyHybridEvidence([
    ...f.plan.selected,
    ...f.plan.selected,
  ], 32);
  expect(new Set(selected.map((e) => e.evidence_id)).size).toBe(
    selected.length,
  );
  expect(selected.some((e) => e.polarity === "positive")).toBe(true);
  expect(selected.some((e) => e.polarity === "negative")).toBe(true);
  expect(selected.some((e) => e.mixed_review)).toBe(true);
});
it("valid explicit Sol mock returns server statistics and separate same-call verdicts", async () => {
  const f = await hybridFixture();
  const v = await validateHybridResponse(
    mockHybridSol(f.plan),
    f.plan,
    f.snapshot,
  );
  expect(v.statistics).toEqual(f.plan.analytics);
  expect(v.independent_semantic_validation).toBe(false);
  expect(v.human_validated).toBe(false);
  expect(
    v.verdicts.every((v) => v.source === "sol_same_verification_writing_call"),
  ).toBe(true);
});
it.each(["quote", "id", "theme", "statistics", "schema", "number", "axis"])(
  "rejects fabricated/invalid Sol %s",
  async (kind) => {
    const f = await hybridFixture(), r = mockHybridSol(f.plan);
    if (kind === "quote") r.verdicts[0].quote = "invented";
    if (kind === "id") r.verdicts[0].evidence_id = "not-known";
    if (kind === "theme") {
      r.verdicts[0].theme_key = r.verdicts[0].theme_key === "billing"
        ? "food_quality"
        : "billing";
    }
    if (kind === "statistics") r.statistics_sha256 = "wrong";
    if (kind === "schema") r.report.axes.pop();
    if (kind === "number") r.report.conclusion.text = "Centuries 999 reviews";
    if (kind === "axis") r.report.axes.reverse();
    await expect(validateHybridResponse(r, f.plan, f.snapshot)).rejects.toThrow(
      "HYBRID_",
    );
  },
);
it("uncertain required recommendation proof is hidden, no same-axis substitute", async () => {
  const f = await hybridFixture(), r = mockHybridSol(f.plan);
  expect(r.report.recommendations.length).toBe(1);
  const id = r.report.recommendations[0].evidence_ids[0],
    v = r.verdicts.find((v) => v.evidence_id === id)!;
  v.status = "uncertain";
  v.action_codes = [];
  const result = await validateHybridResponse(r, f.plan, f.snapshot);
  expect(result.report.recommendations[0].status).toBe("review_needed");
  expect(result.report.recommendations[0].text).toBeNull();
});
it("wrong recommendation content is not accepted by valid evidence IDs", async () => {
  const f = await hybridFixture(), r = mockHybridSol(f.plan);
  r.report.recommendations[0].text =
    "Reformer toute la formation du personnel.";
  expect(
    (await validateHybridResponse(r, f.plan, f.snapshot)).report
      .recommendations[0].text,
  ).toBeNull();
});
it("context and request tampering detected before dispatch", async () => {
  const f = await hybridFixture();
  f.plan.request_preview.model = "bad-model";
  await expect(verifyHybridPlan(f.plan, f.snapshot)).rejects.toThrow(
    "HYBRID_PLAN_CHANGED",
  );
});
it("current worker always blocks live execution, no environment bypass", async () => {
  await expect(processHybridJob()).rejects.toThrow(
    "HYBRID_PAID_EXECUTION_DISABLED",
  );
});
it("mock-only single durable attempt survives double click and ambiguous connection", async () => {
  const f = await hybridFixture(), auth = await mockHybridAuthorization(f.plan);
  let claimed = false;
  const finished = vi.fn(),
    call = vi.fn(async () => {
      throw new Error("NETWORK");
    });
  const store = {
      begin: async () => {
        if (claimed) return false;
        claimed = true;
        return true;
      },
      finish: finished,
    },
    port = { kind: "explicit_test_mock" as const, call };
  await Promise.all([
    simulateSingleHybridJob(f.plan, f.snapshot, auth, store, port),
    simulateSingleHybridJob(f.plan, f.snapshot, auth, store, port),
  ]);
  expect(call).toHaveBeenCalledTimes(1);
  expect(finished.mock.calls[0][0].status).toBe("billing_uncertain");
  expect(
    (await simulateSingleHybridJob(f.plan, f.snapshot, auth, store, port))
      .new_calls,
  ).toBe(0);
});
it("invalid paid response still records measured cost in explicit mock, no retry", async () => {
  const f = await hybridFixture(),
    auth = await mockHybridAuthorization(f.plan),
    finished = vi.fn(),
    call = vi.fn(async () => ({
      data: { bad: true },
      model: "gpt-6.1-sol",
      response_id: "mock-rsp",
      input_tokens: 100,
      output_tokens: 20,
      duration_ms: 4,
    }));
  const result = await simulateSingleHybridJob(f.plan, f.snapshot, auth, {
    begin: async () => true,
    finish: finished,
  }, { kind: "explicit_test_mock", call });
  expect(result.status).toBe("invalid_output");
  expect(call).toHaveBeenCalledTimes(1);
  expect(finished.mock.calls[0][0].cost_usd).toBe(.0004);
});
