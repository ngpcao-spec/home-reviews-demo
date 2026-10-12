import {
  DECISIONS_RATE,
  decisionsHash,
  parseEvidenceDecision,
} from "./decisions-config.ts";
import {
  type E40Manifest,
  type E40Task,
  scoreEvidence40,
} from "./decisions-evidence40.ts";

// Provider authentication errors may echo a key. Never persist or expose that text.
export function redactDecisionSecrets(raw: unknown, key: string): unknown {
  const original = JSON.stringify(raw);
  const safe = original.replaceAll(key, "[redacted API secret]").replace(
    /\bsk-[A-Za-z0-9_-]{6,}\b/g,
    "[redacted API token]",
  );
  if (safe === original) return raw;
  const sanitized = JSON.parse(safe);
  if (sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)) {
    sanitized._secret_redacted = true;
  }
  return sanitized;
}

export interface E40Port {
  claim(worker: string, run: string | null): Promise<E40Task | null>;
  finish(
    task: string,
    worker: string,
    status: string,
    output: Record<string, unknown>,
  ): Promise<boolean>;
  stop(run: string, error: string): Promise<void>;
  tasks(run: string): Promise<E40Task[]>;
  complete(
    run: string,
    result: ReturnType<typeof scoreEvidence40>,
    sha: string,
  ): Promise<void>;
}
export async function processEvidence40Batch(
  port: E40Port,
  manifest: E40Manifest,
  runId: string,
  key: string,
  http: typeof fetch,
) {
  if (!key.trim()) {
    await port.stop(runId, "DECISIONS_API_KEY_UNAVAILABLE");
    const ts = await port.tasks(runId);
    const result = scoreEvidence40(manifest, ts);
    await port.complete(runId, result, await decisionsHash(result));
    return;
  }
  // Eight fresh tasks per invocation; at most four in parallel. Cron resumes only unsent tasks.
  for (let batch = 0; batch < 2; batch++) {
    const workers = Array.from({ length: 4 }, () => crypto.randomUUID());
    await Promise.all(workers.map(async (worker) => {
      const task = await port.claim(worker, runId);
      if (!task) return;
      const start = Date.now();
      let response: unknown = null, status = "billing_uncertain";
      const output: Record<string, unknown> = {};
      try {
        const frozen = manifest.cases.find((i) => i.position === task.position);
        if (
          !frozen || task.run_id !== runId || task.status !== "dispatched" ||
          task.request_count !== 1 || task.worker_id !== worker ||
          task.review_id !== frozen.review_id ||
          task.analysis_text_sha256 !== frozen.analysis_text_sha256 ||
          task.request_sha256 !== frozen.request_sha256 ||
          await decisionsHash(task.payload) !== frozen.request_sha256
        ) {
          status = "failed";
          throw new Error("EVIDENCE40_RESERVED_TASK_CHANGED");
        }
        // Single fetch, no SDK retry layer, redirect or fallback endpoint.
        const r = await http("https://api.openai.com/v1/decisions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(frozen.payload),
          signal: AbortSignal.timeout(25000),
          redirect: "error",
        });
        output.provider_request_id = r.headers.get("x-request-id");
        try {
          response = redactDecisionSecrets(await r.json(), key);
        } catch {
          throw new Error("DECISIONS_INVALID_JSON");
        }
        output.response = response;
        output.response_sha256 = await decisionsHash(response);
        if (!r.ok) {
          status = [401, 403, 404].includes(r.status)
            ? "failed"
            : "billing_uncertain";
          if ([401, 403, 404].includes(r.status)) {
            await port.stop(runId, `DECISIONS_ACCESS_HTTP_${r.status}`);
          }
          throw new Error(`DECISIONS_HTTP_${r.status}`);
        }
        const raw = response as Record<string, unknown>;
        output.served_model = typeof raw.model === "string" ? raw.model : null;
        const expectedModel = typeof raw.model === "string" &&
          /^gpt-6-luna(?:-\d{4}-\d{2}-\d{2})?$/.test(raw.model);
        output.response_id = typeof raw.id === "string" ? raw.id : null;
        // Preserve independently usable telemetry even if an answer is invalid.
        const usage = raw.usage as Record<string, unknown> | undefined;
        if (
          usage && Number.isSafeInteger(usage.input_tokens) &&
          Number(usage.input_tokens) >= 0 &&
          Number.isSafeInteger(usage.output_tokens) &&
          Number(usage.output_tokens) >= 0 &&
          usage.total_tokens ===
            Number(usage.input_tokens) + Number(usage.output_tokens)
        ) {
          output.input_tokens = usage.input_tokens;
          output.output_tokens = usage.output_tokens;
          output.usage_details = usage;
          output.cost_usd = expectedModel
            ? Number(usage.input_tokens) * DECISIONS_RATE / 1e6
            : null;
        }
        status = "failed";
        if (!expectedModel) {
          throw new Error("DECISIONS_UNEXPECTED_SERVED_MODEL");
        }
        const parsed = parseEvidenceDecision(response);
        output.parsed = parsed;
        output.answer_type = (raw.answers as Record<string, unknown>[])[0].type;
        status = "completed";
      } catch (e) {
        output.error_code = e instanceof Error && /^[A-Z_0-9]+$/.test(e.message)
          ? e.message
          : "DECISIONS_NETWORK_OR_TIMEOUT_BILLING_UNCERTAIN";
      }
      output.duration_ms = Date.now() - start;
      // A failed persistence operation never results in a second provider request.
      await port.finish(task.id, worker, status, output);
    }));
  }
  const tasks = await port.tasks(runId);
  if (
    tasks.length === 40 &&
    !tasks.some((t) => t.status === "queued" || t.status === "dispatched")
  ) {
    const result = scoreEvidence40(manifest, tasks);
    await port.complete(runId, result, await decisionsHash(result));
  }
}
