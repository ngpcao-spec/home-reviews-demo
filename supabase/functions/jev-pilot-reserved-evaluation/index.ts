// Published report only: this endpoint cannot execute or rerun the verifier.
import { assertMembership, requireUser } from "../_shared/auth.ts";
import { json, preflight } from "../_shared/cors.ts";
import { negativeHash } from "../_shared/negative-validation-core.ts";
import { canonicalJson } from "../_shared/jev-exploratory-core.ts";
Deno.serve(async (request) => {
  const p = preflight(request);
  if (p) return p;
  try {
    if (request.method !== "GET") {
      return json({ error: "RESERVED_EVALUATION_READ_ONLY" }, 405);
    }
    const ctx = await requireUser(request),
      control = "3988aa10-0c5c-4a52-b1ff-1b576b488c52";
    const { data: c, error: ce } = await ctx.admin.from(
      "analysis_jev_pilot_evidence_v3_controls",
    ).select("organization_id").eq("id", control).single();
    if (ce || !c) throw new Error("FORBIDDEN");
    await assertMembership(ctx.client, ctx.user.id, c.organization_id, [
      "owner",
      "admin",
      "manager",
    ]);
    const { data: r, error } = await ctx.admin.from(
      "analysis_jev_pilot_evidence_v3_reserved_evaluations",
    ).select("id,result,result_sha256,created_at").eq("control_id", control).eq(
      "organization_id",
      c.organization_id,
    ).eq("engine_commit", "91e76d8a4c130ce3b3565cbbc74771e286b0df48").eq(
      "reference_commit",
      "b64f571d36ca389cdf459b1311c35938848ce1f7",
    ).maybeSingle();
    if (error) throw new Error("RESERVED_EVALUATION_READ_FAILED");
    if (r && await negativeHash(canonicalJson(r.result)) !== r.result_sha256) {
      throw new Error("RESERVED_EVALUATION_HASH_CHANGED");
    }
    return json({
      record: r,
      ready: !!r,
      read_only: true,
      new_paid_calls: 0,
      production_enabled: false,
    });
  } catch (e) {
    const error = e instanceof Error && /^[A-Z0-9_]+$/.test(e.message)
      ? e.message
      : "RESERVED_EVALUATION_READ_FAILED";
    return json(
      { error },
      error === "UNAUTHORIZED" ? 401 : error === "FORBIDDEN" ? 403 : 409,
    );
  }
});
