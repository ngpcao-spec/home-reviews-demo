import {restaurantCpuProbe} from "../_shared/jls-restaurant-cpu-probe.ts";
import {solReadyProbe} from "../_shared/jls-sol-ready-probe.ts";
import {solReadyPort} from "../_shared/jls-sol-ready-store.ts";
import {processReadySol} from "../_shared/jls-sol-ready-worker.ts";
import {contractV2Port} from "../_shared/jls-contract-v2-store.ts";
import {processContractV2} from "../_shared/jls-contract-v2-worker.ts";
import {contractV2Probe} from "../_shared/jls-contract-v2-probe.ts";
// deno-lint-ignore no-import-prefix
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {json} from "../_shared/cors.ts";
import {restaurantPort} from "../_shared/jls-restaurant-store.ts";
import {processRestaurant} from "../_shared/jls-restaurant-worker.ts";
declare const EdgeRuntime:{waitUntil(p:Promise<unknown>):void};
Deno.serve(async r=>{
 if(r.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);
 const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
 const auth=await admin.rpc("verify_review_scheduler_token",{p_token:r.headers.get("x-home-reviews-scheduler")??""});
 if(auth.error||auth.data!==true)return json({error:"UNAUTHORIZED"},401);
 const payload=await r.clone().json().catch(()=>null);
 if(payload?.mode==="sol_ready_probe"){
  EdgeRuntime.waitUntil(solReadyProbe(admin,payload.operation_id,payload.variant??"normal").catch(e=>console.error("JLS_READY_PROBE_FAILED",e instanceof Error?e.message:"UNKNOWN")));
  return json({accepted_free_probe:true,provider_calls:0},202);
 }
 if(payload?.mode==="cpu_probe"){
  // This route never loads provider keys, claims a task or authorizes a run.
  EdgeRuntime.waitUntil(restaurantCpuProbe(admin,payload).catch(e=>{console.error("JLS_CPU_PROBE_FAILED",e instanceof Error?e.message:"UNKNOWN");}));
  return json({accepted_free_probe:true,provider_calls:0,nonce:payload.nonce},202);
 }
 if(payload?.mode==="contract_v2_operation"){
  const op=await admin.from("analysis_jls_contract_v2_operations").select("mode").eq("id",payload.operation_id).single();
  if(op.error)return json({error:"FORBIDDEN"},403);
  // Mock branch exits before loading any provider secret or native transport.
  EdgeRuntime.waitUntil((op.data.mode==="mock"?contractV2Probe(admin,payload.operation_id):
   processContractV2(contractV2Port(admin),payload.operation_id,Deno.env.get("OPENAI_API_KEY")??"",fetch))
   .catch(e=>console.error("JLS_CONTRACT_V2_FAILED",e instanceof Error?e.message:"UNKNOWN")));
  return json({accepted_background:true,technical_mock:op.data.mode==="mock"},202);
 }
 const {data:runs,error}=await admin.from("analysis_jls_restaurant_runs").select("id").in("status",["queued","running"]);
 if(error)return json({error:"JLS_DATABASE_FAILED"},409);
 const next=await admin.from("analysis_jls_contract_v2_operations").select("id").eq("mode","paid").in("status",["queued","received","dispatched","validating"]).limit(1);
 if(next.error)return json({error:"JLS_DATABASE_FAILED"},409);
 if(!runs?.length&&!next.data?.length)return json({claimed:0,new_paid_calls:0});
 const work=(async()=>{
  for(const op of next.data??[])await processContractV2(contractV2Port(admin),op.id,Deno.env.get("OPENAI_API_KEY")??"",fetch);
  for(const run of runs??[])try{
  const ready=await admin.from("analysis_jls_sol_ready_operations").select("id").eq("run_id",run.id).eq("mode","paid").maybeSingle();
  if(ready.error)continue;
  if(ready.data){await processReadySol(solReadyPort(admin),ready.data.id,Deno.env.get("OPENAI_API_KEY")??"",fetch);continue;}
  await processRestaurant(restaurantPort(admin),run.id,{jev:Deno.env.get("TYPESAFE_API_KEY")??"",openai:Deno.env.get("OPENAI_API_KEY")??""},fetch);
 }catch{/* Claimed attempts are never reset or retried. */}})();
 EdgeRuntime.waitUntil(work);return json({accepted_background:true},202);
});
