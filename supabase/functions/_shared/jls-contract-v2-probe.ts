// Explicit technical mocks only. No native fetch, provider key or paid consent.
// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from "npm:@supabase/supabase-js@2.117.2";
import process from "node:process";
import {contractV2Port} from "./jls-contract-v2-store.ts";
import {processContractV2} from "./jls-contract-v2-worker.ts";
import {technicalSolMock,probeCpuMillis} from "./jls-restaurant-cpu-probe.ts";
import {RECOMMENDATION_VERSION} from "./jls-recommendation-contract-v2.ts";
import type {ContractState} from "./jls-contract-v2-worker.ts";
export function contractTechnicalResponse(s:ContractState,requested:"ACCEPTED"|"REJECTED"|"UNCERTAIN",stage=s.operation.phase){
 if(stage==="luna"){
  const choice=requested==="ACCEPTED"?"supported":requested==="REJECTED"?"unsupported":"uncertain";
  return {id:"EXPLICIT_MOCK_NOT_PROVIDER",model:"gpt-6-luna",usage:{input_tokens:1000,output_tokens:0,total_tokens:1000},
   answers:[{name:s.protocol.body.candidate_evidence_id,type:"choice",choice,
    probabilities:[{value:"supported",probability:choice==="supported"?.96:.02},{value:"unsupported",probability:choice==="unsupported"?.96:.02},{value:"uncertain",probability:choice==="uncertain"?.96:.02}],confidence:.96}]};
 }
 const b=s.protocol.body.branches.find(b=>b.assumption===requested)!;
 const report=technicalSolMock({...s.protocol.body.plan,selected:s.protocol.body.plan.selected.filter(e=>b.draft.accepted_ids.includes(e.evidence_id))});
 report.report.recommendations=[];
 return {id:"EXPLICIT_MOCK_NOT_PROVIDER",model:"gpt-6.1-sol",status:"completed",usage:{input_tokens:b.draft.measurement.local_input_tokens,output_tokens:9500,total_tokens:b.draft.measurement.local_input_tokens+9500},
  output:[{type:"message",content:[{type:"output_text",text:JSON.stringify({...report,format_version:RECOMMENDATION_VERSION})}]}]};
}
export async function contractV2Probe(admin:SupabaseClient,id:string){
 const port=contractV2Port(admin),s=await port.load(id);
 if(s.operation.mode!=="mock")throw Error("JLS_V2_PROBE_REQUIRES_MOCK");
 const variant=(await admin.from("analysis_jls_contract_v2_operations").select("nonce").eq("id",id).single()).data?.nonce?.split(":")[0];
 if(!["ACCEPTED","REJECTED","UNCERTAIN"].includes(variant))throw Error("JLS_V2_PROBE_VARIANT_INVALID");
 let calls=0;const start=performance.now(),cpu=process.cpuUsage();
 const http:typeof fetch=(url,options)=>{
  const endpoint=s.operation.phase==="luna"?"https://api.openai.com/v1/decisions":"https://api.openai.com/v1/responses";
  const wire=s.operation.phase==="luna"?s.protocol.body.luna_request_json:s.protocol.body.branches.find(b=>b.assumption===variant)!.request_json;
  if(String(url)!==endpoint||options?.body!==wire||options.method!=="POST")throw Error("MOCK_REQUEST_CHANGED");
  calls++;return Promise.resolve(new Response(JSON.stringify(contractTechnicalResponse(s,variant)),{headers:{"x-request-id":"explicit_mock"}}));
 };
 const result=await processContractV2(port,id,"explicit_mock_key_no_provider_access",http);
 const metric={version:"jls-contract-v2-full-worker-probe-v1",phase:s.operation.phase,variant,full_worker_path:true,provider_calls:0,mock_http_calls:calls,
  cpu_ms:probeCpuMillis(cpu,process.cpuUsage()),wall_ms:performance.now()-start,memory:Deno.memoryUsage(),execution_id:Deno.env.get("SB_EXECUTION_ID")??null,runtime:Deno.version,result};
 const saved=await admin.rpc("record_jls_contract_v2_metric",{p_operation:id,p_metric:metric});if(saved.error)throw Error("JLS_V2_METRIC_SAVE_FAILED");
 console.log(JSON.stringify({event:"jls_contract_v2_probe",...metric}));return metric;
}
