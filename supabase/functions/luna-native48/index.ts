import { assertMembership, requireUser } from "../_shared/auth.ts";
import { assertEvidence40ActiveUser } from "../_shared/decisions-evidence40-auth.ts";
import { native48Handler } from "../_shared/luna-native48-api.ts";
import { native48Rpc, native48View } from "../_shared/luna-native48-store.ts";
import { NATIVE48_ORG } from "../_shared/luna-native48.ts";
Deno.serve(native48Handler(async (r) => {
  const ctx = await requireUser(r);
  return {
    authorize: async () => {
      await assertMembership(ctx.client, ctx.user.id, NATIVE48_ORG, [
        "owner",
        "admin",
        "manager",
      ]);
      await assertEvidence40ActiveUser(ctx.admin, ctx.user.id);
    },
    view: () =>
      native48View(ctx.admin, !!Deno.env.get("OPENAI_API_KEY")?.trim()),
    prepare: async (v) =>
      await native48Rpc(ctx.admin, "native48_save_plan", {
        p_actor: "app_user",
        p_user: ctx.user.id,
        p_manifest: v.manifest,
        p_sha: v.manifest_sha256,
      }) as string,
  };
}));
