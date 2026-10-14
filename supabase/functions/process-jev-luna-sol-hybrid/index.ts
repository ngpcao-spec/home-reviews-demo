// deno-lint-ignore no-import-prefix -- reuse V2's server SDK and scheduler authentication.
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {json} from "../_shared/cors.ts";
import {loadJlsExecution,jlsExecutionPort} from "../_shared/jev-luna-sol-execution-store.ts";
import {processDelegatedJls} from "../_shared/jev-luna-sol-executor.ts";
import {JLS_PILOT_PLAN} from "../_shared/jev-luna-sol-delegation.ts";
declare const EdgeRuntime:{waitUntil(p:Promise<unknown>):void};
Deno.serve(async r=>{
  if(r.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
  const {data:allowed,error}=await admin.rpc("verify_review_scheduler_token",{p_token:r.headers.get("x-home-reviews-scheduler")??""});
  if(error||allowed!==true)return json({error:"UNAUTHORIZED"},401);
  const {data:runs,error:re}=await admin.from("analysis_jev_luna_sol_runs").select("id").eq("plan_id",JLS_PILOT_PLAN).in("status",["queued","running"]);
  if(re)return json({error:"JLS_READ_FAILED"},409);
  if(!runs?.length)return json({claimed:0,new_paid_calls:0});
  const work=(async()=>{
    const source=await loadJlsExecution(admin);
    for(const run of runs)await processDelegatedJls(jlsExecutionPort(admin),source.plan,source.snapshot,run.id,Deno.env.get("OPENAI_API_KEY")??"",fetch);
  })().catch(()=>{/* Durable reservation remains consumed; next wake only observes or claims UNSENT tasks. */});
  EdgeRuntime.waitUntil(work);return json({accepted_background:true,run_ids:runs.map(r=>r.id)},202);
});
