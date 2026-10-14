// deno-lint-ignore no-import-prefix
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { json } from "../_shared/cors.ts";
import { loadPrioritizedExecution, prioritizedExecutionPort } from "../_shared/jls-prioritized-store.ts";
import { processPrioritizedSol } from "../_shared/jls-prioritized-worker.ts";
declare const EdgeRuntime:{waitUntil(p:Promise<unknown>):void};
Deno.serve(async r=>{
  if(r.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
  const {data:ok,error}=await admin.rpc("verify_review_scheduler_token",{p_token:r.headers.get("x-home-reviews-scheduler")??""});
  if(error||ok!==true)return json({error:"UNAUTHORIZED"},401);
  const {data:runs,error:re}=await admin.from("analysis_jls_prioritized_runs").select("id").in("status",["queued","running"]);
  if(re)return json({error:"JLS_PRI_READ_FAILED"},409);
  // No GO means no run. Do not load a provider credential or construct an attempt.
  if(!runs?.length)return json({claimed:0,new_paid_calls:0});
  const port=prioritizedExecutionPort(admin),work=(async()=>{
    for(const run of runs){try{
      const source=await loadPrioritizedExecution(admin);
      await processPrioritizedSol(port,source,run.id,Deno.env.get("OPENAI_API_KEY")??"",fetch);
    }catch(e){await port.abort(run.id,e instanceof Error&&/^[A-Z_0-9]+$/.test(e.message)?e.message:"JLS_PRI_WORKER_FAILED_NO_RETRY");}}
  })().catch(()=>{/* Consumed attempts stay consumed, including failed persistence. */});
  EdgeRuntime.waitUntil(work);return json({accepted_background:true,run_ids:runs.map(r=>r.id)},202);
});
