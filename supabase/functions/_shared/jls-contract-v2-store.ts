// Server adapter reuses active-identity checks and the source compatibility RPC.
// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from "npm:@supabase/supabase-js@2.117.2";
import {assertEvidence40ActiveUser} from "./decisions-evidence40-auth.ts";
import type {ContractPort,ContractState} from "./jls-contract-v2-worker.ts";
export function contractV2Port(admin:SupabaseClient):ContractPort{
 const rpc=async(name:string,args:Record<string,unknown>)=>{const r=await admin.rpc(name,args);if(r.error)throw Error("JLS_V2_RPC_"+name.toUpperCase());return r.data;};
 return {
 load:async id=>{
  const o=await admin.from("analysis_jls_contract_v2_operations").select("*").eq("id",id).single();if(o.error)throw Error("FORBIDDEN");
  const p=await admin.from("analysis_jls_contract_v2_protocols").select("id,body,sha256").eq("id",o.data.protocol_id).eq("organization_id",o.data.organization_id).single();if(p.error)throw Error("FORBIDDEN");
  const [a,s]=await Promise.all([
   admin.from("analysis_jls_sol_ready_artifacts").select("id,body,sha256").eq("id",p.data.body.source_artifact_id).eq("organization_id",o.data.organization_id).single(),
   admin.from("analysis_jls_restaurant_protocols").select("id,body,sha256").eq("id",p.data.body.source_protocol_id).eq("organization_id",o.data.organization_id).single()]);
  if(a.error||s.error)throw Error("JLS_V2_SOURCE_MISSING");return {operation:o.data,protocol:p.data,source:{artifact:a.data,protocol:s.data}} as ContractState;
 },
 active:async s=>{await assertEvidence40ActiveUser(admin,s.protocol.body.authority_user_id);
  const m=await admin.from("organization_members").select("role").eq("organization_id",s.protocol.body.organization_id).eq("user_id",s.protocol.body.authority_user_id).in("role",["owner","admin","manager"]).maybeSingle();
  if(m.error||!m.data)throw Error("FORBIDDEN");},
 compatible:async s=>await rpc("check_jls_contract_v2_sources",{p_protocol:s.protocol.id})===true,
 claim:(id,worker)=>rpc("claim_jls_contract_v2",{p_operation:id,p_worker:worker}),
 receive:async(id,worker,phase,body,sha)=>await rpc("receive_jls_contract_v2",{p_operation:id,p_worker:worker,p_phase:phase,p_body:body,p_sha:sha})===true,
 finishLuna:async(id,worker,body,sha,branch)=>await rpc("finish_jls_contract_v2_luna",{p_operation:id,p_worker:worker,p_body:body,p_sha:sha,p_branch:branch})===true,
 finishSol:async(id,worker,status,body,sha)=>await rpc("finish_jls_contract_v2_sol",{p_operation:id,p_worker:worker,p_status:status,p_body:body,p_sha:sha})===true,
 abort:async(id,worker,error)=>{await rpc("abort_jls_contract_v2",{p_operation:id,p_worker:worker,p_error:error});}
 };
}
