// Pinned to the existing project runtime; no dependency upgrade.
// deno-lint-ignore no-import-prefix
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import { decisionsHash } from "./decisions-config.ts";
import {
  E40_CONTROL,
  E40_EVALUATION,
  E40_EXPERIMENT,
  type E40Sources,
  type E40Task,
  type E40View,
  evidence40Manifest,
} from "./decisions-evidence40.ts";
import type { E40Port } from "./decisions-evidence40-worker.ts";
export async function loadEvidence40(admin: SupabaseClient) {
  const results = await Promise.all([
    admin.from("analysis_decisions_experiments").select("*").eq(
      "id",
      E40_EXPERIMENT,
    ).single(),
    admin.from("analysis_decisions_configurations").select("*").eq(
      "organization_id",
      "93228bbb-6397-41e3-b8be-21ee7060eda7",
    ).eq("configuration_id", "luna-decisions-evidence-choice-v1").single(),
    admin.from("analysis_jev_pilot_evidence_v3_controls").select("*").eq(
      "id",
      E40_CONTROL,
    ).single(),
    admin.from("analysis_jev_pilot_evidence_v3_reserved_evaluations").select(
      "*",
    ).eq("id", E40_EVALUATION).single(),
    admin.from("analysis_jev_pilot_snapshots").select("*").eq(
      "id",
      "f9c8876b-1b5a-4d10-9538-758881b61b6b",
    ).single(),
  ]);
  if (results.some((r) => r.error || !r.data)) {
    throw new Error("EVIDENCE40_SOURCE_UNAVAILABLE");
  }
  const [experiment, config, control, evaluation, snapshot] = results.map((r) =>
    r.data
  );
  return evidence40Manifest(
    { experiment, config, control, evaluation, snapshot } as E40Sources,
  );
}
export async function e40rpc(
  admin: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await admin.rpc(name, args);
  if (error) {
    throw new Error(
      error.message.match(/(?:EVIDENCE40|FORBIDDEN)[A-Z_0-9]*/)?.[0] ??
        "EVIDENCE40_DATABASE_FAILED",
    );
  }
  return data;
}
export async function evidence40View(
  admin: SupabaseClient,
  keyConfigured: boolean,
): Promise<E40View> {
  const manifest = await loadEvidence40(admin),
    manifest_sha256 = await decisionsHash(manifest);
  const { data: plan, error: pe } = await admin.from(
    "analysis_decisions_evidence40_plans",
  ).select("id,manifest_sha256").eq("experiment_id", E40_EXPERIMENT)
    .maybeSingle();
  if (pe || plan && plan.manifest_sha256 !== manifest_sha256) {
    throw new Error("EVIDENCE40_PLAN_CHANGED");
  }
  const { data: run, error: re } = plan
    ? await admin.from("analysis_decisions_evidence40_runs").select("*").eq(
      "plan_id",
      plan.id,
    ).maybeSingle()
    : { data: null, error: null };
  if (re || run && run.manifest_sha256 !== manifest_sha256) {
    throw new Error("EVIDENCE40_RUN_CHANGED");
  }
  const tasks = run ? await evidence40Port(admin).tasks(run.id) : [];
  if (run?.result && await decisionsHash(run.result) !== run.result_sha256) {
    throw new Error("EVIDENCE40_RESULT_CHANGED");
  }
  return {
    manifest,
    manifest_sha256,
    plan_id: plan?.id ?? null,
    run,
    tasks,
    result: run?.result ?? null,
    api_key_configured: keyConfigured,
    beta_access_verified: false,
    new_paid_calls_in_this_request: 0,
  };
}
export function evidence40Port(admin: SupabaseClient): E40Port {
  return {
    claim: async (worker, run) =>
      await e40rpc(admin, "evidence40_claim", {
        p_worker: worker,
        p_run: run,
      }) as E40Task | null,
    finish: async (task, worker, status, output) =>
      await e40rpc(admin, "evidence40_finish", {
        p_task: task,
        p_worker: worker,
        p_status: status,
        p_output: output,
      }) === true,
    stop: async (run, error) => {
      await e40rpc(admin, "evidence40_stop_unsent", {
        p_run: run,
        p_error: error,
      });
    },
    tasks: async (run) => {
      const { data, error } = await admin.from(
        "analysis_decisions_evidence40_tasks",
      ).select("*").eq("run_id", run).order("position");
      if (error) throw new Error("EVIDENCE40_TASKS_UNAVAILABLE");
      return data as E40Task[];
    },
    complete: async (run, result, sha) => {
      await e40rpc(admin, "evidence40_complete", {
        p_run: run,
        p_result: result,
        p_sha: sha,
      });
    },
  };
}
