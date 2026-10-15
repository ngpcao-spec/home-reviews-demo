// Explicit technical mocks only. Never a report/run/reference or provider call.
// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from "npm:@supabase/supabase-js@2.117.2";
import process from "node:process";
import {verifyPreparedProtocol,verifyPreparedArtifact,type PreparedRestaurantRow} from "./jls-restaurant-prepared.ts";
import {parseJlsLuna,type JlsPlan} from "./jev-luna-sol.ts";
import {restaurantSol,type RestaurantProtocol} from "./jls-restaurant.ts";
import {attachPlanTokenMemo,planTokenMemo,tokenCertificate} from "./jls-token-memo.ts";
import {hybridHash} from "./jev-hybrid-evidence.ts";
import {solRequestSize} from "./jls-sol-size.ts";
import {validateEditorialReport} from "./jls-editorial-validation.ts";
import {RECOMMENDATION_TOPICS,ACTION_FOCUS} from "./jev-luna-sol-prioritized.ts";
import {assertEvidence40ActiveUser} from "./decisions-evidence40-auth.ts";
export async function technicalLunaMocks(plan:JlsPlan,omitLast=false){const ds=[];
 for(const g of plan.luna_groups){const raw={model:"gpt-6-luna",usage:{input_tokens:1,output_tokens:0,total_tokens:1},answers:g.evidence_ids.map(id=>{
 const accept=!omitLast||id!==plan.selected.at(-1)!.evidence_id;return {name:id,type:"choice",choice:accept?"supported":"uncertain",confidence:.95,
 probabilities:[{value:"supported",probability:accept?.95:.03},{value:"unsupported",probability:.02},{value:"uncertain",probability:accept?.03:.95}]};})};
 ds.push(...(await parseJlsLuna(plan,g,raw)).decisions);}return ds;}
export function technicalSolMock(plan:JlsPlan){
 const axes=(["service","quality","price","atmosphere"] as const).map(axis=>({axis,text:"Khách mô tả trải nghiệm tại nhà hàng.",evidence_ids:plan.selected.filter(e=>e.axis===axis).map(e=>e.evidence_id).slice(0,25)}));
 const used=new Set<string>();const recommendations=plan.selected.filter(e=>e.polarity==="negative").flatMap(e=>{
 const topic=Object.entries(RECOMMENDATION_TOPICS).find(([k,themes])=>!used.has(k)&&(themes as readonly string[]).includes(e.theme_key))?.[0];
 const focus=Object.entries(ACTION_FOCUS).find(([,f])=>f.theme===e.theme_key)?.[0];if(!topic||!focus||used.size>=5)return [];used.add(topic);
 return [{axis:e.axis,title:"Xem xét phản ánh cụ thể của khách",topic,evidence_ids:[e.evidence_id],
 observations:[{text:"Khách phản ánh trải nghiệm cần xem xét.",evidence_id:e.evidence_id,theme_key:e.theme_key,polarity:e.polarity,quote:e.quote,quote_sha256:e.quote_sha256,context_quote:e.context,context_sha256:"",context_summary:"Giữ nguyên ngữ cảnh để xem xét phản ánh."}],
 proposed_action:{text:"Xem xét nội dung khách phản ánh.",kind:"review",focus},priority:{rank:used.size,reason:"Phản ánh cụ thể cần được kiểm tra trong phạm vi đã phân tích.",basis:"sourced_signal",frequency_keys:[]}}];});
 return {format_version:"jls-prioritized-recommendations-v1",statistics_sha256:plan.statistics_sha256,report:{axes,
 positive_aspects:plan.selected.filter(e=>e.polarity==="positive").slice(0,25).map(e=>({axis:e.axis,text:"Khách chia sẻ nhận xét tích cực.",evidence_ids:[e.evidence_id]})),
 negative_aspects:plan.selected.filter(e=>e.polarity==="negative").slice(0,25).map(e=>({axis:e.axis,text:"Khách chia sẻ điểm cần xem xét.",evidence_ids:[e.evidence_id]})),
 conclusion:{text:"Cần xem xét phản ánh trong phạm vi đã phân tích.",evidence_ids:plan.selected.slice(0,25).map(e=>e.evidence_id)},recommendations}};}
