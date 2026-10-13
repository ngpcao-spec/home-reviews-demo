import {
  blindNegativeExport,
  NEG_ORG,
  type NegInput,
  prepareNegativeSet,
} from "../_shared/luna-negative-v2.ts";
import { decisionsHash } from "../_shared/decisions-config.ts";
import {
  negativeLaunchManifest,
  type NegativeTask,
  NV2_SEAL,
  NV2_SET,
} from "../_shared/luna-negative-v2-launch.ts";
import {
  type NegativePort,
  processNegativeBatch,
} from "../_shared/luna-negative-v2-worker.ts";
const assert = (v: unknown) => {
  if (!v) throw new Error("ASSERT_FAILED");
};
Deno.test("V2 grouped durable worker with mocks only: 28 requests, 32 decisions, no resend", async () => {
  const id = (i: number) =>
      "00000000-0000-4000-8000-" + String(i).padStart(12, "0"),
    unused: NegInput[] = Array.from({ length: 28 }, (_, i) => ({
      review_id: id(i + 1),
      organization_id: NEG_ORG,
      establishment_id: id(100 + i % 13),
      establishment_name: "Synthetic " + i % 13,
      rating: i < 4 ? 2 : 5,
      original_language: "en",
      original_text: i < 4
        ? "The soup was cold and the food was bland."
        : i < 16
        ? "The food was good but the portions were small."
        : "The food was delicious and the staff were friendly.",
    }));
  const body = await prepareNegativeSet({
      history_tables: ["mock"],
      historical_review_ids: 0,
      total_text_reviews: 28,
      unused,
    }, "2026-10-13"),
    sha = await decisionsHash(body),
    refs = {
      dataset_sha256: sha,
      annotation_model: "GPT-6" as const,
      reference_type: "GPT6_AI_reference_not_independent_human_Gold" as const,
      items: blindNegativeExport(body).map((x) => ({
        ...x,
        choice: "negative" as const,
        justification: "SYNTHETIC ONLY",
      })),
    },
    refsha = await decisionsHash(refs),
    source = {
      record: { id: NV2_SET, body, body_sha256: sha },
      seal: {
        id: NV2_SEAL,
        set_id: NV2_SET,
        dataset_sha256: sha,
        reference_sha256: refsha,
        body: refs,
      },
    },
    manifest = await negativeLaunchManifest(source, {
      dataset: sha,
      reference: refsha,
    });
  assert(body.review_count === 28 && body.question_count === 32);
  const run = id(900),
    tasks: NegativeTask[] = manifest.cases.map((c) => ({
      id: id(500 + c.position),
      run_id: run,
      organization_id: NEG_ORG,
      position: c.position,
      review_id: c.review_id,
      payload: c.payload,
      request_sha256: c.request_sha256,
      analysis_text_sha256: c.analysis_text_sha256,
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
    }));
  let count = 0;
  const port: NegativePort = {
    claim: async (w) => {
      const t = tasks.find((x) => x.status === "queued");
      if (!t) return null;
      t.status = "dispatched";
      t.request_count = 1;
      t.worker_id = w;
      return structuredClone(t);
    },
    finish: async (id, w, status, o) => {
      const t = tasks.find((t) => t.id === id)!;
      assert(t.worker_id === w);
      Object.assign(t, o, { status });
      return true;
    },
    stop: () => Promise.resolve(),
    tasks: () => Promise.resolve(tasks),
    complete: () => Promise.resolve(),
  };
  const http = (async (url, opts) => {
    assert(url === "https://api.openai.com/v1/decisions");
    const p = JSON.parse(String(opts?.body));
    count++;
    return new Response(JSON.stringify({
      model: "gpt-6-luna",
      usage: { input_tokens: 487, output_tokens: 0, total_tokens: 487 },
      answers: p.questions.map((q: { name: string }) => ({
        name: q.name,
        type: "choice",
        choice: "supported",
        confidence: .9,
        probabilities: [{ value: "supported", probability: .9 }, {
          value: "unsupported",
          probability: .05,
        }, { value: "uncertain", probability: .05 }],
      })),
    }));
  }) as typeof fetch;
  for (let i = 0; i < 5; i++) {
    await processNegativeBatch(port, source, run, "mock", http, manifest);
  }
  assert(count === 28);
  assert(tasks.flatMap((t) => t.parsed!.observations).length === 32);
  assert(tasks.every((t) => t.request_count === 1 && t.status === "completed"));
  assert(tasks[0].cost_usd === .0000487);
});
