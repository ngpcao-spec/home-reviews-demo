import {
  hybridFixture,
  mockHybridAuthorization,
  mockHybridSol,
} from "../../tests/fixtures/jev-hybrid.ts";
import { validateHybridResponse } from "../functions/_shared/jev-hybrid-validation.ts";
import {
  processHybridJob,
  simulateSingleHybridJob,
} from "../functions/_shared/jev-hybrid-worker.ts";
const assert = (v: unknown) => {
  if (!v) throw new Error("ASSERT_FAILED");
};
Deno.test("closed live worker and one explicit mock combined call without network", async () => {
  let blocked = false;
  try {
    await processHybridJob();
  } catch {
    blocked = true;
  }
  assert(blocked);
  const f = await hybridFixture(),
    authorization = await mockHybridAuthorization(f.plan);
  let claimed = false, calls = 0;
  const store = {
    begin: () => {
      if (claimed) return Promise.resolve(false);
      claimed = true;
      return Promise.resolve(true);
    },
    finish: () => Promise.resolve(),
  };
  const port = {
    kind: "explicit_test_mock" as const,
    call: () => {
      calls++;
      return Promise.resolve({
        data: mockHybridSol(f.plan),
        model: "gpt-6.1-sol",
        response_id: "mock-only",
        input_tokens: 100,
        output_tokens: 100,
        duration_ms: 1,
      });
    },
  };
  await Promise.all([
    simulateSingleHybridJob(f.plan, f.snapshot, authorization, store, port),
    simulateSingleHybridJob(f.plan, f.snapshot, authorization, store, port),
  ]);
  assert(calls === 1);
});
Deno.test("exact quotes and uncertain recommendations, no independent verification claim", async () => {
  const f = await hybridFixture(),
    r = mockHybridSol(f.plan),
    v = await validateHybridResponse(r, f.plan, f.snapshot);
  assert(
    v.statistics.coverage.analysed_reviews ===
      f.plan.analytics.coverage.analysed_reviews,
  );
  assert(!v.independent_semantic_validation);
  r.verdicts[0].quote = "invented";
  let refused = false;
  try {
    await validateHybridResponse(r, f.plan, f.snapshot);
  } catch {
    refused = true;
  }
  assert(refused);
});