export async function preparedCpuExercise(p:RestaurantProtocol,sha:string,row:PreparedRestaurantRow,phase:string){
 await verifyPreparedProtocol(p,sha);const plan=await verifyPreparedArtifact(p,row);
 let checked=0,measurement=null,recommendations=0;
 if(phase==="verify"){for(const g of plan.luna_groups){if(await hybridHash(g.payload)!==g.request_sha256)throw Error("PROBE_REQUEST_CHANGED");checked++;}}
 else{
 const ds=await technicalLunaMocks(plan,phase==="prepare_sol");
 if(phase==="prepare_sol")await attachPlanTokenMemo(plan,row.body.token_certificate);
 const sol=await restaurantSol(plan,ds);if(!sol.gate.passed||!sol.draft)throw Error("PROBE_FIXTURE_GATE_FAILED");
 measurement=solRequestSize(sol.draft.request,p.sol_size_policy,planTokenMemo(plan)?.count);checked=1;
 if(phase==="sol_pre_send_validate"){
 const cert=await tokenCertificate(plan);await attachPlanTokenMemo(plan,cert,true);
 const raw=technicalSolMock(plan);recommendations=raw.report.recommendations.length;
 // Deliberately synthetic prose may need review; all deterministic checks run.
 await validateEditorialReport(raw,plan,p.snapshot,ds,"vi");
 }
 }
 return {checked_requests:checked,measurement,memo_misses:planTokenMemo(plan)?.misses??0,synthetic_recommendations:recommendations};
}
export function probeCpuMillis(before:{user:number;system:number}|null,after:{user:number;system:number}|null){
 const delta=before&&after?(after.user+after.system-before.user-before.system)/1000:null;return delta!==null&&delta>0?delta:null;
}
function cpu(){try{return process.cpuUsage();}catch{return null;}}
export async function restaurantCpuProbe(admin:SupabaseClient,request:{protocol_id:string;nonce:string;phase:string}){
 const start=performance.now(),before=cpu();
 if(!["verify","prepare_sol","sol_pre_send_validate"].includes(request.phase)||!request.nonce||request.nonce.length>100)throw Error("JLS_CPU_PROBE_INVALID");
 const pr=await admin.from("analysis_jls_restaurant_protocols").select("body,sha256,authority_user_id,organization_id").eq("id",request.protocol_id).single();if(pr.error)throw Error("FORBIDDEN");
 await assertEvidence40ActiveUser(admin,pr.data.authority_user_id);
 const membership=await admin.from("organization_members").select("role").eq("organization_id",pr.data.organization_id).eq("user_id",pr.data.authority_user_id).in("role",["owner","admin","manager"]).maybeSingle();if(membership.error||!membership.data)throw Error("FORBIDDEN");
 const ar=await admin.from("analysis_jls_restaurant_prepared_artifacts").select("body,sha256").eq("sha256",pr.data.body.prepared?.artifact_sha256??"").eq("organization_id",pr.data.organization_id).single();if(ar.error)throw Error("JLS_PREPARED_ARTIFACT_MISSING");
 const cache=await admin.rpc("check_jls_restaurant_prepared_cache",{p_protocol:request.protocol_id});if(cache.error||cache.data!==true)throw Error("JLS_REUSED_CACHE_CHANGED");
 const exercise=await preparedCpuExercise(pr.data.body,pr.data.sha256,ar.data,request.phase),after=cpu();
 const result={version:"jls-edge-cpu-probe-v1.1-platform-telemetry",explicit_non_provider_test:true,provider_calls:0,paid_consent_created:false,paid_run_created:false,
 phase:request.phase,protocol_id:request.protocol_id,nonce:request.nonce,wall_ms:performance.now()-start,
 cpu_ms:probeCpuMillis(before,after),cpu_measurement_source:probeCpuMillis(before,after)===null?"supabase_function_logs_shutdown_required":"process_cpu_usage",cpu_limit_ms:2000,
 ...exercise,runtime:Deno.version,memory:Deno.memoryUsage(),mock_data:"only_in_memory_native_Luna_and_Sol_mocks_never_real_results"};
 const save=await admin.rpc("record_jls_restaurant_cpu_probe",{p_protocol:request.protocol_id,p_nonce:request.nonce,p_body:result,p_sha:await hybridHash(result)});if(save.error)throw Error("JLS_PROBE_SAVE_FAILED");
 console.log(JSON.stringify({event:"jls_cpu_probe_complete",id:save.data,phase:request.phase,cpu_ms:result.cpu_ms,wall_ms:result.wall_ms,provider_calls:0}));
 return {...result,probe_id:save.data};
}
