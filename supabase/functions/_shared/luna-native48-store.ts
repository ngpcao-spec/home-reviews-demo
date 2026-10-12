// deno-lint-ignore no-import-prefix
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import { decisionsHash } from "./decisions-config.ts";
import { assertEvidence40ActiveUser } from "./decisions-evidence40-auth.ts";
import {
  NATIVE48_ORG,
  NATIVE48_SEAL,
  NATIVE48_SET,
  native48Manifest,
  type NativeSource,
  type NativeTask,
  type NativeView,
  verifyNative48,
} from "./luna-native48.ts";
import type { NativePort } from "./luna-native48-worker.ts";
export async function native48Rpc(
  admin: SupabaseClient,
  name: string,
  args: Record<string, unknown> = {},
) {
  const { data, error } = await admin.rpc(name, args);
  if (error) {
    console.error("NATIVE48_RPC_FAILED", { operation: name, code: error.code });
    throw new Error(
      error.message.match(/(?:NATIVE48|FORBIDDEN)[A-Z_0-9]*/)?.[0] ??
        "NATIVE48_DATABASE_FAILED",
    );
  }
  return data;
}
export async function loadNative48(
  admin: SupabaseClient,
): Promise<NativeSource> {
  const s = await native48Rpc(admin, "native48_source_check") as NativeSource;
  await verifyNative48(s);
  return s;
}
export async function native48View(
  admin: SupabaseClient,
  keyConfigured: boolean,
): Promise<NativeView> {
  const source = await loadNative48(admin),
    manifest = await native48Manifest(source),
    sha = await decisionsHash(manifest);
  const { data: plan, error: pe } = await admin.from(
    "analysis_luna_native48_plans",
  ).select("id,manifest_sha256").eq("set_id", NATIVE48_SET).eq(
    "seal_id",
    NATIVE48_SEAL,
  ).maybeSingle();
  if (pe || plan && plan.manifest_sha256 !== sha) {
    throw new Error("NATIVE48_PLAN_CHANGED");
  }
  const { data: run, error: re } = plan
    ? await admin.from("analysis_luna_native48_runs").select("*").eq(
      "plan_id",
      plan.id,
    ).maybeSingle()
    : { data: null, error: null };
  if (re || run && run.manifest_sha256 !== sha) {
    throw new Error("NATIVE48_RUN_CHANGED");
  }
  if (run?.result && await decisionsHash(run.result) !== run.result_sha256) {
    throw new Error("NATIVE48_RESULT_CHANGED");
  }
  return {
    source,
    manifest,
    manifest_sha256: sha,
    plan_id: plan?.id ?? null,
    run,
    tasks: run ? await native48Port(admin).tasks(run.id) : [],
    api_key_configured: keyConfigured,
    new_paid_calls: 0,
    production_enabled: false,
    economic_comparison: await native48Rpc(admin, "native48_economic_context"),
  };
}
export function native48Port(admin: SupabaseClient): NativePort {
  return {
    claim: async (worker, run) => {
      const { data: r, error } = await admin.from("analysis_luna_native48_runs")
        .select("organization_id,status").eq("id", run).single();
      if (error || !r || r.organization_id !== NATIVE48_ORG) {
        throw new Error("FORBIDDEN");
      }
      if (!["queued", "running"].includes(r.status)) return null;
      const { data: owner, error: oe } = await admin.from(
        "analysis_luna_balanced_sets",
      ).select("created_by").eq("id", NATIVE48_SET).single();
      if (oe || !owner) throw new Error("NATIVE48_SOURCE_UNAVAILABLE");
      try {
        await assertEvidence40ActiveUser(admin, owner.created_by);
      } catch {
        await native48Rpc(admin, "native48_stop_unsent", {
          p_run: run,
          p_error: "NATIVE48_ORGANIZATION_AUTHORITY_UNAVAILABLE",
        });
        return null;
      }
      return await native48Rpc(admin, "native48_claim", {
        p_worker: worker,
        p_run: run,
      }) as NativeTask | null;
    },
    finish: async (task, worker, status, output) =>
      await native48Rpc(admin, "native48_finish", {
        p_task: task,
        p_worker: worker,
        p_status: status,
        p_output: output,
      }) === true,
    stop: async (run, error) => {
      await native48Rpc(admin, "native48_stop_unsent", {
        p_run: run,
        p_error: error,
      });
    },
    tasks: async (run) => {
      const { data, error } = await admin.from("analysis_luna_native48_tasks")
        .select("*").eq("run_id", run).order("position");
      if (error) throw new Error("NATIVE48_TASKS_UNAVAILABLE");
      return data as NativeTask[];
    },
    complete: async (run, result, sha) => {
      await native48Rpc(admin, "native48_complete", {
        p_run: run,
        p_result: result,
        p_sha: sha,
      });
    },
  };
}
