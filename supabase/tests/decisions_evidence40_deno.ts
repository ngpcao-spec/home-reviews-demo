import {
  decisionsHash,
  dispatchDecisions,
  evidencePayload,
} from "../functions/_shared/decisions-config.ts";
import {
  E40_HASHES,
  E40_VERSION,
  type E40Manifest,
  type E40Task,
  scoreEvidence40,
} from "../functions/_shared/decisions-evidence40.ts";
import {
  type E40Port,
  processEvidence40Batch,
} from "../functions/_shared/decisions-evidence40-worker.ts";
function assert(v: unknown, message: string) {
  if (!v) throw new Error(message);
}
Deno.test("evidence40 offline mock HTTP reserves once and never retries ambiguity", async () => {
  const payload = evidencePayload(
    "mock-case",
    "The waiter explained the menu.",
    "communication",
    "positive",
  );
  const cases = await Promise.all(Array.from({ length: 40 }, async (_, n) => ({
    position: n + 1,
    review_id: `mock-${n}`,
    theme_key: "communication" as const,
    polarity: "positive" as const,
    analysis_text: "The waiter explained the menu.",
    analysis_text_sha256: "0".repeat(64),
    axis: "service",
    payload,
    request_sha256: await decisionsHash(payload),
    estimated_input_tokens: 500,
    analysis_source: "original_en",
    translation_provenance: null,
    reference_choice: n < 4 ? "uncertain" : "positive",
    reference_annotation_sha256: "1".repeat(64),
    v3_status: "review_needed",
    jev_choice: "positive",
  })));
  const m: E40Manifest = {
    version: E40_VERSION,
    experiment_id: "mock",
    control_id: "mock",
    organization_id: "mock",
    configuration_id: "luna-decisions-evidence-choice-v1",
    hashes: E40_HASHES,
    model: "gpt-6-luna",
    max_calls: 40,
    repeat_count: 1,
    automatic_retry: false,
    production_enabled: false,
    cases,
    estimated_input_tokens: 20000,
    estimated_cost_usd: .002,
    input_usd_per_million: .1,
    output_usd_per_million: 0,
    billed_cost_verified: false,
    premiums_unverified: true,
    reference_type: "posthoc_GPT6_AI_not_human_or_independent",
    uncertain_references: 4,
  };
  const tasks = cases.map((c) => ({
    ...c,
    id: `t${c.position}`,
    run_id: "mock-run",
    status: "queued",
    request_count: 0,
    worker_id: null,
    parsed: null,
    response: null,
    response_sha256: null,
    served_model: null,
    input_tokens: null,
    output_tokens: null,
    cost_usd: null,
    duration_ms: null,
    error_code: null,
  })) as E40Task[];
  const port: E40Port = {
    claim: (w) => {
      const t = tasks.find((t) => t.status === "queued");
      if (!t) return Promise.resolve(null);
      t.status = "dispatched";
      t.request_count = 1;
      t.worker_id = w;
      return Promise.resolve(structuredClone(t));
    },
    finish: (id, w, status, output) => {
      const t = tasks.find((t) => t.id === id)!;
      assert(t.worker_id === w, "worker mismatch");
      Object.assign(t, output, { status });
      return Promise.resolve(true);
    },
    stop: async () => {},
    tasks: () => Promise.resolve(tasks),
    complete: async () => {},
  };
  let calls = 0;
  const mock = (() => {
    calls++;
    return Promise.reject(new Error("mock-timeout"));
  }) as typeof fetch;
  for (let i = 0; i < 7; i++) {
    await processEvidence40Batch(
      port,
      m,
      "mock-run",
      "mock-not-a-secret",
      mock,
    );
  }
  assert(calls === 40, "paid retry or incorrect count");
  assert(
    tasks.every((t) =>
      t.status === "billing_uncertain" && t.request_count === 1
    ),
    "uncertainty lost",
  );
  const result = scoreEvidence40(m, tasks);
  assert(result.luna.comparable === 36, "uncertain references counted");
  assert(result.luna.supported_recall === 0, "abstention inflated recall");
  assert(result.luna.selective_precision === null, "no support scored 100%");
});
Deno.test("generic Luna choice/predicate dispatcher stays disabled", async () => {
  let blocked = false;
  try {
    await dispatchDecisions();
  } catch {
    blocked = true;
  }
  assert(blocked, "generic dispatcher unlocked");
});
