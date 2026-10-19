// Server-only adapter. Both technical mocks and paid operations use the same
// SQL reservation/receipt/validation functions; only transport is injected.
// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from "npm:@supabase/supabase-js@2.117.2";
import {assertEvidence40ActiveUser} from "./decisions-evidence40-auth.ts";
import type {ReadyPort,ReadyState} from "./jls-sol-ready-worker.ts";
export function solReadyPort(admin:SupabaseClient,continuation=false):ReadyPort {
 const table=continuation?'analysis_jls_direct4_continuations':'analysis_jls_sol_ready_operations';
 const name=(verb:string)=>continuation?verb+'_jls_direct4_continuation':verb+'_jls_sol_ready';
 const rpc=async(name:string,args:Record<string,unknown>)=>{const r=await admin.rpc(name,args);if(r.error)throw Error("JLS_READY_RPC_"+name.toUpperCase()+"_"+(r.error.code??"UNKNOWN"));return r.data;};
 return {
 load:async id=>{
  const op=await admin.from(table).select("*").eq("id",id).single();if(op.error)throw Error("FORBIDDEN");
  const a=await admin.from("analysis_jls_sol_ready_artifacts").select("body,sha256").eq("id",op.data.artifact_id).eq("organization_id",op.data.organization_id).single();
  if(a.error)throw Error("JLS_SOL_READY_ARTIFACT_MISSING");
  let protocol;
  if(op.data.mode==="mock"&&!continuation)protocol={id:op.data.id,body:op.data.protocol_body,sha256:op.data.protocol_sha256};
  else {const p=await admin.from("analysis_jls_restaurant_protocols").select("id,body,sha256").eq("id",op.data.protocol_id).eq("organization_id",op.data.organization_id).single();if(p.error)throw Error("FORBIDDEN");protocol=p.data;}
  if(protocol.body.organization_id!==op.data.organization_id||protocol.sha256!==op.data.protocol_sha256)throw Error("JLS_READY_ORGANIZATION_CHANGED");
  return {operation:op.data,protocol,ready:a.data} as ReadyState;
 },
 active:async s=>{
  await assertEvidence40ActiveUser(admin,s.protocol.body.authority_user_id);
  const m=await admin.from("organization_members").select("role").eq("organization_id",s.operation.organization_id)
   .eq("user_id",s.protocol.body.authority_user_id).in("role",["owner","admin","manager"]).maybeSingle();
  if(m.error||!m.data)throw Error("FORBIDDEN");
 },
 compatible:async s=>continuation?await rpc('check_jls_direct4_continuation',{p_operation:s.operation.id,p_require_consent:s.operation.phase==='sol'})===true:
  await rpc("check_jls_sol_ready_sources_id",{p_artifact:s.operation.artifact_id})===true,
 claim:async(id,worker)=>await rpc(name('claim'),{p_operation:id,p_worker:worker}),
 receive:async(id,worker,body,sha)=>await rpc(name('receive'),{p_operation:id,p_worker:worker,p_body:body,p_sha:sha})===true,
 finish:async(id,worker,status,body,sha)=>await rpc(name('finish'),{p_operation:id,p_worker:worker,p_status:status,p_body:body,p_sha:sha})===true,
 abort:async(id,worker,error)=>{await rpc(name('abort'),{p_operation:id,p_worker:worker,p_error:error});}
 };
}
