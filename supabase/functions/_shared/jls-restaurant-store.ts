// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from "npm:@supabase/supabase-js@2.117.2";
import {assertEvidence40ActiveUser} from "./decisions-evidence40-auth.ts";
import type {RestaurantPort,RestaurantState} from "./jls-restaurant-worker.ts";
import {taskReceiptWire} from './jls-task-persistence.ts';
export function restaurantPort(admin:SupabaseClient):RestaurantPort {
 const rpc=async(name:string,args:Record<string,unknown>)=>{const r=await admin.rpc(name,args);if(r.error)throw Error(
  ['save_jls_restaurant_receipt','finish_jls_restaurant_receipt','flush_jls_restaurant_receipts'].includes(name)?
   'JLS_PERSISTENCE_RPC_'+name.toUpperCase()+'_'+(r.error.code??'UNKNOWN'):'JLS_DATABASE_FAILED');return r.data;};
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
  const r=await admin.from("analysis_jls_restaurant_runs").select("status,protocol_id,organization_id").eq("id",id).single();
  if(r.error)throw Error("FORBIDDEN");if(!["queued","running"].includes(r.data.status))return false;
  const p=await admin.from("analysis_jls_restaurant_protocols").select("authority_user_id").eq("id",r.data.protocol_id).eq("organization_id",r.data.organization_id).single();
  if(p.error)throw Error("FORBIDDEN");await assertEvidence40ActiveUser(admin,p.data.authority_user_id);
  // Save-only recovery precedes the old running-task/expired-lease guard. It
  // cannot reserve or send a provider request, and never reopens a terminal run.
  const flushed=await rpc('flush_jls_restaurant_receipts',{p_run:id});
  if(flushed?.requires_explicit_continuation)return false;
  return await rpc("claim_jls_restaurant_tick",{p_run:id,p_worker:worker})===true;
 },prepared:async p=>{const r=await admin.from("analysis_jls_restaurant_prepared_artifacts").select("body,sha256").eq("sha256",p.prepared!.artifact_sha256).eq("organization_id",p.organization_id).single();if(r.error)throw Error("JLS_PREPARED_ARTIFACT_MISSING");return r.data;},
 cacheCompatible:async id=>await rpc("check_jls_restaurant_prepared_cache",{p_protocol:id})===true,
 cache:async p=>{
  const r=await admin.from("analysis_jev_review_cache").select("*").eq("organization_id",p.organization_id)
   .eq("establishment_id",p.establishment_id).eq("configuration_id","v12_economy_1pass_v1").in("review_id",p.english_review_ids);
  if(r.error)throw Error("JLS_CACHE_READ_FAILED");return r.data;
 },claim:async(id,worker)=>await rpc("claim_jls_restaurant_task",{p_run:id,p_worker:worker}),
 beginProvider:async t=>await rpc('begin_jls_restaurant_dispatch',{p_task:t.id,p_worker:t.worker,p_request_sha:t.request_sha256})===true,
 artifact:async(id,worker,kind,body,sha)=>await rpc("save_jls_restaurant_artifact",{p_run:id,p_worker:worker,p_kind:kind,p_body:body,p_sha:sha})===true,
 finish:async(id,worker,status,body,sha)=>await rpc("finish_jls_restaurant_task",{p_task:id,p_worker:worker,p_status:status,p_body:body,p_sha:sha})===true,
 retainReceipt:async(state,task,outcome)=>{const r=await taskReceiptWire(state,task,outcome);return await rpc('save_jls_restaurant_receipt',{
  p_task:task.id,p_worker:task.worker,p_wire:r.wire,p_sha:r.sha256})===true;},
 finishReceipt:async id=>await rpc('finish_jls_restaurant_receipt',{p_task:id})===true,
 stage:async(id,worker,stage,tasks)=>await rpc("stage_jls_restaurant",{p_run:id,p_worker:worker,p_stage:stage,p_tasks:tasks})===true,
 release:async(id,worker,error)=>{await rpc("release_jls_restaurant_tick",{p_run:id,p_worker:worker,p_error:error});}};
}
