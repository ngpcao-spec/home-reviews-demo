import {requireUser,assertMembership} from "../_shared/auth.ts";
import {json,preflight} from "../_shared/cors.ts";
import {hybridHash} from "../_shared/jev-hybrid-evidence.ts";
import {verifyRestaurantProtocol} from "../_shared/jls-restaurant.ts";
import {contractReportView} from "../_shared/jls-contract-v2-view.ts";
import {SNAPSHOT_V2,verifySnapshotV2} from "../_shared/jls-snapshot-v2.ts";
import {savedResponseView} from "../_shared/jls-saved-response-view.ts";
Deno.serve(async r=>{
 const pre=preflight(r);if(pre)return pre;
 if(r.method!=="GET")return json({error:"METHOD_NOT_ALLOWED"},405);
 try{
  const c=await requireUser(r),est=new URL(r.url).searchParams.get("establishment_id");
  const er=await c.client.from("establishments").select("id,organization_id,name").eq("id",est).single();
  if(er.error||!er.data)throw Error("FORBIDDEN");
  await assertMembership(c.client,c.user.id,er.data.organization_id,["owner","admin","manager"]);
  // New V2 results live in a separate immutable store. Read them before loading
  // the large historical protocol; an old report must not hide the current one.
  if(new URL(r.url).searchParams.get("view")==="contract_v2"){
   const cp=await c.client.from("analysis_jls_contract_v2_protocols")
    .select("id,organization_id,establishment_id,sha256").eq("organization_id",er.data.organization_id)
    .eq("establishment_id",er.data.id).order("created_at",{ascending:false}).limit(1).maybeSingle();
   if(cp.error)throw Error("JLS_READ_FAILED");
   if(cp.data){
    const co=await c.client.from("analysis_jls_contract_v2_operations")
     .select("id,protocol_id,organization_id,mode,status,phase,luna_count,sol_count,error_code,created_at,result,result_sha256,luna_result,luna_result_sha256")
     .eq("organization_id",er.data.organization_id).eq("protocol_id",cp.data.id).eq("mode","paid").maybeSingle();
    if(co.error)throw Error("JLS_READ_FAILED");
    if(co.data)return json({protocol:null,run:null,result:null,progress:null,
     contract_v2:await contractReportView(cp.data,co.data,{organization_id:er.data.organization_id,establishment_id:er.data.id,establishment_name:er.data.name}),
     history_available:true,new_paid_calls:0,production_enabled:false});
   }
  }
  const pr=await c.client.from("analysis_jls_restaurant_protocols").select("id,body,sha256,created_at")
   .eq("establishment_id",er.data.id).eq("organization_id",er.data.organization_id).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(pr.error)throw Error("JLS_READ_FAILED");
  if(!pr.data)return json({protocol:null,run:null,new_paid_calls:0});
  const p=pr.data;if(p.body.version===SNAPSHOT_V2)await verifySnapshotV2(p.body,p.sha256);else await verifyRestaurantProtocol(p.body,p.sha256);
  const rr=await c.client.from("analysis_jls_restaurant_runs").select("id,status,stage,error_code,created_at").eq("protocol_id",p.id).maybeSingle();
  if(rr.error)throw Error("JLS_READ_FAILED");
  let savedValidation=null,savedValidationArchive=null;
  if(p.body.version===SNAPSHOT_V2&&rr.data){
   const sv=await c.client.from("analysis_jls_snapshot_preparations").select("id,organization_id,body,sha256,created_at").eq("protocol_id",p.id).eq("organization_id",er.data.organization_id).eq("kind","saved_sol_response_validation_v1").maybeSingle();
   if(sv.error)throw Error("JLS_READ_FAILED");
   if(sv.data){
    const op=await c.client.from("analysis_jls_sol_ready_operations").select("id,organization_id,protocol_id,run_id,artifact_id,receipt,receipt_sha256,request_count").eq("id",sv.data.body.source_operation_id).eq("run_id",rr.data.id).eq("protocol_id",p.id).eq("organization_id",er.data.organization_id).eq("mode","paid").single();
    if(op.error)throw Error("JLS_SAVED_RESPONSE_CHANGED");
    const ar=await c.client.from("analysis_jls_sol_ready_artifacts").select("id,organization_id,source_protocol_id,source_run_id,sha256,request_sha256:body->>request_sha256").eq("id",op.data.artifact_id).eq("organization_id",er.data.organization_id).single();
    if(ar.error)throw Error("JLS_SAVED_RESPONSE_CHANGED");
    savedValidation=await savedResponseView(sv.data,{organization_id:er.data.organization_id,protocol_id:p.id,protocol_sha256:p.sha256,run_id:rr.data.id,run_status:rr.data.status},op.data,ar.data);
    savedValidationArchive=sv.data;
   }
  }
  if(new URL(r.url).searchParams.get("view")==="audit"&&p.body.version===SNAPSHOT_V2){
   const [archive,tasks,artifacts]=await Promise.all([
    c.client.from("analysis_jls_snapshot_preparations").select("kind,body,sha256").eq("protocol_id",p.id).eq("organization_id",er.data.organization_id).eq("kind","historical_archive"),
    rr.data?c.client.from("analysis_jls_restaurant_tasks").select("*").eq("run_id",rr.data.id).eq("organization_id",er.data.organization_id):Promise.resolve({data:[],error:null}),
    rr.data?c.client.from("analysis_jls_restaurant_artifacts").select("kind,body,sha256").eq("run_id",rr.data.id).eq("organization_id",er.data.organization_id):Promise.resolve({data:[],error:null})]);
   if(archive.error||tasks.error||artifacts.error)throw Error("JLS_READ_FAILED");
   return json({audit_only:true,qualitative_audit_performed:false,new_paid_calls:0,protocol:{id:p.id,sha256:p.sha256,body:p.body},
    reference:archive.data,run:rr.data,tasks:tasks.data,artifacts:artifacts.data,saved_response_validation:savedValidation,saved_response_validation_archive:savedValidationArchive});
  }
  let result=null,progress=null,recommendationReview=null,resultSha=null;
  if(rr.data){
   const ts=await c.client.from("analysis_jls_restaurant_tasks").select("id,phase,status,request_count").eq("run_id",rr.data.id);
   if(ts.error)throw Error("JLS_READ_FAILED");
   progress=ts.data;
   const ids=ts.data.filter(t=>t.phase==="sol").map(t=>"task:"+t.id);
   if(ids.length){
    const ar=await c.client.from("analysis_jls_restaurant_artifacts").select("body,sha256").eq("run_id",rr.data.id).in("kind",ids).maybeSingle();
    if(ar.error||ar.data&&await hybridHash(ar.data.body)!==ar.data.sha256)throw Error("JLS_RESULT_CHANGED");
    result=ar.data?.body??null;resultSha=ar.data?.sha256??null;
   }
   const review=await c.client.from("analysis_jls_recommendation_reviews").select("id,body,sha256,created_at").eq("run_id",rr.data.id).eq("organization_id",er.data.organization_id).eq("version","jls-recommendation-review-v2").maybeSingle();
   if(review.error||review.data&&(await hybridHash(review.data.body)!==review.data.sha256||review.data.body.original_result_sha256!==resultSha||review.data.body.run_id!==rr.data.id))throw Error("JLS_RECOMMENDATION_REVIEW_CHANGED");
   recommendationReview=review.data;
  }
  const history=p.body.version===SNAPSHOT_V2?{data:[],error:null}:await c.client.from("analysis_jls_restaurant_runs").select("id,status,stage,error_code,protocol_id").eq("organization_id",er.data.organization_id).neq("protocol_id",p.id);
  if(history.error)throw Error("JLS_READ_FAILED");
  return json({historical_runs:history.data,protocol:{id:p.id,sha256:p.sha256,created_at:p.created_at,establishment_name:p.body.snapshot.source.establishment_name,
   source_sha256:p.body.snapshot.source_sha256,configuration_sha256:p.body.configuration_sha256,
   coverage:p.body.coverage,max_jev_calls:p.body.max_jev_calls,max_luna_calls:p.body.max_luna_calls,max_sol_calls:1,
   sol_final_request_ready:!!p.body.sol_ready,reused_luna_calls:p.body.sol_ready?28:0,reused_luna_decisions:p.body.sol_ready?32:0,
   prepared_artifact_sha256:p.body.sol_ready?.artifact_sha256??p.body.prepared?.artifact_sha256??null,sol_preflight:p.body.sol_ready?.measurement??p.body.resume?.conditional_sol.measurement??null,source_run_id:p.body.sol_ready?.source_run_id??p.body.resume?.source_run_id??null,
   language:"vi",format_version:p.body.configuration.policy.format_version,editorial_version:p.body.configuration.policy.editorial_version},
   ...(p.body.version===SNAPSHOT_V2?{frozen_source:{establishment_id:p.body.establishment_id,historical_run_id:p.body.frozen_v2.historical_run_id,source_fingerprint:p.body.frozen_v2.source_fingerprint,
    source_ids:p.body.snapshot.source.reviews.map((r:{id:string})=>r.id),statistics_denominators:{overall:100,thematic:80},no_paid_go:!rr.data,
    immutable_historical_report:true}}:{}),
   run:rr.data,result,progress,recommendation_review:recommendationReview,saved_response_validation:savedValidation,new_paid_calls:0,production_enabled:false});
 }catch(e){const code=e instanceof Error&&/^[A-Z_0-9]+$/.test(e.message)?e.message:"JLS_READ_FAILED";
  return json({error:code},code==="UNAUTHORIZED"?401:code==="FORBIDDEN"?403:409);}
});
