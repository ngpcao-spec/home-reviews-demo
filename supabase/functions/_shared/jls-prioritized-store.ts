// deno-lint-ignore no-import-prefix
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import { assertEvidence40ActiveUser } from "./decisions-evidence40-auth.ts";
import { loadJlsExecution, jlsExecRpc } from "./jev-luna-sol-execution-store.ts";
import { JLS_PILOT_PLAN } from "./jev-luna-sol-delegation.ts";
import { hybridHash } from "./jev-hybrid-evidence.ts";
import { prioritizedExecutionProtocol, JLS_PRI_SOURCE_RUN, type PrioritizedPreparation, type PrioritizedHistory } from "./jls-prioritized-execution.ts";
import type { PrioritizedExecutionSource, PrioritizedExecutionPort, PrioritizedTask } from "./jls-prioritized-worker.ts";
export async function loadPrioritizedExecution(admin:SupabaseClient):Promise<PrioritizedExecutionSource> {
  // Existing cache/source/organization checks, not the old spending consent.
  const source=await loadJlsExecution(admin),org=source.plan.organization_id;
  const [er,rr,tr,pr]=await Promise.all([
    admin.from("analysis_jev_luna_sol_events").select("id,payload").eq("id",232).eq("organization_id",org).eq("plan_id",JLS_PILOT_PLAN).single(),
    admin.from("analysis_jev_luna_sol_results").select("body,result_sha256").eq("run_id",JLS_PRI_SOURCE_RUN).eq("organization_id",org).single(),
    admin.from("analysis_jev_luna_sol_tasks").select("*").eq("run_id",JLS_PRI_SOURCE_RUN).eq("organization_id",org).eq("phase","luna").order("review_id"),
    admin.from("analysis_jls_prioritized_protocols").select("id,body,sha256").eq("source_plan_id",JLS_PILOT_PLAN).eq("organization_id",org).single(),
  ]);
  if(er.error||rr.error||tr.error||pr.error||!er.data||!rr.data||!tr.data||!pr.data)throw new Error("JLS_PRI_SOURCE_UNAVAILABLE");
  const preparation:PrioritizedPreparation={id:er.data.id,...er.data.payload},history:PrioritizedHistory={run_id:JLS_PRI_SOURCE_RUN,plan_id:JLS_PILOT_PLAN,
    organization_id:org,result:rr.data,tasks:tr.data};
  const rebuilt=await prioritizedExecutionProtocol(preparation,source.plan,history);
  if(await hybridHash(pr.data.body)!==pr.data.sha256||await hybridHash(rebuilt)!==pr.data.sha256)throw new Error("JLS_PRI_PROTOCOL_CHANGED");
  return {plan:source.plan,snapshot:source.snapshot,preparation,protocol:pr.data,decisions:history.result.body.luna_decisions};
}
export function prioritizedExecutionPort(admin:SupabaseClient):PrioritizedExecutionPort {
  return {
    claim:async(run,worker)=>{
      const {data:r,error}=await admin.from("analysis_jls_prioritized_runs").select("organization_authority_user_id,status,protocol_id").eq("id",run).single();
      if(error||!r)throw new Error("FORBIDDEN");
      if(!["queued","running"].includes(r.status))return null;
      try{await assertEvidence40ActiveUser(admin,r.organization_authority_user_id);}catch{
        await jlsExecRpc(admin,"jls_pri_abort",{p_run:run,p_error:"JLS_PRI_AUTHORIZATION_UNAVAILABLE"});return null;
      }
      return await jlsExecRpc(admin,"claim_jls_pri_task",{p_run:run,p_worker:worker}) as PrioritizedTask|null;
    },
    finish:async(task,worker,status,body,sha)=>await jlsExecRpc(admin,"finish_jls_pri_task",{p_task:task,p_worker:worker,p_status:status,p_body:body,p_sha:sha})===true,
    abort:async(run,error)=>{await jlsExecRpc(admin,"jls_pri_abort",{p_run:run,p_error:error});},
  };
}
