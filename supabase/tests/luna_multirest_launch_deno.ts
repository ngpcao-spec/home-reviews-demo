import { mockMultiLaunch } from "../../tests/fixtures/luna-multirest-launch.ts";
import { multiLaunchManifest } from "../functions/_shared/luna-multirest-launch.ts";
import {
  type MultiPort,
  processMultirestBatch,
} from "../functions/_shared/luna-multirest-worker.ts";
const assert = (x: unknown) => {
  if (!x) throw new Error("ASSERTION_FAILED");
};
Deno.test("39 frozen cases; case32 excluded; exact source hashes and cost", async () => {
  const f = await mockMultiLaunch(), m = await multiLaunchManifest(f.source);
  assert(
    m.cases.length === 39 && !m.cases.some((c) => c.position === 32) &&
      m.max_calls === 39 && !m.automatic_retry,
  );
  assert(m.estimated_cost_usd === .00195);
  f.source.seal.body.items[0].choice = "negative";
  let rejected = false;
  try {
    await multiLaunchManifest(f.source);
  } catch {
    rejected = true;
  }
  assert(rejected);
});
Deno.test("missing key uses no provider even with queued work", async () => {
  const f = await mockMultiLaunch();
  let calls = 0;
  const port: MultiPort = {
    claim: () => Promise.resolve(null),
    finish: () => Promise.resolve(true),
    stop: () => {
      f.tasks.forEach((t) => t.status = "cancelled");
      return Promise.resolve();
    },
    tasks: () => Promise.resolve(f.tasks),
    complete: () => Promise.resolve(),
  };
  await processMultirestBatch(port, f.source, "mock-run", "", () => {
    calls++;
    return Promise.resolve(Response.json({}));
  });
  assert(calls === 0 && f.tasks.every((t) => t.request_count === 0));
});
Deno.test("each durable task can be called only once across worker batches", async () => {
  const f = await mockMultiLaunch();
  let calls = 0;
  const port: MultiPort = {
    claim: (worker) => {
      const t = f.tasks.find((t) => t.status === "queued");
      if (!t) return Promise.resolve(null);
      Object.assign(t, {
        status: "dispatched",
        worker_id: worker,
        request_count: 1,
      });
      return Promise.resolve(structuredClone(t));
    },
    finish: (id, _worker, status, output) => {
      Object.assign(f.tasks.find((t) => t.id === id)!, output, { status });
      return Promise.resolve(true);
    },
    stop: () => Promise.resolve(),
    tasks: () => Promise.resolve(f.tasks),
    complete: () => Promise.resolve(),
  };
  for (let n = 0; n < 7; n++) {
    await processMultirestBatch(port, f.source, "mock-run", "mock", () => {
      calls++;
      return Promise.resolve(Response.json({
        model: "gpt-6-luna",
        answers: [{
          type: "choice",
          name: "evidence_support",
          choice: "supported",
          confidence: .9,
          probabilities: [{ value: "supported", probability: .9 }, {
            value: "unsupported",
            probability: .05,
          }, { value: "uncertain", probability: .05 }],
        }],
        usage: { input_tokens: 500, output_tokens: 0, total_tokens: 500 },
      }));
    });
  }
  assert(calls === 39 && f.tasks.every((t) => t.request_count === 1));
});
