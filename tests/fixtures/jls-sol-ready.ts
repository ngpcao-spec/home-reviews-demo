import {gardenFixture} from "./jls-restaurant";
import {processRestaurant} from "../../supabase/functions/_shared/jls-restaurant-worker";
import {solReadyConfiguration,SOL_READY_ARTIFACT,SOL_READY_VERSION,type SolReadyArtifact} from "../../supabase/functions/_shared/jls-sol-ready";
import {restaurantSol} from "../../supabase/functions/_shared/jls-restaurant";
import {normalizedPlan} from "../../supabase/functions/_shared/jls-restaurant-prepared";
import {attachPlanTokenMemo,tokenCertificate,planTokenMemo} from "../../supabase/functions/_shared/jls-token-memo";
import {hybridHash} from "../../supabase/functions/_shared/jev-hybrid-evidence";
import {negativeHash} from "../../supabase/functions/_shared/negative-validation-core";
import {solRequestSize,SOL_SIZE_POLICY} from "../../supabase/functions/_shared/jls-sol-size";
import {readyTechnicalResponse} from "../../supabase/functions/_shared/jls-sol-ready-probe";
import type {JlsPlan,JlsDecision} from "../../supabase/functions/_shared/jev-luna-sol";
import type {ReadyState,ReadyPort} from "../../supabase/functions/_shared/jls-sol-ready-worker";
let base:Promise<ReadyState>;
async function build():Promise<ReadyState>{
 const f=await gardenFixture();f.authorize();for(let i=0;i<4;i++)await processRestaurant(f.port,f.state.run.id,{jev:"mock",openai:"mock"},f.http);
 const plan=normalizedPlan(f.state.artifacts.find(a=>a.kind==="evidence_plan")!.body as unknown as JlsPlan);
 plan.sol_size_policy=SOL_SIZE_POLICY;
 const ds=f.state.artifacts.find(a=>a.kind==="sol_dossier")!.body.decisions as JlsDecision[];
 await attachPlanTokenMemo(plan);const sol=await restaurantSol(plan,ds);const cert=await tokenCertificate(plan),wire=JSON.stringify(sol.draft!.request);
 const sourceId=f.state.protocol.id,sourceSha=f.state.protocol.sha256,artifact:SolReadyArtifact={version:SOL_READY_ARTIFACT,code_provenance:"SYNTHETIC_ONLY",
 source_protocol_id:sourceId,source_protocol_sha256:sourceSha,source_run_id:f.state.run.id,
 source_tasks:Array.from({length:28},()=>({task_id:crypto.randomUUID(),review_id:crypto.randomUUID(),request_sha256:"mock",artifact_sha256:"mock",response_sha256:"mock"})),
 source_decisions_artifact_sha256:"mock",decisions:ds,decisions_sha256:await hybridHash(ds),plan,plan_sha256:await hybridHash(plan),sol,
 token_certificate:cert,token_certificate_sha256:await hybridHash(cert),request_json:wire,request_raw_sha256:await negativeHash(wire),request_sha256:sol.draft!.request_sha256,
 measurement:solRequestSize(sol.draft!.request,SOL_SIZE_POLICY,planTokenMemo(plan)!.count)};
 const artifactSha=await hybridHash(artifact),config=await solReadyConfiguration(),body={...f.state.protocol.body,version:SOL_READY_VERSION,configuration:config,
 configuration_sha256:await hybridHash(config),code_provenance:"SYNTHETIC_ONLY",max_jev_calls:0,max_luna_calls:0,pending:[],pending_sha256:await hybridHash([]),cache:f.cache,cache_sha256:await hybridHash(f.cache),
 sol_size_policy:SOL_SIZE_POLICY,sol_ready:{version:SOL_READY_ARTIFACT,artifact_sha256:artifactSha,source_protocol_id:sourceId,source_protocol_sha256:sourceSha,
 source_run_id:f.state.run.id,source_decisions_sha256:artifact.decisions_sha256,request_sha256:artifact.request_sha256}};
 return {operation:{id:crypto.randomUUID(),organization_id:body.organization_id,mode:"mock",run_id:null,phase:"sol",status:"queued",request_count:0,worker:null,
 receipt:null,receipt_sha256:null,result:null},protocol:{id:crypto.randomUUID(),body,sha256:await hybridHash(body)},ready:{body:artifact,sha256:artifactSha}};
}
export async function readyFixture(){
 base??=build();const state=structuredClone(await base);let leased=false,allowed=true,compatible=true,calls=0;
 const port:ReadyPort={
 load:async()=>structuredClone(state),active:async()=>{if(!allowed)throw Error("AUTHORIZATION_EXPIRED");},compatible:async()=>compatible,
 claim:async(_id,worker)=>{const o=state.operation;if(leased||["completed","needs_review","invalid_output","blocked","billing_uncertain"].includes(o.status))return null;
 if(o.phase==="sol"&&o.request_count){o.status="billing_uncertain";return null;}leased=true;o.worker=worker;o.status=o.phase==="sol"?"dispatched":"validating";
 if(o.phase==="sol")o.request_count=1;return structuredClone(o);},
 receive:async(_id,_worker,b,sha)=>{const o=state.operation;o.receipt=structuredClone(b);o.receipt_sha256=sha;o.phase="validate_sol";o.status=b.raw_response_text===null?"billing_uncertain":"received";o.worker=null;leased=false;return true;},
 finish:async(_id,_worker,status,b)=>{state.operation.result=structuredClone(b);state.operation.status=status;state.operation.worker=null;leased=false;return true;},
 abort:async(_id,_worker,error)=>{const o=state.operation;if(["completed","needs_review","invalid_output","blocked","billing_uncertain"].includes(o.status))return;
 o.status=o.request_count&&o.phase==="sol"?"billing_uncertain":"blocked";o.worker=null;leased=false;void error;}
 };
 const http:typeof fetch=async(_url,options)=>{calls++;if(!leased||options?.body!==state.ready.body.request_json)throw Error("NO_RESERVATION");
 return new Response(JSON.stringify(await readyTechnicalResponse(state.ready.body)));};
 return {state,port,http,calls:()=>calls,deny:()=>{allowed=false;},incompatible:()=>{compatible=false;},interrupt:()=>{leased=false;state.operation.worker=null;}};
}
