import { assertMembership, requireUser } from "../_shared/auth.ts";
import { assertEvidence40ActiveUser } from "../_shared/decisions-evidence40-auth.ts";
import {
  negativeHandler,
  type NegativeView,
} from "../_shared/luna-negative-v2-api.ts";
import {
  blindNegativeExport,
  NEG_ORG,
  NEG_VERSION,
  type NegReferenceInput,
  prepareNegativeSet,
  verifyNegativeReferences,
  verifyNegativeSet,
} from "../_shared/luna-negative-v2.ts";
import { decisionsHash } from "../_shared/decisions-config.ts";
import {
  loadNegativeLaunch,
  negativeLaunchRpc,
  negativeLaunchView,
  negativePort,
} from "../_shared/luna-negative-v2-store.ts";
import { processNegativeBatch } from "../_shared/luna-negative-v2-worker.ts";
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
Deno.serve(negativeHandler(async (request) => {
  const ctx = await requireUser(request);
  await assertMembership(ctx.client, ctx.user.id, NEG_ORG, [
    "owner",
    "admin",
    "manager",
  ]);
  await assertEvidence40ActiveUser(ctx.admin, ctx.user.id);
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await ctx.admin.rpc(name, args);
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
  async function read(): Promise<NegativeView> {
    const { data: record, error } = await ctx.admin.from(
      "analysis_luna_negative_v2_sets",
    ).select("id,body,body_sha256,sealed_at").eq("organization_id", NEG_ORG).eq(
      "version",
      NEG_VERSION,
    ).maybeSingle();
    if (error) throw new Error("NEGATIVE_V2_READ_FAILED");
    if (record) await verifyNegativeSet(record.body, record.body_sha256);
    const { data: seal, error: se } = record
      ? await ctx.admin.from("analysis_luna_negative_v2_reference_seals")
        .select("id,body,reference_sha256,sealed_at").eq(
          "organization_id",
          NEG_ORG,
        ).eq("set_id", record.id).maybeSingle()
      : { data: null, error: null };
    if (se) throw new Error("NEGATIVE_V2_READ_FAILED");
    if (
      seal &&
      await verifyNegativeReferences(
          record!.body,
          record!.body_sha256,
          seal.body,
        ) !== seal.reference_sha256
    ) throw new Error("NEGATIVE_V2_REFERENCE_CHANGED");
    return {
      record,
      reference_seal: seal,
      blind_export: record ? blindNegativeExport(record.body) : null,
      paid_enabled: false,
      new_paid_calls: 0,
      launch: record && seal
        ? await negativeLaunchView(
          ctx.admin,
          !!Deno.env.get("OPENAI_API_KEY")?.trim(),
        )
        : undefined,
    };
  }
  return {
    read,
    prepareLaunch: async (v) => {
      if (!v.launch || !v.reference_seal) {
        throw new Error("NEGATIVE_V2_REFERENCE_REQUIRED");
      }
      await negativeLaunchRpc(ctx.admin, "luna_nv2_save_plan", {
        p_user: ctx.user.id,
        p_manifest: v.launch.manifest,
        p_sha: v.launch.manifest_sha256,
      });
      return read();
    },
    confirmLaunch: async (v, b) =>
      await negativeLaunchRpc(ctx.admin, "luna_nv2_confirm", {
        p_user: ctx.user.id,
        p_plan: v.launch!.plan_id,
        p_sha: b.manifest_sha256,
        p_cost: b.estimated_cost_usd,
        p_consent: b.consent_version,
      }) as string,
    wake: (run) => {
      EdgeRuntime.waitUntil(
        (async () => {
          const source = await loadNegativeLaunch(ctx.admin);
          await processNegativeBatch(
            negativePort(ctx.admin),
            source,
            run,
            Deno.env.get("OPENAI_API_KEY") ?? "",
            fetch,
          );
        })().catch(() => {
          console.error("NEGATIVE_V2_DISPATCH_STOPPED_NO_RETRY");
        }),
      );
    },
    freeze: async () => {
      const old = await read();
      if (old.record) return old;
      const inventory = await rpc("luna_negative_v2_inventory", {
          p_user: ctx.user.id,
        }),
        body = await prepareNegativeSet(inventory, new Date().toISOString()),
        sha = await decisionsHash(body);
      await verifyNegativeSet(body, sha);
      try {
        await rpc("save_luna_negative_v2_set", {
          p_user: ctx.user.id,
          p_body: body,
          p_sha: sha,
        });
      } catch (e) {
        // A simultaneous free preparation may have sealed first with its own timestamp.
        // Return that immutable winner; never overwrite or create a second set.
        if (
          !(e instanceof Error) || e.message !== "NEGATIVE_V2_SET_IMMUTABLE"
        ) throw e;
      }
      return read();
    },
    seal: async (input: NegReferenceInput) => {
      const v = await read();
      if (!v.record) throw new Error("NEGATIVE_V2_SET_REQUIRED");
      const sha = await verifyNegativeReferences(
        v.record.body,
        v.record.body_sha256,
        input,
      );
      await rpc("seal_luna_negative_v2_references", {
        p_user: ctx.user.id,
        p_set: v.record.id,
        p_body: input,
        p_sha: sha,
      });
      return read();
    },
  };
}));
