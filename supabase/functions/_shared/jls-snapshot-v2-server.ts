// Versioned adapter over the existing durable queues and single-call Sol worker.
// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from "npm:@supabase/supabase-js@2.117.2";
import process from "node:process";
import {restaurantPort} from "./jls-restaurant-store.ts";
import {solReadyPort} from "./jls-sol-ready-store.ts";
import {processRestaurant,type RestaurantState} from "./jls-restaurant-worker.ts";
import {processReadySol,type ReadyState} from "./jls-sol-ready-worker.ts";
import {SNAPSHOT_V2,verifySnapshotEvidence,snapshotExecutionContract,snapshotReadyContract,type SnapshotEvidence} from "./jls-snapshot-v2.ts";
import {snapshotMockPort,snapshotReadyMock} from "./jls-snapshot-v2-probe.ts";
import {assertEvidence40ActiveUser} from "./decisions-evidence40-auth.ts";
import {hybridHash} from "./jev-hybrid-evidence.ts";
import {negativeHash} from "./negative-validation-core.ts";
export async function processSnapshotRun(admin:SupabaseClient,run:string,keys:{jev:string;openai:string},http:typeof fetch){
 const port=restaurantPort(admin),state=await port.load(run);
 if(state.protocol.body.version!==SNAPSHOT_V2)throw Error("JLS_SNAPSHOT_VERSION_CHANGED");
 if(!["queued","running"].includes(state.run.status))return {phase:"already_saved",provider_calls:0};
 if(["prepare_evidence","prepare_sol"].includes(state.run.stage))return {phase:"awaiting_authenticated_free_compilation",provider_calls:0};
 if(state.run.stage==="sol"||String(state.run.stage)==="validate_sol"){
  const op=await admin.from("analysis_jls_sol_ready_operations").select("id").eq("run_id",run).eq("mode","paid").single();
  if(op.error)throw Error("JLS_SNAPSHOT_SOL_OPERATION_MISSING");
  return processReadySol(solReadyPort(admin),op.data.id,keys.openai,http,snapshotReadyContract);
 }
 if(state.run.stage==="luna"){
  const row=state.artifacts.find(a=>a.kind==="snapshot_evidence");if(!row)throw Error("JLS_EVIDENCE_MISSING");
  await verifySnapshotEvidence(state.protocol.body,state.protocol.sha256,row.body as unknown as SnapshotEvidence);
 }
 return processRestaurant(port,run,keys,http,snapshotExecutionContract);
}
export async function snapshotNativeProbe(admin:SupabaseClient,request:{protocol_id:string;phase:string;nonce:string}){
 if(!["jev","luna","sol","validate_sol","stress_validate_sol"].includes(request.phase)||!/^[-a-zA-Z0-9_]{1,50}$/.test(request.nonce))throw Error("JLS_PROBE_SCOPE_INVALID");
 const start=performance.now(),cpu=process.cpuUsage(),pr=await admin.from("analysis_jls_restaurant_protocols").select("body,sha256").eq("id",request.protocol_id).single();
 if(pr.error||pr.data.body.version!==SNAPSHOT_V2)throw Error("FORBIDDEN");
 await assertEvidence40ActiveUser(admin,pr.data.body.authority_user_id);
 const m=await admin.from("organization_members").select("role").eq("organization_id",pr.data.body.organization_id).eq("user_id",pr.data.body.authority_user_id).in("role",["owner","admin","manager"]).maybeSingle();
 if(m.error||!m.data)throw Error("FORBIDDEN");
 const phase=request.phase==="stress_validate_sol"?"validate_sol":request.phase;
 const input=await admin.from("analysis_jls_snapshot_preparations").select("body,sha256").eq("protocol_id",request.protocol_id).eq("kind","probe_input_"+phase).single();
 if(input.error||await hybridHash(input.data.body)!==input.data.sha256||input.data.body.protocol_sha256!==pr.data.sha256||input.data.body.explicit_technical_mock!==true)throw Error("JLS_PROBE_INPUT_CHANGED");
 const data=input.data.body.input;let result:unknown,calls=0,saved=false,resultSha:string|null=null;
 if(phase==="jev"||phase==="luna"){
  const f=snapshotMockPort(data.state as RestaurantState,data.cache);
  if(phase==="luna"){
   const row=f.state.artifacts.find(a=>a.kind==="snapshot_evidence");if(!row)throw Error("JLS_PROBE_EVIDENCE_MISSING");
   await verifySnapshotEvidence(f.state.protocol.body,f.state.protocol.sha256,row.body as unknown as SnapshotEvidence);
  }
  await processRestaurant(f.port,f.state.run.id,{jev:"EXPLICIT_MOCK",openai:"EXPLICIT_MOCK"},f.http,snapshotExecutionContract);
  calls=f.calls.length;result={stage:f.state.run.stage,status:f.state.run.status,completed:f.state.tasks.filter(t=>t.status==="completed").length};
  saved=f.state.artifacts.some(a=>a.kind.startsWith("task:"));resultSha=await hybridHash(f.state.artifacts);
 }else{
  const initial=data as ReadyState;
  if(request.phase==="stress_validate_sol"){
   const receipt=initial.operation.receipt!;receipt.raw_response_text+=" ".repeat(450000);
   receipt.raw_response_sha256=await negativeHash(receipt.raw_response_text!);initial.operation.receipt_sha256=await hybridHash(receipt);
  }
  const f=snapshotReadyMock(initial);result=await processReadySol(f.port,f.state.operation.id,"EXPLICIT_MOCK",f.http,snapshotReadyContract);
  calls=f.calls.length;saved=!!(phase==="sol"?f.state.operation.receipt:f.state.operation.result?.validated_report);resultSha=await hybridHash(f.state.operation.result??f.state.operation.receipt);
 }
 if(!saved)throw Error("JLS_NATIVE_PROBE_NOT_SAVED");
 const delta=process.cpuUsage(cpu),body={version:SNAPSHOT_V2,explicit_non_provider_test:true,explicit_technical_mock:true,provider_calls:0,
  protocol_sha256:pr.data.sha256,phase:request.phase,result,mock_http_calls:calls,mock_saved:saved,mock_result_sha256:resultSha,
  cpu_process_ms:(delta.user+delta.system)/1000,wall_ms:performance.now()-start,memory:Deno.memoryUsage(),execution_id:Deno.env.get("SB_EXECUTION_ID")??null,runtime:Deno.version};
 const stored=await admin.rpc("save_jls_snapshot_preparation",{p_protocol:request.protocol_id,p_kind:"native_probe_"+request.phase+"_"+request.nonce,p_body:body,p_sha:await hybridHash(body)});
 if(stored.error)throw Error("JLS_NATIVE_PROBE_SAVE_FAILED");console.log(JSON.stringify({event:"jls_snapshot_v2_probe",id:stored.data,...body}));return body;
}
