import { assertMembership, requireUser } from "../_shared/auth.ts";
import { evidence40Handler } from "../_shared/decisions-evidence40-api.ts";
import {
  e40rpc,
  evidence40Port,
  evidence40View,
  loadEvidence40,
} from "../_shared/decisions-evidence40-store.ts";
import { processEvidence40Batch } from "../_shared/decisions-evidence40-worker.ts";
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
Deno.serve(evidence40Handler(async (r) => {
  const ctx = await requireUser(r), key = Deno.env.get("OPENAI_API_KEY") ?? "";
  return {
    authorize: async () => {
      await assertMembership(
        ctx.client,
        ctx.user.id,
        "93228bbb-6397-41e3-b8be-21ee7060eda7",
        ["owner", "admin", "manager"],
      );
    },
    view: () => evidence40View(ctx.admin, !!key.trim()),
    prepare: async (v) =>
      await e40rpc(ctx.admin, "evidence40_save_plan", {
        p_user: ctx.user.id,
        p_manifest: v.manifest,
        p_sha: v.manifest_sha256,
      }) as string,
    confirm: async (v, b) =>
      await e40rpc(ctx.admin, "evidence40_confirm", {
        p_user: ctx.user.id,
        p_plan: v.plan_id,
        p_sha: v.manifest_sha256,
        p_cost: v.manifest.estimated_cost_usd,
        p_consent: b.consent_version,
      }) as string,
    wake: (run) => {
      EdgeRuntime.waitUntil(
        loadEvidence40(ctx.admin).then((m) =>
          processEvidence40Batch(evidence40Port(ctx.admin), m, run, key, fetch)
        ).catch(() => console.error("EVIDENCE40_WORKER_STOPPED_NO_RETRY")),
      );
    },
  };
}));
