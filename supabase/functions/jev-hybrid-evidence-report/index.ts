import { assertMembership, requireUser } from "../_shared/auth.ts";
import { hybridHandler, type HybridView } from "../_shared/jev-hybrid-api.ts";
Deno.serve(hybridHandler(async (request) => {
  const ctx = await requireUser(request),
    language = new URL(request.url).searchParams.get("language") ?? "vi";
  if (!["fr", "vi"].includes(language)) {
    throw new Error("HYBRID_LANGUAGE_INVALID");
  }
  const { data: s, error } = await ctx.admin.from(
    "analysis_jev_pilot_snapshots",
  ).select("organization_id").eq("id", "f9c8876b-1b5a-4d10-9538-758881b61b6b")
    .single();
  if (error || !s) throw new Error("FORBIDDEN");
  await assertMembership(ctx.client, ctx.user.id, s.organization_id, [
    "owner",
    "admin",
    "manager",
  ]);
  return {
    read: async () => {
      const { data: p, error: pe } = await ctx.admin.from(
          "analysis_jev_hybrid_plans",
        ).select("*").eq("organization_id", s.organization_id).eq(
          "language",
          language,
        ).eq("version", "jev-hybrid-evidence-report-v1").order("created_at", {
          ascending: false,
        }).limit(1).maybeSingle(),
        { data: c, error: ce } = await ctx.admin.from(
          "analysis_jev_hybrid_controls",
        ).select("id,body,result_sha256").eq(
          "organization_id",
          s.organization_id,
        ).eq("version", "jev-hybrid-independent-control-v1").maybeSingle();
      if (pe || ce) throw new Error("HYBRID_READ_FAILED");
      let jobs: unknown[] = [];
      if (p) {
        const { data: j, error: je } = await ctx.admin.from(
          "analysis_jev_hybrid_jobs",
        ).select(
          "id,status,request_count,served_model,input_tokens,output_tokens,cost_usd,created_at,completed_at,error_code",
        ).eq("organization_id", s.organization_id).eq("plan_id", p.id).order(
          "created_at",
          { ascending: false },
        ).limit(10);
        if (je) throw new Error("HYBRID_READ_FAILED");
        jobs = j;
      }
      return {
        plan: p,
        control: c,
        jobs,
        paid_enabled: false,
        can_generate: false,
        production_enabled: false,
        new_paid_calls: 0,
      } as HybridView;
    },
  };
}));
