import { requireUser, assertMembership } from "../_shared/auth.ts";
import { jlsHandler, type JlsView } from "../_shared/jev-luna-sol-api.ts";
import { verifyJlsPlan, JLS_VERSION } from "../_shared/jev-luna-sol.ts";
Deno.serve(jlsHandler(async request => {
  const ctx = await requireUser(request), query = new URL(request.url).searchParams;
  const establishment = query.get("establishment_id"), language = query.get("language") ?? "vi";
  if (!establishment || !/^[a-f0-9-]{36}$/.test(establishment) || !["fr", "vi"].includes(language)) throw new Error("JLS_SCOPE_INVALID");
  // Resolve the requested establishment through the authenticated RLS client first.
  // No dependency on a Shabu/Artisan experiment from another account or organisation.
  const { data: est, error: ee } = await ctx.client.from("establishments").select("id,organization_id").eq("id", establishment).single();
  if (ee || !est) throw new Error("FORBIDDEN");
  await assertMembership(ctx.client, ctx.user.id, est.organization_id, ["owner", "admin", "manager"]);
  const { data: plan, error } = await ctx.client.from("analysis_jev_luna_sol_plans")
    .select("id,body,result_sha256,created_at,source_plan_id,source_snapshot_id")
    .eq("organization_id", est.organization_id).eq("establishment_id", establishment)
    .eq("version", JLS_VERSION).eq("language", language).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("JLS_READ_FAILED");
  if (!plan) return { plan: null, runs: [], paid_enabled: false, production_enabled: false, new_paid_calls: 0 };
  const [a, b] = await Promise.all([
    ctx.client.from("analysis_jev_hybrid_plans").select("id,body,result_sha256").eq("id", plan.source_plan_id).eq("organization_id", est.organization_id).single(),
    ctx.client.from("analysis_jev_pilot_snapshots").select("*").eq("id", plan.source_snapshot_id).eq("organization_id", est.organization_id).single(),
  ]);
  if (a.error || b.error || !a.data || !b.data) throw new Error("JLS_SOURCE_CHANGED");
  await verifyJlsPlan(plan.body, a.data, b.data);
  const { data: runs, error: re } = await ctx.client.from("analysis_jev_luna_sol_runs").select("id,status").eq("organization_id", est.organization_id).eq("plan_id", plan.id);
  if (re) throw new Error("JLS_READ_FAILED");
  return { plan, runs: runs ?? [], paid_enabled: false, production_enabled: false, new_paid_calls: 0 } as JlsView;
}));
