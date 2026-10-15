// Free, explicit mock transport. This module has no provider key or native fetch.
// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from "npm:@supabase/supabase-js@2.117.2";
import process from "node:process";
import {solReadyPort} from "./jls-sol-ready-store.ts";
import {processReadySol} from "./jls-sol-ready-worker.ts";
import {technicalSolMock,probeCpuMillis} from "./jls-restaurant-cpu-probe.ts";
import {negativeHash} from "./negative-validation-core.ts";
import type {SolReadyArtifact} from "./jls-sol-ready.ts";
export async function readyTechnicalResponse(a:SolReadyArtifact,variant="normal"){
 const accepted=a.plan.selected.filter(e=>a.decisions.some(d=>d.evidence_id===e.evidence_id&&d.status==="ACCEPTED"));
 const report=technicalSolMock({...a.plan,selected:accepted});
 for(const r of report.report.recommendations)for(const o of r.observations)o.context_sha256=await negativeHash(o.context_quote);
 return {id:"explicit_mock_not_provider",model:"gpt-6.1-sol",status:"completed",
 usage:{input_tokens:a.measurement.local_input_tokens,output_tokens:9500,total_tokens:a.measurement.local_input_tokens+9500},
 output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(report)}]}],
 ...(variant==="large_response"?{technical_stress_padding:"MOCK envelope above expected report size; ".repeat(9000)}:{})};
}
export async function solReadyProbe(admin:SupabaseClient,id:string,variant:string){
 if(!["normal","large_response"].includes(variant))throw Error("JLS_READY_PROBE_INVALID");
 const port=solReadyPort(admin),s=await port.load(id);
 if(s.operation.mode!=="mock"||s.operation.run_id!==null)throw Error("JLS_READY_PROBE_REQUIRES_MOCK");
 const start=performance.now(),before=process.cpuUsage(),stage=s.operation.phase;
 let mockCalls=0;
 const http:typeof fetch=async(url,options)=>{
  if(String(url)!=="https://api.openai.com/v1/responses"||options?.method!=="POST"||options.body!==s.ready.body.request_json)throw Error("MOCK_REQUEST_CHANGED");
  mockCalls++;return new Response(JSON.stringify(await readyTechnicalResponse(s.ready.body,variant)),{headers:{"x-request-id":"explicit_mock"}});
 };
 const result=await processReadySol(port,id,"explicit_mock_key_no_provider_access",http),after=process.cpuUsage();
 const metric={version:"jls-sol-ready-full-worker-probe-v1",operation_id:id,phase:stage,variant,full_worker_path:true,provider_calls:0,mock_http_calls:mockCalls,
  cpu_ms:probeCpuMillis(before,after),cpu_source:"native_Shutdown_required_when_null",wall_ms:performance.now()-start,memory:Deno.memoryUsage(),
  execution_id:Deno.env.get("SB_EXECUTION_ID")??null,runtime:Deno.version,result};
 const saved=await admin.rpc("record_jls_sol_ready_metric",{p_operation:id,p_metric:metric});if(saved.error)throw Error("JLS_READY_METRIC_SAVE_FAILED");
 console.log(JSON.stringify({event:"jls_sol_ready_probe",...metric}));return metric;
}
