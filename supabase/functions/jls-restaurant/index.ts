import {requireUser,assertMembership} from "../_shared/auth.ts";
import {json,preflight} from "../_shared/cors.ts";
import {hybridHash} from "../_shared/jev-hybrid-evidence.ts";
import {verifyRestaurantProtocol} from "../_shared/jls-restaurant.ts";
Deno.serve(async r=>{
 const pre=preflight(r);if(pre)return pre;
 if(r.method!=="GET")return json({error:"METHOD_NOT_ALLOWED"},405);
 try{
  const c=await requireUser(r),est=new URL(r.url).searchParams.get("establishment_id");
  const er=await c.client.from("establishments").select("id,organization_id").eq("id",est).single();
  if(er.error||!er.data)throw Error("FORBIDDEN");
  await assertMembership(c.client,c.user.id,er.data.organization_id,["owner","admin","manager"]);
  const pr=await c.client.from("analysis_jls_restaurant_protocols").select("id,body,sha256,created_at")
   .eq("establishment_id",er.data.id).eq("organization_id",er.data.organization_id).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(pr.error)throw Error("JLS_READ_FAILED");
  if(!pr.data)return json({protocol:null,run:null,new_paid_calls:0});
  const p=pr.data;await verifyRestaurantProtocol(p.body,p.sha256);
  const rr=await c.client.from("analysis_jls_restaurant_runs").select("id,status,stage,error_code,created_at").eq("protocol_id",p.id).maybeSingle();
  if(rr.error)throw Error("JLS_READ_FAILED");
  let result=null,progress=null;
  if(rr.data){
   const ts=await c.client.from("analysis_jls_restaurant_tasks").select("id,phase,status,request_count").eq("run_id",rr.data.id);
   if(ts.error)throw Error("JLS_READ_FAILED");
   progress=ts.data;
   const ids=ts.data.filter(t=>t.phase==="sol").map(t=>"task:"+t.id);
   if(ids.length){
    const ar=await c.client.from("analysis_jls_restaurant_artifacts").select("body,sha256").eq("run_id",rr.data.id).in("kind",ids).maybeSingle();
    if(ar.error||ar.data&&await hybridHash(ar.data.body)!==ar.data.sha256)throw Error("JLS_RESULT_CHANGED");
    result=ar.data?.body??null;
   }
  }
  return json({protocol:{id:p.id,sha256:p.sha256,created_at:p.created_at,establishment_name:p.body.snapshot.source.establishment_name,
   source_sha256:p.body.snapshot.source_sha256,configuration_sha256:p.body.configuration_sha256,
   coverage:p.body.coverage,max_jev_calls:p.body.max_jev_calls,max_luna_calls:p.body.max_luna_calls,max_sol_calls:1,
   language:"vi",format_version:p.body.configuration.policy.format_version,editorial_version:p.body.configuration.policy.editorial_version},
   run:rr.data,result,progress,new_paid_calls:0,production_enabled:false});
 }catch(e){const code=e instanceof Error&&/^[A-Z_0-9]+$/.test(e.message)?e.message:"JLS_READ_FAILED";
  return json({error:code},code==="UNAUTHORIZED"?401:code==="FORBIDDEN"?403:409);}
});
