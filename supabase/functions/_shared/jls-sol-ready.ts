// Immutable Sol-only preparation. Compilation is offline; dispatch never tokenizes.
import {restaurantSol,restaurantConfiguration,verifyRestaurantProtocol,type RestaurantProtocol} from "./jls-restaurant.ts";
import {verifyPreparedArtifact,normalizedPlan,type PreparedRestaurantRow} from "./jls-restaurant-prepared.ts";
import {restaurantNativeDecisions,type RestaurantState} from "./jls-restaurant-worker.ts";
import {attachPlanTokenMemo,tokenCertificate,planTokenMemo,type TokenCertificate} from "./jls-token-memo.ts";
import {hybridHash} from "./jev-hybrid-evidence.ts";
import {negativeHash} from "./negative-validation-core.ts";
import {SOL_SIZE_POLICY,solRequestSize} from "./jls-sol-size.ts";
import type {JlsPlan,JlsDecision} from "./jev-luna-sol.ts";
export const SOL_READY_VERSION="jls-restaurant-sol-ready-vi-v1";
export const SOL_READY_ARTIFACT="jls-sol-final-request-v1";
export const SOL_READY_POLICY=Object.freeze({version:SOL_READY_ARTIFACT,stages:["sol","validate_sol"],
 maximum_stages_per_wake:1,raw_receipt_before_validation:true,dispatch_rebuilds:0,dispatch_tokenizations:0,
 max_jev_calls:0,max_luna_calls:0,max_sol_calls:1,automatic_retry:false,provider_client_retries:0,
 max_response_bytes:1048576,production_enabled:false});
export interface SolReadyBinding {version:string;artifact_sha256:string;source_protocol_id:string;source_protocol_sha256:string;source_run_id:string;
 source_decisions_sha256:string;request_sha256:string;measurement?:ReturnType<typeof solRequestSize>;}
export interface SolReadyArtifact {
 version:string;code_provenance:string;source_protocol_id:string;source_protocol_sha256:string;source_run_id:string;
 source_tasks:{task_id:string;review_id:string;request_sha256:string;artifact_sha256:string;response_sha256:string}[];
 source_decisions_artifact_sha256:string;decisions:JlsDecision[];decisions_sha256:string;
 plan:JlsPlan;plan_sha256:string;sol:Awaited<ReturnType<typeof restaurantSol>>;
 token_certificate:TokenCertificate;token_certificate_sha256:string;
 request_json:string;request_raw_sha256:string;request_sha256:string;measurement:ReturnType<typeof solRequestSize>;
}
export interface SolReadyRow {body:SolReadyArtifact;sha256:string}
export async function solReadyConfiguration(){const c=await restaurantConfiguration(SOL_SIZE_POLICY);
 return {...c,policy:{...c.policy,version:SOL_READY_VERSION,max_luna_calls:0},sol_ready_execution:SOL_READY_POLICY};}
