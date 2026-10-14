// Durable store contract and explicit mocks ONLY. No real provider binding is installed.
import { acceptedSolDossier, type JlsPlan, parseJlsLuna } from "./jev-luna-sol.ts";
import { validateJlsReport } from "./jev-luna-sol-validation.ts";
import { hybridHash } from "./jev-hybrid-evidence.ts";
import type { PilotSnapshot } from "./jev-pilot-core.ts";
export function processJlsJob(): Promise<never> {
  return Promise.reject(new Error("JLS_PAID_EXECUTION_DISABLED"));
}
export interface JlsFutureConsent {
  consent_source: "manual_cost_confirmation" | "user_directive_codex_delegation";
  authorized_identity: string; organization_id: string; plan_sha256: string;
  max_luna_calls: number; max_sol_calls: 1; expires_at: string;
  configuration_sha256: string; automatic_retry: false;
}
export interface JlsMockStore {
  // Must be atomic/durable, keyed by run + phase + review, committed BEFORE dispatch.
  reserve: (phase: "luna" | "sol", key: string) => Promise<boolean>;
  finish: (phase: "luna" | "sol", key: string, result: unknown) => Promise<void>;
}
export interface JlsExplicitMock {
  kind: "explicit_test_mock";
  luna: (payload: JlsPlan["luna_groups"][number]["payload"]) => Promise<unknown>;
  sol: (payload: Awaited<ReturnType<typeof acceptedSolDossier>>["request"]) => Promise<{
    data: unknown; model: string; input_tokens: number; output_tokens: number; duration_ms: number; response_id: string;
  }>;
}
export async function simulateJlsLuna(p: JlsPlan, store: JlsMockStore, mock: JlsExplicitMock) {
  if (mock.kind !== "explicit_test_mock") throw new Error("JLS_PAID_EXECUTION_DISABLED");
  const out = [];
  for (const group of p.luna_groups) {
    if (!await store.reserve("luna", group.review_id)) continue;
    let raw;
    try { raw = await mock.luna(group.payload); }
    catch { await store.finish("luna", group.review_id, { status: "billing_uncertain", automatic_retry: false, request_count: 1 }); continue; }
    try {
      const parsed = await parseJlsLuna(p, group, raw);
      await store.finish("luna", group.review_id, { status: "completed", raw, parsed, request_count: 1, origin: "explicit_test_mock" });
      out.push(...parsed.decisions);
    } catch {
      await store.finish("luna", group.review_id, { status: "invalid_output", raw, request_count: 1, automatic_retry: false });
    }
  }
  return out;
}
export async function simulateJlsSol(p: JlsPlan, snapshot: PilotSnapshot, decisions: Awaited<ReturnType<typeof simulateJlsLuna>>, store: JlsMockStore, mock: JlsExplicitMock) {
  if (mock.kind !== "explicit_test_mock") throw new Error("JLS_PAID_EXECUTION_DISABLED");
  const dossier = await acceptedSolDossier(p, decisions);
  if (!dossier.accepted_ids.length) throw new Error("JLS_NO_ACCEPTED_EVIDENCE");
  // One report per run, even if a caller supplies a different derived dossier.
  const taskKey = "report";
  if (!await store.reserve("sol", taskKey)) return null;
  let response;
  try { response = await mock.sol(dossier.request); }
  catch { await store.finish("sol", taskKey, { status: "billing_uncertain", dossier_sha256: dossier.dossier_sha256, request_count: 1, automatic_retry: false }); return null; }
  const rates = p.estimates.sol.rates;
  const validUsage = Number.isSafeInteger(response.input_tokens) && response.input_tokens > 0 &&
    Number.isSafeInteger(response.output_tokens) && response.output_tokens >= 0;
  const cost_usd = response.model !== "gpt-6.1-sol" || !validUsage || rates.sol_input === null || rates.sol_output === null ? null :
    (response.input_tokens * rates.sol_input + response.output_tokens * rates.sol_output) / 1e6;
  const response_sha256 = await hybridHash(response);
  try {
    if (response.model !== "gpt-6.1-sol" || !Number.isSafeInteger(response.input_tokens) || response.input_tokens < 1 ||
      !Number.isSafeInteger(response.output_tokens) || response.output_tokens < 0 || !response.response_id) throw new Error("JLS_SOL_TELEMETRY_INVALID");
    const result = await validateJlsReport(response.data, p, snapshot, decisions);
    await store.finish("sol", taskKey, { status: "completed", dossier_sha256: dossier.dossier_sha256, result, response, response_sha256, cost_usd, request_count: 1, origin: "explicit_test_mock" });
    return result;
  } catch {
    await store.finish("sol", taskKey, { status: "invalid_output", dossier_sha256: dossier.dossier_sha256, response, response_sha256, cost_usd, request_count: 1, automatic_retry: false }); return null;
  }
}
