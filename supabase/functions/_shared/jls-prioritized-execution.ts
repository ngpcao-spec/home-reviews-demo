// Protocol preparation is free and is NOT execution consent.
import { hybridHash } from "./jev-hybrid-evidence.ts";
import { negativeHash } from "./negative-validation-core.ts";
import { verifyPrioritizedDraft, type PrioritizedDraft, JLS_PRIORITIZED_VERSION } from "./jev-luna-sol-prioritized.ts";
import { type JlsPlan, type JlsDecision, parseJlsLuna } from "./jev-luna-sol.ts";
import { evidenceSufficiency } from "./jev-luna-sol-delegation.ts";
export const JLS_PRI_EXEC_VERSION = "jls-prioritized-vi-delegated-execution-v1";
export const JLS_PRI_SOURCE_RUN = "489d42ae-c44c-40c1-8435-16f304c71a9e";
export interface PrioritizedPreparation {
  id: number; sha256: string; body: {
    version: string; language: string; organization_id: string; source_plan_id: string;
    source_plan_sha256: string; source_run_id: string; source_result_sha256: string;
    execution_authorized: boolean; draft: PrioritizedDraft;
  };
}
export interface ReusedLunaTask {
  id: string; organization_id: string; run_id: string; review_id: string; phase: string;
  status: string; request_count: number; request: unknown; request_sha256: string;
  response: unknown; response_sha256: string; served_model: string;
  parsed: { decisions: JlsDecision[] };
}
export interface PrioritizedHistory {
  run_id: string; plan_id: string; organization_id: string;
  result: { body: { luna_decisions: JlsDecision[] }; result_sha256: string };
  tasks: ReusedLunaTask[];
}
export async function verifyReusedLuna(p: JlsPlan, history: PrioritizedHistory) {
  if (history.organization_id !== p.organization_id || await hybridHash(history.result.body) !== history.result.result_sha256)
    throw new Error("JLS_PRI_HISTORICAL_RESULT_CHANGED");
  const tasks = history.tasks.filter(t => t.phase === "luna"), all: JlsDecision[] = [];
  if (tasks.length !== p.max_luna_calls || new Set(tasks.map(t => t.review_id)).size !== p.max_luna_calls)
    throw new Error("JLS_PRI_LUNA_HISTORY_INCOMPLETE");
  for (const t of tasks) {
    const g = p.luna_groups.find(g => g.review_id === t.review_id);
    if (!g || t.run_id !== history.run_id || t.organization_id !== p.organization_id || t.status !== "completed" ||
      t.request_count !== 1 || t.served_model !== p.config.luna_model || t.request_sha256 !== g.request_sha256 ||
      await hybridHash(t.request) !== g.request_sha256 || await hybridHash(t.response) !== t.response_sha256)
      throw new Error("JLS_PRI_LUNA_HISTORY_INCOMPATIBLE");
    const native = await parseJlsLuna(p, g, t.response);
    if (await hybridHash(native.decisions) !== await hybridHash(t.parsed?.decisions)) throw new Error("JLS_PRI_LUNA_NATIVE_DECISION_CHANGED");
    all.push(...native.decisions);
  }
  const sorted = (ds: JlsDecision[]) => [...ds].sort((a,b) => a.evidence_id.localeCompare(b.evidence_id));
  if (await hybridHash(sorted(all)) !== await hybridHash(sorted(history.result.body.luna_decisions))) throw new Error("JLS_PRI_LUNA_NATIVE_DECISION_CHANGED");
  return history.result.body.luna_decisions;
}
export async function prioritizedExecutionProtocol(prep: PrioritizedPreparation, p: JlsPlan, history: PrioritizedHistory) {
  const b = prep.body, decisions = await verifyReusedLuna(p, history);
  if (await hybridHash(b) !== prep.sha256 || b.version !== JLS_PRIORITIZED_VERSION || b.language !== "vi" ||
    b.draft.language !== "vi" || b.execution_authorized !== false || b.organization_id !== p.organization_id ||
    b.source_plan_id !== history.plan_id || b.source_run_id !== history.run_id ||
    b.source_plan_sha256 !== await hybridHash(p) || b.source_result_sha256 !== history.result.result_sha256)
    throw new Error("JLS_PRI_EXECUTION_SCOPE_CHANGED");
  await verifyPrioritizedDraft(b.draft, p, decisions);
  const gate = evidenceSufficiency(p, b.draft.accepted_ids, true);
  if (!gate.passed) throw new Error("JLS_PRI_EVIDENCE_INSUFFICIENT");
  return {
    version: JLS_PRI_EXEC_VERSION, format_version: JLS_PRIORITIZED_VERSION,
    organization_id: p.organization_id, establishment_id: p.establishment_id,
    source_plan_id: b.source_plan_id, source_plan_sha256: b.source_plan_sha256,
    source_run_id: history.run_id, source_result_sha256: history.result.result_sha256,
    source_snapshot_id: p.source_snapshot_id, source_sha256: p.source_sha256,
    cache_fingerprints_sha256: await hybridHash(p.cache_fingerprints),
    preparation_event_id: prep.id, preparation_sha256: prep.sha256,
    decisions_sha256: b.draft.decisions_sha256,
    reused_luna_manifest_sha256: await hybridHash(tasksManifest(history.tasks)),
    dossier_sha256: b.draft.dossier_sha256, prompt_sha256: b.draft.prompt_sha256,
    schema_sha256: b.draft.schema_sha256, request_sha256: b.draft.request_sha256,
    configuration_sha256: b.draft.config_sha256, statistics_sha256: p.statistics_sha256,
    language: "vi", requested_model: "gpt-6.1-sol", endpoint: "/v1/responses", reasoning: "low",
    max_sol_calls: 1, jev_new_calls: 0, luna_new_calls: 0, apify_new_calls: 0,
    automatic_retry: false, provider_client_retries: 0, provider_timeout_ms: 110000,
    authorization_ttl_hours: 24, reservation_lease_seconds: 300,
    gate, estimates: b.draft.estimates,
    consent_source: "user_directive_codex_delegation", operator_identity: { kind: "codex_admin", channel: "supabase_mcp" },
    future_explicit_execution_consent_required: true, preparation_is_not_spending_authorization: true,
    human_validated: false, production_enabled: false,
  };
}
export function tasksManifest(tasks: ReusedLunaTask[]) {
  return tasks.filter(t=>t.phase==="luna").map(t=>({task_id:t.id,review_id:t.review_id,
    request_sha256:t.request_sha256,response_sha256:t.response_sha256,served_model:t.served_model,request_count:t.request_count}))
    .sort((a,b)=>a.review_id.localeCompare(b.review_id));
}
export type PrioritizedProtocol = Awaited<ReturnType<typeof prioritizedExecutionProtocol>>;
// Only a FUTURE direct human GO authorizes calling this builder and the admin RPC.
// It is never called by the preparation script, a GET, deployment or migration.
export async function prioritizedConsent(p: PrioritizedProtocol, sha256: string, directUserGo: string, requestedAt: string) {
  if (sha256 !== await hybridHash(p) || directUserGo.trim().length < 20 || !Number.isFinite(Date.parse(requestedAt)))
    throw new Error("JLS_PRI_NEW_EXECUTION_GO_REQUIRED");
  return { version: JLS_PRI_EXEC_VERSION, protocol_sha256: sha256,
    action: "execute_prioritized_vi_sol_once", execution_authorized: true,
    consent_source: p.consent_source, operator_identity: p.operator_identity,
    user_directive: directUserGo, directive_sha256: await negativeHash(directUserGo),
    requested_at: requestedAt, expires_at: new Date(Date.parse(requestedAt)+p.authorization_ttl_hours*3600000).toISOString(),
    scope: { format_version:p.format_version, language:p.language, requested_model:p.requested_model, endpoint:p.endpoint,
      source_plan_id:p.source_plan_id,source_run_id:p.source_run_id,organization_id:p.organization_id,
      request_sha256:p.request_sha256,preparation_sha256:p.preparation_sha256,decisions_sha256:p.decisions_sha256,
      configuration_sha256:p.configuration_sha256,max_sol_calls:1,jev_new_calls:0,luna_new_calls:0,apify_new_calls:0,automatic_retry:false },
    approved_estimates:p.estimates,
  };
}
