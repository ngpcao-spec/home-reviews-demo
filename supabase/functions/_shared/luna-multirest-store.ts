// deno-lint-ignore no-import-prefix
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import { decisionsHash } from "./decisions-config.ts";
import { assertEvidence40ActiveUser } from "./decisions-evidence40-auth.ts";
import { MULTI_ORG } from "./luna-multirest.ts";
import {
  MULTI_SEAL_ID,
  MULTI_SET_ID,
  multiLaunchManifest,
  type MultiLaunchSources,
  type MultiLaunchView,
  type MultiTask,
} from "./luna-multirest-launch.ts";
import type { MultiPort } from "./luna-multirest-worker.ts";
export async function multiRpc(
  admin: SupabaseClient,
  name: string,
  args: Record<string, unknown> = {},
) {
  const { data, error } = await admin.rpc(name, args);
  if (error) {
    console.error("MULTIREST_RPC_FAILED", {
      operation: name,
      code: error.code,
    });
    throw new Error(
      error.message.match(/(?:MULTIREST|FORBIDDEN)[A-Z_0-9]*/)?.[0] ??
        "MULTIREST_DATABASE_FAILED",
    );
  }
  return data;
}
export async function loadMultiLaunch(
  admin: SupabaseClient,
): Promise<MultiLaunchSources> {
  await multiRpc(admin, "luna_multi_launch_check", {
    p_set: MULTI_SET_ID,
    p_seal: MULTI_SEAL_ID,
  });
  const [s, r] = await Promise.all([
    admin.from("analysis_luna_multirest_sets").select("id,body,body_sha256").eq(
      "id",
      MULTI_SET_ID,
    ).single(),
    admin.from("analysis_luna_multirest_reference_seals").select(
      "id,set_id,dataset_sha256,reference_sha256,body",
    ).eq("id", MULTI_SEAL_ID).single(),
  ]);
  if (s.error || r.error || !s.data || !r.data) {
    throw new Error("MULTIREST_SOURCE_UNAVAILABLE");
  }
  const source = { record: s.data, seal: r.data } as MultiLaunchSources;
  await multiLaunchManifest(source);
  return source;
}
export async function multiLaunchView(
  admin: SupabaseClient,
  keyConfigured: boolean,
): Promise<MultiLaunchView> {
  const source = await loadMultiLaunch(admin),
    manifest = await multiLaunchManifest(source),
    sha = await decisionsHash(manifest);
  const { data: plan, error: pe } = await admin.from(
    "analysis_luna_multirest_plans",
  ).select("id,manifest_sha256").eq("set_id", MULTI_SET_ID).eq(
    "seal_id",
    MULTI_SEAL_ID,
  ).maybeSingle();
  if (pe || plan && plan.manifest_sha256 !== sha) {
    throw new Error("MULTIREST_PLAN_CHANGED");
  }
  const { data: run, error: re } = plan
    ? await admin.from("analysis_luna_multirest_runs").select("*").eq(
      "plan_id",
      plan.id,
    ).maybeSingle()
    : { data: null, error: null };
  if (re || run && run.manifest_sha256 !== sha) {
    throw new Error("MULTIREST_RUN_CHANGED");
  }
  const tasks = run ? await multiPort(admin).tasks(run.id) : [];
  if (run?.result && await decisionsHash(run.result) !== run.result_sha256) {
    throw new Error("MULTIREST_RESULT_CHANGED");
  }
  return {
    manifest,
    manifest_sha256: sha,
    plan_id: plan?.id ?? null,
    run,
    tasks,
    api_key_configured: keyConfigured,
    can_confirm: keyConfigured && !run,
  };
}
export function multiPort(admin: SupabaseClient): MultiPort {
  return {
    claim: async (worker, run) => {
      const { data: r, error } = await admin.from(
        "analysis_luna_multirest_runs",
      ).select("confirmed_by,organization_id,status").eq("id", run).single();
      if (error || !r || r.organization_id !== MULTI_ORG) {
        throw new Error("FORBIDDEN");
      }
      if (!["queued", "running"].includes(r.status)) return null;
      try {
        await assertEvidence40ActiveUser(admin, r.confirmed_by);
      } catch {
        await multiRpc(admin, "luna_multi_stop_unsent", {
          p_run: run,
          p_error: "MULTIREST_AUTHORIZATION_UNAVAILABLE",
        });
        return null;
      }
      return await multiRpc(admin, "luna_multi_claim", {
        p_worker: worker,
        p_run: run,
      }) as MultiTask | null;
    },
    finish: async (task, worker, status, output) =>
      await multiRpc(admin, "luna_multi_finish", {
        p_task: task,
        p_worker: worker,
        p_status: status,
        p_output: output,
      }) === true,
    stop: async (run, error) => {
      await multiRpc(admin, "luna_multi_stop_unsent", {
        p_run: run,
        p_error: error,
      });
    },
    tasks: async (run) => {
      const { data, error } = await admin.from("analysis_luna_multirest_tasks")
        .select("*").eq("run_id", run).order("position");
      if (error) throw new Error("MULTIREST_TASKS_UNAVAILABLE");
      return data as MultiTask[];
    },
    complete: async (run, result, sha) => {
      await multiRpc(admin, "luna_multi_complete", {
        p_run: run,
        p_result: result,
        p_sha: sha,
      });
    },
  };
}
