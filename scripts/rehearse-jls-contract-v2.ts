import process from "node:process";
import {processContractV2,type ContractState} from "../supabase/functions/_shared/jls-contract-v2-worker.ts";
import {contractMemoryFixture} from "../tests/fixtures/jls-contract-v2-memory.ts";
import {hybridHash} from "../supabase/functions/_shared/jev-hybrid-evidence.ts";
const [inputPath,preparedPath,outPath]=Deno.args;
globalThis.fetch=()=>{throw Error("PROVIDER_NETWORK_BLOCKED");};
const input=JSON.parse(await Deno.readTextFile(inputPath)),prepared=JSON.parse(await Deno.readTextFile(preparedPath));
if(await hybridHash(prepared.body)!==prepared.sha256)throw Error("SERIALIZED_PROTOCOL_CHANGED");
const results=[];let successfulInitial:ContractState|undefined;
for(const variant of ["ACCEPTED","REJECTED","UNCERTAIN"] as const){
 const initial:ContractState={source:input.source,protocol:{id:"offline_preparation_not_a_paid_protocol",...prepared},operation:{id:crypto.randomUUID(),mode:"mock",phase:"luna",status:"queued",luna_count:0,sol_count:0,worker:null,
  luna_receipt:null,luna_receipt_sha256:null,luna_result:null,sol_receipt:null,sol_receipt_sha256:null,result:null}};
 const f=contractMemoryFixture(initial,variant),stages=[];
 const dossier=prepared.body.branches.find((b:{assumption:string})=>b.assumption===variant).draft;
 if(variant!=="ACCEPTED"&&dossier.accepted_ids.includes(prepared.body.candidate_evidence_id))throw Error("UNVERIFIED_CANDIDATE_IN_SOL");
 successfulInitial??=initial;
 for(let i=0;i<4;i++){
  const before=process.cpuUsage(),start=performance.now(),stage=f.state.operation.phase;
  const result=await processContractV2(f.port,initial.operation.id,"mock_key",f.http);
  const cpu=process.cpuUsage(before);stages.push({stage,result,cpu_ms:(cpu.user+cpu.system)/1000,wall_ms:performance.now()-start,memory:Deno.memoryUsage()});
  if(result?.error_code)throw Error(JSON.stringify(result));
 }
 if(f.calls.join(",")!=="luna,sol"||f.state.operation.status!=="completed"||!f.state.operation.result?.validated_report)throw Error("FULL_OFFLINE_PATH_FAILED");
 await processContractV2(f.port,initial.operation.id,"mock_key",f.http);
 if(f.calls.length!==2)throw Error("REPLAY_MUST_NOT_REDISPATCH");
 results.push({variant,stages,status:f.state.operation.status,calls_simulated:f.calls,provider_calls:0});
}
const checks=[];
for(const kind of ["permission","source","protocol","quote","resealed_quote","changed_configuration","changed_group","changed_cache","concurrent","timeout_luna","timeout_sol","missing_usage","wrong_model","provider_http","invalid_sol","changed_native","lost_receipt","low_confidence"]){
 const f=contractMemoryFixture(successfulInitial!,"ACCEPTED");let calls=0;
 if(kind==="permission")f.deny();if(kind==="source")f.incompatible();if(kind==="protocol")f.state.protocol.body.language="fr" as "vi";
 if(kind==="quote")f.state.protocol.body.plan.selected[0].quote+=" changed";
 if(kind==="resealed_quote")f.state.protocol.body.plan.selected[0].context+=" changed";
 if(kind==="changed_configuration")Object.assign(f.state.protocol.body.plan.config,{confidence_min:.01});
 if(kind==="changed_group")f.state.protocol.body.plan.luna_groups[0].questions_sha256="a".repeat(64);
 if(kind==="changed_cache")f.state.protocol.body.plan.cache_fingerprints[0].response_sha256="a".repeat(64);
 if(["resealed_quote","changed_configuration","changed_group","changed_cache"].includes(kind)){
  f.state.protocol.body.plan_sha256=await hybridHash(f.state.protocol.body.plan);
  f.state.protocol.sha256=await hybridHash(f.state.protocol.body);
 }
 const http:typeof fetch=async(...args)=>{calls++;
  if(kind==="timeout_luna"||kind==="timeout_sol"&&f.state.operation.phase==="sol")throw Error("EXPLICIT_MOCK_TIMEOUT");
  const response=await f.http(...args);if(kind==="missing_usage"){const raw=JSON.parse(await response.text());delete raw.usage;return new Response(JSON.stringify(raw));}
  if(kind==="wrong_model"){const raw=JSON.parse(await response.text());raw.model="wrong-model";return new Response(JSON.stringify(raw));}
  if(kind==="provider_http")return new Response("EXPLICIT HTTP MOCK",{status:429});
  if(kind==="low_confidence"&&f.state.operation.phase==="luna"){const raw=JSON.parse(await response.text());raw.answers[0].confidence=.25;return new Response(JSON.stringify(raw));}
  if(kind==="invalid_sol"&&f.state.operation.phase==="sol")return new Response("{invalid mock");return response;};
 if(kind==="lost_receipt"){const receive=f.port.receive;f.port.receive=async(...args)=>{await receive(...args);return false;};}
 if(kind==="concurrent")await Promise.all(Array.from({length:8},()=>processContractV2(f.port,f.state.operation.id,"mock_key",http)));
 else await processContractV2(f.port,f.state.operation.id,"mock_key",http);
 if(kind==="changed_native"){
  await processContractV2(f.port,f.state.operation.id,"mock_key",http);
  f.state.operation.luna_result!.decisions[0].status="REJECTED";f.state.operation.luna_result_sha256=await hybridHash(f.state.operation.luna_result);
 }
 f.interrupt();for(let i=0;i<5;i++)await processContractV2(f.port,f.state.operation.id,"mock_key",http);
 if(calls>2||f.state.operation.luna_count>1||f.state.operation.sol_count>1)throw Error("RETRY_OR_DUPLICATE_"+kind);
 if(["permission","source","protocol","quote","resealed_quote","changed_configuration","changed_group","changed_cache"].includes(kind)&&calls!==0)throw Error("PREFLIGHT_NOT_BLOCKED_"+kind);
 if(["timeout_luna","missing_usage","wrong_model","provider_http","changed_native","lost_receipt"].includes(kind)&&calls!==1)throw Error("LUNA_FAILURE_MUST_NOT_REACH_SOL_"+kind);
 if(kind==="concurrent"&&calls!==2)throw Error("CONCURRENT_PATH_INCOMPLETE");
 if(kind==="low_confidence"&&(f.state.operation.luna_result?.decisions[0].status!=="UNCERTAIN"||f.state.operation.status!=="completed"))throw Error("LOW_CONFIDENCE_MUST_NOT_ACCEPT");
 checks.push({kind,status:f.state.operation.status,simulated_attempts:calls,provider_calls:0});
}
await Deno.writeTextFile(outPath,JSON.stringify({provider_calls:0,results,checks}));console.log(JSON.stringify({provider_calls:0,results,checks}));
