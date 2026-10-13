// Same durable single-attempt pattern as multirest, using grouped-answer parsing.
import { DECISIONS_RATE, decisionsHash } from "./decisions-config.ts";
import { redactDecisionSecrets } from "./decisions-evidence40-worker.ts";
import { parseNegativeGroup } from "./luna-negative-v2.ts";
import {
  negativeLaunchManifest,
  type NegativeLaunchSource,
  type NegativeManifest,
  type NegativeRunResult,
  negativeRunScore,
  type NegativeTask,
} from "./luna-negative-v2-launch.ts";
export interface NegativePort {
  claim(worker: string, run: string): Promise<NegativeTask | null>;
  finish(
    task: string,
    worker: string,
    status: string,
    output: Record<string, unknown>,
  ): Promise<boolean>;
  stop(run: string, error: string): Promise<void>;
  tasks(run: string): Promise<NegativeTask[]>;
  complete(run: string, result: NegativeRunResult, sha: string): Promise<void>;
}
export async function processNegativeBatch(
  port: NegativePort,
  source: NegativeLaunchSource,
  runId: string,
  key: string,
  http: typeof fetch,
  preparedManifest?: NegativeManifest,
) {
  const manifest = preparedManifest ?? await negativeLaunchManifest(source);
  if (!key.trim()) await port.stop(runId, "DECISIONS_API_KEY_UNAVAILABLE");
  else {for (let batch = 0; batch < 2; batch++) {
      await Promise.all(Array.from({ length: 4 }, async () => {
        const worker = crypto.randomUUID(),
          task = await port.claim(worker, runId);
        if (!task) return;
        const start = Date.now(), output: Record<string, unknown> = {};
        let status = "billing_uncertain";
        try {
          const frozen = manifest.cases.find((c) =>
              c.position === task.position
            ),
            review = source.record.body.reviews.find((r) =>
              r.review_id === task.review_id
            );
          if (
            !frozen || !review || task.run_id !== runId ||
            task.organization_id !== manifest.organization_id ||
            task.status !== "dispatched" || task.request_count !== 1 ||
            task.worker_id !== worker || task.review_id !== frozen.review_id ||
            task.analysis_text_sha256 !== frozen.analysis_text_sha256 ||
            task.request_sha256 !== frozen.request_sha256 ||
            await decisionsHash(task.payload) !== frozen.request_sha256
          ) {
            status = "failed";
            throw new Error("NEGATIVE_V2_RESERVED_TASK_CHANGED");
          }
          // No SDK retries, redirect, alternate endpoint or fallback API.
          const response = await http("https://api.openai.com/v1/decisions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(frozen.payload),
            signal: AbortSignal.timeout(25000),
            redirect: "error",
          });
          output.provider_request_id = response.headers.get("x-request-id");
          let raw: Record<string, unknown>;
          try {
            raw = redactDecisionSecrets(await response.json(), key) as Record<
              string,
              unknown
            >;
          } catch {
            throw new Error("DECISIONS_INVALID_JSON");
          }
          output.response = raw;
          output.response_sha256 = await decisionsHash(raw);
          output.served_model = typeof raw.model === "string"
            ? raw.model
            : null;
          output.response_id = typeof raw.id === "string" ? raw.id : null;
          const expectedModel = typeof raw.model === "string" &&
              /^gpt-6-luna(?:-\d{4}-\d{2}-\d{2})?$/.test(raw.model),
            usage = raw.usage as Record<string, unknown> | undefined;
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
              ? Number(
                (Number(usage.input_tokens) * DECISIONS_RATE / 1e6).toFixed(12),
              )
              : null;
          }
          if (!response.ok) {
            status = [401, 403, 404].includes(response.status)
              ? "failed"
              : "billing_uncertain";
            if ([401, 403, 404].includes(response.status)) {
              await port.stop(
                runId,
                `DECISIONS_ACCESS_HTTP_${response.status}`,
              );
            }
            throw new Error(`DECISIONS_HTTP_${response.status}`);
          }
          if (!expectedModel) {
            status = "failed";
            await port.stop(runId, "DECISIONS_UNEXPECTED_SERVED_MODEL");
            throw new Error("DECISIONS_UNEXPECTED_SERVED_MODEL");
          }
          status = "failed";
          output.parsed = JSON.parse(
            JSON.stringify(parseNegativeGroup(review, raw)),
          );
          output.answer_type = "grouped_choice";
          status = "completed";
        } catch (e) {
          output.error_code =
            e instanceof Error && /^[A-Z_0-9]+$/.test(e.message)
              ? e.message
              : "DECISIONS_NETWORK_OR_TIMEOUT_BILLING_UNCERTAIN";
        }
        output.duration_ms = Date.now() - start;
        // Reservation stays consumed even if saving fails. Never send this task again.
        await port.finish(task.id, worker, status, output);
      }));
    }}
  const tasks = await port.tasks(runId);
  if (
    tasks.length === 28 &&
    !tasks.some((t) => ["queued", "dispatched"].includes(t.status))
  ) {
    const result = await negativeRunScore(source, tasks, runId);
    await port.complete(runId, result, await decisionsHash(result));
  }
}
