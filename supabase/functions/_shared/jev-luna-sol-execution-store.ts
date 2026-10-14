// deno-lint-ignore no-import-prefix -- same pinned SDK as the authenticated V2 delegation.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import { assertEvidence40ActiveUser } from "./decisions-evidence40-auth.ts";
import { JLS_PILOT_PLAN, delegatedProtocol, type JlsExecutionTask } from "./jev-luna-sol-delegation.ts";
import { verifyJlsPlan } from "./jev-luna-sol.ts";
import { hybridHash } from "./jev-hybrid-evidence.ts";
import type { JlsExecutionPort } from "./jev-luna-sol-executor.ts";
export async function loadJlsExecution(admin:SupabaseClient) {
  const {data:p,error}=await admin.from("analysis_jev_luna_sol_plans").select("*").eq("id",JLS_PILOT_PLAN).single();
  if(error||!p)throw new Error("JLS_PLAN_UNAVAILABLE");
  await jlsExecRpc(admin,"jls_delegated_scope_check",{p_plan:p.id,p_verify_cache:true});
  const [a,b]=await Promise.all([
    admin.from("analysis_jev_hybrid_plans").select("id,body,result_sha256").eq("id",p.source_plan_id).eq("organization_id",p.organization_id).single(),
    admin.from("analysis_jev_pilot_snapshots").select("*").eq("id",p.source_snapshot_id).eq("organization_id",p.organization_id).single()]);
  if(a.error||b.error||!a.data||!b.data)throw new Error("JLS_SOURCE_UNAVAILABLE");
  await verifyJlsPlan(p.body,a.data,b.data);
  const protocol=await delegatedProtocol(p.id,p.body,p.result_sha256);
  const {data:q,error:qe}=await admin.from("analysis_jev_luna_sol_protocols").select("body,sha256").eq("plan_id",p.id).single();
  if(qe||!q||await hybridHash(protocol)!==q.sha256||await hybridHash(q.body)!==q.sha256)throw new Error("JLS_PROTOCOL_CHANGED");
  return {plan:p.body,snapshot:b.data,protocol:q};
}
export async function jlsExecRpc(admin:SupabaseClient,name:string,args:Record<string,unknown>) {
  const {data,error}=await admin.rpc(name,args);if(error)throw new Error("JLS_EXECUTION_DATABASE_FAILED");return data;
}
export function jlsExecutionPort(admin:SupabaseClient):JlsExecutionPort {
  return {
    claim:async(run,phase,worker)=>{
      const {data:r,error}=await admin.from("analysis_jev_luna_sol_runs").select("organization_authority_user_id,plan_id,status").eq("id",run).single();
      if(error||!r||r.plan_id!==JLS_PILOT_PLAN)throw new Error("FORBIDDEN");
      if(!["queued","running"].includes(r.status))return null;
      try{await assertEvidence40ActiveUser(admin,r.organization_authority_user_id);}catch{
        await jlsExecRpc(admin,"jls_stop_delegated",{p_run:run,p_status:"authorization_expired",p_error:"JLS_AUTHORIZATION_UNAVAILABLE"});return null;}
      return await jlsExecRpc(admin,"claim_jls_task",{p_run:run,p_phase:phase,p_worker:worker}) as JlsExecutionTask|null;
    },
    finish:async(task,worker,status,output)=>{if(await jlsExecRpc(admin,"jls_finish_delegated",{p_task:task,p_worker:worker,p_status:status,p_output:output})!==true)throw new Error("JLS_RESULT_SAVE_UNCERTAIN_NO_RETRY");},
    tasks:async run=>{const {data,error}=await admin.from("analysis_jev_luna_sol_tasks").select("*").eq("run_id",run).order("task_key");if(error)throw new Error("JLS_TASKS_UNAVAILABLE");return data as JlsExecutionTask[];},
    stop:async(run,status,error)=>{await jlsExecRpc(admin,"jls_stop_delegated",{p_run:run,p_status:status,p_error:error});},
    freezeSol:async(run,dossier)=>await jlsExecRpc(admin,"jls_freeze_sol",{p_run:run,p_body:dossier,p_sha:await hybridHash(dossier)})===true,
    complete:async(run,result,sha,status)=>{await jlsExecRpc(admin,"jls_complete_delegated",{p_run:run,p_body:result,p_sha:sha,p_status:status});},
  };
}
