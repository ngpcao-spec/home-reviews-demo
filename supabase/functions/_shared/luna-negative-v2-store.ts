// Same authenticated service adapter as the existing Luna runners; distinct V2 tables/RPCs.
// deno-lint-ignore no-import-prefix
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import { assertEvidence40ActiveUser } from "./decisions-evidence40-auth.ts";
import { decisionsHash } from "./decisions-config.ts";
import { NEG_ORG } from "./luna-negative-v2.ts";
import {
  negativeLaunchManifest,
  type NegativeLaunchSource,
  type NegativeLaunchView,
  type NegativeTask,
  NV2_SEAL,
  NV2_SET,
} from "./luna-negative-v2-launch.ts";
import type { NegativePort } from "./luna-negative-v2-worker.ts";
export async function negativeLaunchRpc(
  admin: SupabaseClient,
  name: string,
  args: Record<string, unknown> = {},
) {
  const { data, error } = await admin.rpc(name, args);
  if (error) {
    console.error("NEGATIVE_V2_RPC_FAILED", {
      operation: name,
      code: error.code,
    });
    throw new Error(
      error.message.match(/(?:NEGATIVE_V2|FORBIDDEN)[A-Z_0-9]*/)?.[0] ??
        "NEGATIVE_V2_DATABASE_FAILED",
    );
  }
  return data;
}
export async function loadNegativeLaunch(
  admin: SupabaseClient,
): Promise<NegativeLaunchSource> {
  await negativeLaunchRpc(admin, "luna_nv2_launch_check", {
    p_set: NV2_SET,
    p_seal: NV2_SEAL,
  });
  const [s, r] = await Promise.all([
    admin.from("analysis_luna_negative_v2_sets").select("id,body,body_sha256")
      .eq("id", NV2_SET).single(),
    admin.from("analysis_luna_negative_v2_reference_seals").select(
      "id,set_id,dataset_sha256,reference_sha256,body",
    ).eq("id", NV2_SEAL).single(),
  ]);
  if (s.error || r.error || !s.data || !r.data) {
    throw new Error("NEGATIVE_V2_SOURCE_UNAVAILABLE");
  }
  const source = { record: s.data, seal: r.data } as NegativeLaunchSource;
  await negativeLaunchManifest(source);
  return source;
}
export async function negativeLaunchView(
  admin: SupabaseClient,
  keyConfigured: boolean,
): Promise<NegativeLaunchView> {
  const source = await loadNegativeLaunch(admin),
    manifest = await negativeLaunchManifest(source),
    sha = await decisionsHash(manifest);
  const { data: plan, error: pe } = await admin.from(
    "analysis_luna_negative_v2_plans",
  ).select("id,manifest_sha256").eq("set_id", NV2_SET).eq("seal_id", NV2_SEAL)
    .maybeSingle();
  if (pe || plan && plan.manifest_sha256 !== sha) {
    throw new Error("NEGATIVE_V2_PLAN_CHANGED");
  }
  const { data: run, error: re } = plan
    ? await admin.from("analysis_luna_negative_v2_runs").select("*").eq(
      "plan_id",
      plan.id,
    ).maybeSingle()
    : { data: null, error: null };
  if (re || run && run.manifest_sha256 !== sha) {
    throw new Error("NEGATIVE_V2_RUN_CHANGED");
  }
  const tasks = run ? await negativePort(admin).tasks(run.id) : [];
  if (run?.result && await decisionsHash(run.result) !== run.result_sha256) {
    throw new Error("NEGATIVE_V2_RESULT_CHANGED");
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
export function negativePort(admin: SupabaseClient): NegativePort {
  return {
    claim: async (worker, run) => {
      const { data: r, error } = await admin.from(
        "analysis_luna_negative_v2_runs",
      ).select("confirmed_by,organization_id,status").eq("id", run).single();
      if (error || !r || r.organization_id !== NEG_ORG) {
        throw new Error("FORBIDDEN");
      }
      if (!["queued", "running"].includes(r.status)) return null;
      try {
        await assertEvidence40ActiveUser(admin, r.confirmed_by);
      } catch {
        await negativeLaunchRpc(admin, "luna_nv2_stop_unsent", {
          p_run: run,
          p_error: "NEGATIVE_V2_AUTHORIZATION_UNAVAILABLE",
        });
        return null;
      }
      return await negativeLaunchRpc(admin, "luna_nv2_claim", {
        p_worker: worker,
        p_run: run,
      }) as NegativeTask | null;
    },
    finish: async (task, worker, status, output) =>
      await negativeLaunchRpc(admin, "luna_nv2_finish", {
        p_task: task,
        p_worker: worker,
        p_status: status,
        p_output: output,
      }) === true,
    stop: async (run, error) => {
      await negativeLaunchRpc(admin, "luna_nv2_stop_unsent", {
        p_run: run,
        p_error: error,
      });
    },
    tasks: async (run) => {
      const { data, error } = await admin.from(
        "analysis_luna_negative_v2_tasks",
      ).select("*").eq("run_id", run).order("position");
      if (error) throw new Error("NEGATIVE_V2_TASKS_UNAVAILABLE");
      return data as NegativeTask[];
    },
    complete: async (run, result, sha) => {
      await negativeLaunchRpc(admin, "luna_nv2_complete", {
        p_run: run,
        p_result: result,
        p_sha: sha,
      });
    },
  };
}
