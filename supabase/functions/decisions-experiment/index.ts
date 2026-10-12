import { assertMembership, requireUser } from "../_shared/auth.ts";
import {
  decisionsHandler,
  type DecisionsView,
} from "../_shared/decisions-api.ts";
Deno.serve(decisionsHandler(async (r) => {
  const ctx = await requireUser(r);
  const { data: s, error: se } = await ctx.admin.from(
    "analysis_jev_compact_sets",
  ).select("organization_id").eq("id", "e544eea5-1c9d-4b68-909e-38b68061e85f")
    .single();
  if (se || !s) throw new Error("FORBIDDEN");
  await assertMembership(ctx.client, ctx.user.id, s.organization_id, [
    "owner",
    "admin",
    "manager",
  ]);
  const { data: record, error } = await ctx.admin.from(
    "analysis_decisions_experiments",
  ).select("id,body,result_sha256,created_at").eq(
    "organization_id",
    s.organization_id,
  ).eq("source_set_id", "e544eea5-1c9d-4b68-909e-38b68061e85f").eq(
    "version",
    "openai-decisions-exploratory-v1",
  ).maybeSingle();
  if (error) throw new Error("DECISIONS_READ_FAILED");
  return {
    record,
    paid_enabled: false,
    production_enabled: false,
    new_paid_calls: 0,
  } as DecisionsView;
}));
