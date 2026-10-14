import { JLS_REVALIDATION_ACTION, verifyJlsRevalidation } from "../_shared/jev-luna-sol-revalidation.ts";
import { requireUser, assertMembership } from "../_shared/auth.ts";
import { jlsHandler, type JlsView } from "../_shared/jev-luna-sol-api.ts";
import { verifyJlsPlan, JLS_VERSION } from "../_shared/jev-luna-sol.ts";
import {JLS_PILOT_PLAN,executionCosts, type JlsExecutionTask} from "../_shared/jev-luna-sol-delegation.ts";
import {hybridHash} from "../_shared/jev-hybrid-evidence.ts";
import { buildPrioritizedDraft, verifyPrioritizedDraft, JLS_PRIORITIZED_ACTION } from "../_shared/jev-luna-sol-prioritized.ts";
import { prioritizedExecutionProtocol, type PrioritizedHistory } from "../_shared/jls-prioritized-execution.ts";
import { validatePrioritizedReport } from "../_shared/jev-luna-sol-prioritized-validation.ts";
import { JLS_LEGACY_VALIDATOR } from "../_shared/jls-fee-disclosure.ts";
import { JLS_PRI_REVALIDATION_ACTION, verifyPrioritizedRevalidation } from "../_shared/jls-prioritized-revalidation.ts";
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
  const {data:target,error:te}=await ctx.client.from("analysis_jev_luna_sol_plans").select("id,body,result_sha256").eq("id",JLS_PILOT_PLAN).eq("organization_id",est.organization_id).eq("establishment_id",est.id).maybeSingle();
  if(te)throw new Error("JLS_READ_FAILED");
  let delegated:JlsView["delegated"];
  let prioritized:JlsView["prioritized"] = null;
  let prioritized_error:string|null=null;
  let prioritized_execution:JlsView["prioritized_execution"]=null;
  if(target){
    const [pr,rr]=await Promise.all([
      ctx.client.from("analysis_jev_luna_sol_protocols").select("body,sha256").eq("plan_id",target.id).maybeSingle(),
      ctx.client.from("analysis_jev_luna_sol_runs").select("id,status,consent_source,consent_sha256,expires_at,gate,error_code").eq("plan_id",target.id).maybeSingle()]);
    if(pr.error||rr.error)throw new Error("JLS_READ_FAILED");
    if(pr.data&&await hybridHash(pr.data.body)!==pr.data.sha256)throw new Error("JLS_PROTOCOL_CHANGED");
    const tasks=rr.data?await ctx.client.from("analysis_jev_luna_sol_tasks").select("id,run_id,organization_id,phase,review_id,request_sha256,status,request_count,parsed,input_tokens,output_tokens,cost_usd,duration_ms,served_model,error_code").eq("run_id",rr.data.id):{data:[],error:null};
    const dossier=rr.data?await ctx.client.from("analysis_jev_luna_sol_dossiers").select("body,sha256").eq("run_id",rr.data.id).maybeSingle():{data:null,error:null};
    const result=rr.data?await ctx.client.from("analysis_jev_luna_sol_results").select("body,result_sha256").eq("run_id",rr.data.id).maybeSingle():{data:null,error:null};
    if(tasks.error||dossier.error||result.error)throw new Error("JLS_READ_FAILED");
    if(dossier.data&&await hybridHash(dossier.data.body)!==dossier.data.sha256||result.data&&await hybridHash(result.data.body)!==result.data.result_sha256)throw new Error("JLS_RESULT_CHANGED");
    const revision=rr.data?await ctx.client.from("analysis_jev_luna_sol_events").select("payload")
      .eq("organization_id",est.organization_id).eq("plan_id",target.id).eq("action",JLS_REVALIDATION_ACTION)
      .eq("payload->body->>run_id",rr.data.id).order("id",{ascending:false}).limit(1).maybeSingle():{data:null,error:null};
    if(revision.error)throw new Error("JLS_READ_FAILED");
    if(revision.data&&(!rr.data||!result.data))throw new Error("JLS_REVALIDATION_CHANGED");
    const revalidation=revision.data?await verifyJlsRevalidation(revision.data.payload,rr.data!.id,result.data!):null;
    if(result.data&&rr.data){try{
      // Read-only new-format preparation. Never a run, authorization or provider call.
      const targetSource=target.body.source_plan_id===a.data.id?a:await ctx.client.from("analysis_jev_hybrid_plans")
        .select("id,body,result_sha256").eq("id",target.body.source_plan_id).eq("organization_id",est.organization_id).single();
      if(targetSource.error||!targetSource.data)throw new Error("JLS_SOURCE_CHANGED");
      await verifyJlsPlan(target.body,targetSource.data,b.data);
      const decisions=result.data.body.sol_result.luna_decisions;
      const saved=await ctx.client.from("analysis_jev_luna_sol_events").select("id,payload")
        .eq("organization_id",est.organization_id).eq("plan_id",target.id).eq("action",JLS_PRIORITIZED_ACTION)
        .eq("payload->body->>language",language).maybeSingle();
      if(saved.error)throw new Error("JLS_READ_FAILED");
      const body=saved.data?.payload.body;
      if(body&&(await hybridHash(body)!==saved.data!.payload.sha256||body.source_run_id!==rr.data.id||
        body.source_result_sha256!==result.data.result_sha256||body.source_plan_sha256!==target.result_sha256||body.organization_id!==est.organization_id))throw new Error("JLS_PRIORITIZED_PREPARATION_CHANGED");
      const draft=body?.draft??await buildPrioritizedDraft(target.body,decisions,language as "fr"|"vi");
      await verifyPrioritizedDraft(draft,target.body,decisions);
      prioritized={draft,artifact_id:saved.data?.id??null,source_run_id:rr.data.id};
      const qp=await ctx.client.from("analysis_jls_prioritized_protocols").select("id,body,sha256")
        .eq("source_plan_id",target.id).eq("organization_id",est.organization_id).maybeSingle();
      if(qp.error)throw new Error("JLS_PRI_PROTOCOL_UNAVAILABLE");
      if(qp.data){
        const histTasks=await ctx.client.from("analysis_jev_luna_sol_tasks").select("*").eq("run_id",rr.data.id).eq("organization_id",est.organization_id).eq("phase","luna");
        if(histTasks.error||!histTasks.data)throw new Error("JLS_PRI_SOURCE_UNAVAILABLE");
        const ep=await ctx.client.from("analysis_jev_luna_sol_events").select("id,payload").eq("id",qp.data.body.preparation_event_id).eq("organization_id",est.organization_id).single();
        if(ep.error||!ep.data)throw new Error("JLS_PRI_SOURCE_UNAVAILABLE");
        const rebuilt=await prioritizedExecutionProtocol({id:ep.data.id,...ep.data.payload},target.body,
          {run_id:rr.data.id,plan_id:target.id,organization_id:est.organization_id,result:result.data,tasks:histTasks.data} as PrioritizedHistory);
        if(await hybridHash(qp.data.body)!==qp.data.sha256||await hybridHash(rebuilt)!==qp.data.sha256)throw new Error("JLS_PRI_PROTOCOL_CHANGED");
        const qr=await ctx.client.from("analysis_jls_prioritized_runs").select("id,status,expires_at,consent_source,error_code").eq("protocol_id",qp.data.id).eq("organization_id",est.organization_id).maybeSingle();
        if(qr.error)throw new Error("JLS_PRI_READ_FAILED");
        const qt=qr.data?await ctx.client.from("analysis_jls_prioritized_tasks").select("status,request_count,error_code").eq("run_id",qr.data.id).eq("organization_id",est.organization_id).maybeSingle():{data:null,error:null};
        const qres=qr.data?await ctx.client.from("analysis_jls_prioritized_results").select("body,sha256").eq("run_id",qr.data.id).eq("organization_id",est.organization_id).maybeSingle():{data:null,error:null};
        if(qt.error||qres.error)throw new Error("JLS_PRI_READ_FAILED");
        if(qres.data){
          const v=qres.data.body;
          if(await hybridHash(v)!==qres.data.sha256||v.protocol_sha256!==qp.data.sha256||v.request_sha256!==qp.data.body.request_sha256)throw new Error("JLS_PRI_RESULT_CHANGED");
          if(v.validated_report){
            const messages=v.response?.output?.filter((x:{type:string})=>x.type==="message")??[];
            const texts=messages.flatMap((m:{content:{type:string;text:string}[]})=>m.content.filter(c=>c.type==="output_text").map(c=>c.text));
            if(texts.length!==1||await hybridHash(await validatePrioritizedReport(JSON.parse(texts[0]),target.body,b.data,decisions,"vi",v.controls.validator_version??JLS_LEGACY_VALIDATOR))!==await hybridHash(v.validated_report))throw new Error("JLS_PRI_RESULT_CHANGED");
            prioritized.result=v.validated_report;
          }
        }
        prioritized_execution={protocol:qp.data,run:qr.data,task:qt.data,result:qres.data};
        if(qr.data&&qres.data){
          const rev=await ctx.client.from("analysis_jls_prioritized_events").select("id,created_at,payload")
            .eq("run_id",qr.data.id).eq("organization_id",est.organization_id).eq("action",JLS_PRI_REVALIDATION_ACTION).maybeSingle();
          if(rev.error)throw new Error("JLS_PRI_READ_FAILED");
          if(rev.data){
            await verifyPrioritizedRevalidation(rev.data.payload,qr.data.id,qres.data,target.body,b.data,decisions);
            prioritized_execution.revalidation=rev.data;
            prioritized.result=rev.data.payload.body.validation;
          }
        }
      }
    }catch(e){
      // A failed new preparation is never used, but must not hide the separately
      // verified immutable historical report.
      prioritized_error=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:"JLS_PRIORITIZED_PREPARATION_CHANGED";
    }}
    delegated={revalidation,ready:!!pr.data,plan_id:target.id,protocol:pr.data,run:rr.data,tasks:tasks.data as JlsExecutionTask[],dossier:dossier.data,result:result.data,costs:executionCosts(tasks.data as JlsExecutionTask[])};
  }
  return { plan, delegated, prioritized, prioritized_error, prioritized_execution, runs: runs ?? [], paid_enabled: false, production_enabled: false, new_paid_calls: 0 } as JlsView;
}));