export async function compileSolReady(s:RestaurantState&{prepared:PreparedRestaurantRow},code:string){
 if(s.run.status!=="blocked"||s.tasks.length!==28||s.tasks.some(t=>t.phase!=="luna"||t.status!=="completed"||t.request_count!==1))throw Error("JLS_SOL_READY_SOURCE_INCOMPLETE");
 await verifyRestaurantProtocol(s.protocol.body,s.protocol.sha256);
 for(const a of s.artifacts)if(await hybridHash(a.body)!==a.sha256)throw Error("JLS_SOURCE_ARTIFACT_CHANGED");
 const plan=await verifyPreparedArtifact(s.protocol.body,s.prepared),decisions=await restaurantNativeDecisions(s,plan);
 const saved=s.artifacts.find(a=>a.kind==="luna_decisions");
 if(!saved||await hybridHash(decisions)!==saved.body.decisions_sha256)throw Error("JLS_SOURCE_DECISIONS_CHANGED");
 await attachPlanTokenMemo(plan,s.prepared.body.token_certificate);
 const sol=await restaurantSol(plan,decisions);if(!sol.gate.passed||!sol.draft)throw Error("JLS_SOL_EVIDENCE_INSUFFICIENT");
 const token_certificate=await tokenCertificate(plan),request_json=JSON.stringify(sol.draft.request);
 const artifact:SolReadyArtifact={version:SOL_READY_ARTIFACT,code_provenance:code,source_protocol_id:s.protocol.id,
 source_protocol_sha256:s.protocol.sha256,source_run_id:s.run.id,source_decisions_artifact_sha256:saved.sha256,
 source_tasks:s.tasks.map(t=>{const a=s.artifacts.find(a=>a.kind==="task:"+t.id)!;return {task_id:t.id,review_id:t.review_id!,
 request_sha256:t.request_sha256,artifact_sha256:a.sha256,response_sha256:String(a.body.response_sha256)};}).sort((a,b)=>a.task_id.localeCompare(b.task_id)),
 decisions,decisions_sha256:await hybridHash(decisions),plan,plan_sha256:await hybridHash(plan),sol,
 token_certificate,token_certificate_sha256:await hybridHash(token_certificate),request_json,
 request_raw_sha256:await negativeHash(request_json),request_sha256:sol.draft.request_sha256,
 measurement:solRequestSize(sol.draft.request,SOL_SIZE_POLICY,planTokenMemo(plan)!.count)};
 const artifact_sha256=await hybridHash(artifact),configuration=await solReadyConfiguration();
 const body:RestaurantProtocol={...s.protocol.body,version:SOL_READY_VERSION,configuration,
 configuration_sha256:await hybridHash(configuration),max_jev_calls:0,max_luna_calls:0,pending:[],pending_sha256:await hybridHash([]),code_provenance:code,
 sol_ready:{version:SOL_READY_ARTIFACT,artifact_sha256,source_protocol_id:s.protocol.id,source_protocol_sha256:s.protocol.sha256,
 source_run_id:s.run.id,source_decisions_sha256:artifact.decisions_sha256,request_sha256:artifact.request_sha256,measurement:artifact.measurement}};
 return {protocol:{body,sha256:await hybridHash(body)},artifact:{body:artifact,sha256:artifact_sha256}};
}
export async function verifySolReadyProtocol(p:RestaurantProtocol,sha:string){
 if(p.version!==SOL_READY_VERSION||!p.sol_ready||p.sol_ready.version!==SOL_READY_ARTIFACT||
 await hybridHash(p)!==sha||await hybridHash(p.configuration)!==p.configuration_sha256||
 p.configuration_sha256!==await hybridHash(await solReadyConfiguration())||p.max_jev_calls!==0||p.max_luna_calls!==0||p.max_sol_calls!==1||
 p.pending.length||p.pending_sha256!==await hybridHash([])||p.cache_sha256!==await hybridHash(p.cache)||
 p.authority_user_id!==p.snapshot.created_by||p.organization_id!==p.snapshot.organization_id||p.establishment_id!==p.snapshot.establishment_id||
 p.preparation_is_not_spending_authorization!==true)throw Error("JLS_SOL_READY_PROTOCOL_CHANGED");
 // Reuse the full source/hash verifier, without reconstructing a dossier.
 const {verifyRestaurantSnapshot}=await import("./jls-restaurant.ts");await verifyRestaurantSnapshot(p.snapshot);
}
export async function verifySolReadyArtifact(p:RestaurantProtocol,row:SolReadyRow){
 const a=row.body,b=p.sol_ready;
 if(!b||a.version!==SOL_READY_ARTIFACT||row.sha256!==b.artifact_sha256||await hybridHash(a)!==row.sha256||
 a.source_protocol_id!==b.source_protocol_id||a.source_protocol_sha256!==b.source_protocol_sha256||a.source_run_id!==b.source_run_id||
 a.decisions_sha256!==b.source_decisions_sha256||await hybridHash(a.decisions)!==a.decisions_sha256||
 a.plan_sha256!==await hybridHash(a.plan)||a.plan.source_sha256!==p.snapshot.source_sha256||
 a.plan.organization_id!==p.organization_id||a.plan.establishment_id!==p.establishment_id||
 a.source_tasks.length!==28||new Set(a.source_tasks.map(t=>t.task_id)).size!==28||
 a.request_sha256!==b.request_sha256||!a.sol.gate.passed||!a.sol.draft||
 a.sol.draft.request_sha256!==a.request_sha256||await hybridHash(JSON.parse(a.request_json))!==a.request_sha256||
 await negativeHash(a.request_json)!==a.request_raw_sha256||a.token_certificate_sha256!==await hybridHash(a.token_certificate)||
 a.sol.draft.prompt_sha256!==p.configuration.sol_prompt_sha256||a.sol.draft.schema_sha256!==p.configuration.sol_schema_sha256||
 a.plan.statistics_sha256!==await hybridHash(a.plan.statistics)||a.code_provenance!==p.code_provenance||
 b.measurement&&await hybridHash(b.measurement)!==await hybridHash(a.measurement))throw Error("JLS_SOL_READY_ARTIFACT_CHANGED");
 const plan=normalizedPlan(a.plan);await attachPlanTokenMemo(plan,a.token_certificate,true);
 const measured=solRequestSize(JSON.parse(a.request_json),SOL_SIZE_POLICY,planTokenMemo(plan)!.count);
 if(await hybridHash(measured)!==await hybridHash(a.measurement))throw Error("JLS_SOL_READY_MEASUREMENT_CHANGED");
 for(const e of plan.selected){const r=p.snapshot.source.reviews.find(r=>r.id===e.review_id);
 if(!r||r.analysis_text_sha256!==e.analysis_text_sha256||r.analysis_text?.slice(e.quote_start,e.quote_end)!==e.quote||
 r.analysis_text.slice(e.context_start,e.context_end)!==e.context||await negativeHash(e.quote)!==e.quote_sha256)throw Error("JLS_SOL_READY_QUOTE_CHANGED");}
 return plan;
}
