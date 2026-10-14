// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from "npm:@supabase/supabase-js@2.117.2";
import {assertEvidence40ActiveUser} from "./decisions-evidence40-auth.ts";
import type {RestaurantPort,RestaurantState} from "./jls-restaurant-worker.ts";
export function restaurantPort(admin:SupabaseClient):RestaurantPort {
 const rpc=async(name:string,args:Record<string,unknown>)=>{const r=await admin.rpc(name,args);if(r.error)throw Error("JLS_DATABASE_FAILED");return r.data;};
 const load=async(id:string):Promise<RestaurantState>=>{
  const rr=await admin.from("analysis_jls_restaurant_runs").select("*").eq("id",id).single();if(rr.error)throw Error("FORBIDDEN");
  const [p,t,a]=await Promise.all([
   admin.from("analysis_jls_restaurant_protocols").select("id,body,sha256").eq("id",rr.data.protocol_id).eq("organization_id",rr.data.organization_id).single(),
   admin.from("analysis_jls_restaurant_tasks").select("*").eq("run_id",id).eq("organization_id",rr.data.organization_id),
   admin.from("analysis_jls_restaurant_artifacts").select("kind,body,sha256").eq("run_id",id).eq("organization_id",rr.data.organization_id)]);
  if(p.error||t.error||a.error)throw Error("JLS_SOURCE_UNAVAILABLE");
  return {protocol:p.data,run:rr.data,tasks:t.data,artifacts:a.data};
 };
 return {load,tick:async(id,worker)=>{
  const s=await load(id);if(!["queued","running"].includes(s.run.status))return false;
  await assertEvidence40ActiveUser(admin,s.protocol.body.authority_user_id);
  return await rpc("claim_jls_restaurant_tick",{p_run:id,p_worker:worker})===true;
 },cache:async p=>{
  const r=await admin.from("analysis_jev_review_cache").select("*").eq("organization_id",p.organization_id)
   .eq("establishment_id",p.establishment_id).eq("configuration_id","v12_economy_1pass_v1").in("review_id",p.english_review_ids);
  if(r.error)throw Error("JLS_CACHE_READ_FAILED");return r.data;
 },claim:async(id,worker)=>await rpc("claim_jls_restaurant_task",{p_run:id,p_worker:worker}),
 artifact:async(id,worker,kind,body,sha)=>await rpc("save_jls_restaurant_artifact",{p_run:id,p_worker:worker,p_kind:kind,p_body:body,p_sha:sha})===true,
 finish:async(id,worker,status,body,sha)=>await rpc("finish_jls_restaurant_task",{p_task:id,p_worker:worker,p_status:status,p_body:body,p_sha:sha})===true,
 stage:async(id,worker,stage,tasks)=>await rpc("stage_jls_restaurant",{p_run:id,p_worker:worker,p_stage:stage,p_tasks:tasks})===true,
 release:async(id,worker,error)=>{await rpc("release_jls_restaurant_tick",{p_run:id,p_worker:worker,p_error:error});}};
}
