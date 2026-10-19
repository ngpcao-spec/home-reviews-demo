// Versioned contract adapter over the existing restaurant queue and Sol worker.
// No transport, credential, authorization write or supplier dispatch is defined here.
import {directHash,directCanonical} from './jev-direct-categories.ts';
import {analysisTextSha256} from './analysis-text.ts';
import {directAcceptedSol,parseDirectReportLuna,validateDirectReport,type DirectReportPreparation,type DirectLunaResult} from './jev-direct-report-preparation.ts';
import {attachPlanTokenMemo,planTokenMemo,tokenCertificate} from './jls-token-memo.ts';
import {SOL_SIZE_POLICY} from './jls-sol-size.ts';
import {DECISIONS_RATE} from './decisions-config.ts';
import {restaurantConsent,type RestaurantProtocol} from './jls-restaurant.ts';
import type {RestaurantState,RestaurantExecutionContract} from './jls-restaurant-worker.ts';
import type {ReadyContract,ReadyState} from './jls-sol-ready-worker.ts';
import type {JlsPlan} from './jev-luna-sol.ts';

export const DIRECT4_WORKER_VERSION='jls-direct4-worker-v1';
export const DIRECT4_PROTOCOL_VERSION='jls-direct4-execution-v1';
export const DIRECT4_READY_VERSION='jls-direct4-sol-ready-v1';
export const DIRECT4_PREPARATION_ID='bace8577-e302-42fe-8625-ff9951c1c788';
export const DIRECT4_PREPARATION_SHA='4752a9a1e214633052a1138faa3b6ef45e487a8cbc040048c6ceaea3c6e0a813';
export async function verifyDirect4Preparation(p:DirectReportPreparation){
 if(p.sha256!==DIRECT4_PREPARATION_SHA||await directHash(p.body)!==p.sha256||p.body.max_jev_calls!==0||
  p.body.max_luna_calls!==32||p.body.max_sol_calls!==1||p.body.luna_questions!==32||p.body.language!=='vi'||
  p.body.spending_authorization!==null||p.body.run_id!==null)throw Error('DIRECT4_PREPARATION_CHANGED');
}
export async function direct4Protocol(p:DirectReportPreparation,authority:string,commit:string){
 await verifyDirect4Preparation(p);
 if(!/^[a-f0-9]{40}$/.test(commit)||!authority)throw Error('DIRECT4_PROVENANCE_REQUIRED');
 const configuration={preparation_configuration_sha256:p.body.configuration_sha256,worker_version:DIRECT4_WORKER_VERSION,
  policy:{language:'vi',automatic_retry:false,provider_client_retries:0,max_luna_calls:32,max_sol_calls:1,apify_calls:0}};
 const body={version:DIRECT4_PROTOCOL_VERSION,preparation_id:DIRECT4_PREPARATION_ID,preparation_sha256:p.sha256,
  organization_id:p.body.organization_id,establishment_id:p.body.establishment_id,authority_user_id:authority,language:'vi',
  max_jev_calls:0,max_luna_calls:32,max_sol_calls:1,pending:[],configuration,configuration_sha256:await directHash(configuration),
  sol_size_policy:SOL_SIZE_POLICY,code_provenance:commit,preparation_is_not_spending_authorization:true,production_enabled:false};
 return {body,sha256:await directHash(body)};
}
export type Direct4Protocol=Awaited<ReturnType<typeof direct4Protocol>>;
export async function verifyDirect4Protocol(p:Direct4Protocol['body'],sha:string){
 if(p.version!==DIRECT4_PROTOCOL_VERSION||await directHash(p)!==sha||p.preparation_id!==DIRECT4_PREPARATION_ID||
  p.preparation_sha256!==DIRECT4_PREPARATION_SHA||p.max_jev_calls!==0||p.max_luna_calls!==32||p.max_sol_calls!==1||p.pending.length||
  p.language!=='vi'||p.production_enabled!==false||p.configuration.policy.automatic_retry!==false||p.configuration.policy.provider_client_retries!==0||
  await directHash(p.configuration)!==p.configuration_sha256||await directHash(p.sol_size_policy)!==await directHash(SOL_SIZE_POLICY))throw Error('DIRECT4_PROTOCOL_CHANGED');
}
// Pure preparation only. Persisting this consent is a separate, authorized RPC.
export async function direct4Consent(p:Direct4Protocol['body'],sha:string,directGo:string,at:string){
 if(!directGo.includes(DIRECT4_PREPARATION_ID))throw Error('DIRECT4_GO_SCOPE_CHANGED');
 const consent=await restaurantConsent(p as unknown as RestaurantProtocol,sha,directGo,at,
  async(raw,hash)=>verifyDirect4Protocol(raw as unknown as Direct4Protocol['body'],hash));
 return {...consent,preparation_id:DIRECT4_PREPARATION_ID,preparation_sha256:p.preparation_sha256};
}
export async function direct4NativeResults(s:RestaurantState,p:DirectReportPreparation):Promise<DirectLunaResult[]>{
 const results:DirectLunaResult[]=[];
 for(const g of p.body.luna_groups){const t=s.tasks.find(t=>t.phase==='luna'&&t.review_id===g.review_id),a=s.artifacts.find(a=>a.kind==='task:'+t?.id);
  if(!t||!a||t.status!=='completed'||t.request_count!==1||t.request_sha256!==g.request_sha256||await directHash(a.body)!==a.sha256||
   typeof a.body.raw_response_text!=='string'||await analysisTextSha256(a.body.raw_response_text)!==a.body.raw_response_sha256)throw Error('DIRECT4_LUNA_INCOMPLETE');
  const native=await parseDirectReportLuna(g,JSON.parse(a.body.raw_response_text));
  if(directCanonical(native)!==directCanonical(a.body.direct4_result))throw Error('DIRECT4_NATIVE_RESULT_CHANGED');results.push(native);
 }
 return results;
}
export function direct4RestaurantContract(p:DirectReportPreparation):RestaurantExecutionContract{return {
 frozenAnalysisSource:true,
 verify:async(raw,sha)=>{await verifyDirect4Protocol(raw as unknown as Direct4Protocol['body'],sha);await verifyDirect4Preparation(p);},
 parseLuna:async(_s,t,raw)=>{const g=p.body.luna_groups.find(g=>g.review_id===t.review_id);
  if(!g||g.request_sha256!==t.request_sha256)throw Error('DIRECT4_REQUEST_CHANGED');
  const native=await parseDirectReportLuna(g,raw);return {direct4_result:native,decisions:native.decisions,cost_usd:native.usage.input_tokens*DECISIONS_RATE/1e6};},
 completed:async(s,w,port)=>{
  if(s.run.stage!=='luna')throw Error('DIRECT4_STAGE_INVALID');
  const results=await direct4NativeResults(s,p),decisions=results.flatMap(r=>r.decisions),body={results,results_sha256:await directHash(results),decisions,decisions_sha256:await directHash(decisions)};
  if(!await port.artifact(s.run.id,w,'luna_decisions',body,await directHash(body))||!await port.stage(s.run.id,w,'prepare_sol',[]))throw Error('DIRECT4_STAGE_SAVE_FAILED');
 }};}
// Free compilation outside the paid dispatch path, as for historical snapshot runs.
export async function compileDirect4Ready(s:RestaurantState,p:DirectReportPreparation){
 await verifyDirect4Preparation(p);await verifyDirect4Protocol(s.protocol.body as unknown as Direct4Protocol['body'],s.protocol.sha256);
 const results=await direct4NativeResults(s,p),memo=await attachPlanTokenMemo(p.body),branch=await directAcceptedSol(p,results,memo.count);
 if(!branch.draft)return {gate:branch.gate,artifact:null};
 const draft=branch.draft,request_json=JSON.stringify(draft.request),certificate=await tokenCertificate(p.body);
 const body={version:DIRECT4_READY_VERSION,source_protocol_id:s.protocol.id,source_protocol_sha256:s.protocol.sha256,source_run_id:s.run.id,
  preparation:p,results,results_sha256:await directHash(results),source_tasks:s.tasks.filter(t=>t.phase==='luna').map(t=>({task_id:t.id,
   review_id:t.review_id,request_sha256:t.request_sha256,artifact_sha256:s.artifacts.find(a=>a.kind==='task:'+t.id)!.sha256})),
  sol:{gate:branch.gate,draft},request_json,request_sha256:await directHash(draft.request),request_raw_sha256:await analysisTextSha256(request_json),
  measurement:draft.measurement,token_certificate:certificate,token_certificate_sha256:await directHash(certificate)};
 return {gate:branch.gate,artifact:{body,sha256:await directHash(body)}};
}
export type Direct4Ready=NonNullable<Awaited<ReturnType<typeof compileDirect4Ready>>['artifact']>;
export async function verifyDirect4Ready(s:ReadyState){
 const a=s.ready as unknown as Direct4Ready,p=a.body.preparation,b=a.body;
 await verifyDirect4Protocol(s.protocol.body as unknown as Direct4Protocol['body'],s.protocol.sha256);await verifyDirect4Preparation(p);
 if(a.sha256!==await directHash(b)||b.version!==DIRECT4_READY_VERSION||b.source_protocol_sha256!==s.protocol.sha256||
  await analysisTextSha256(b.request_json)!==b.request_raw_sha256||await directHash(JSON.parse(b.request_json))!==b.request_sha256||
  await directHash(b.results)!==b.results_sha256||await directHash(b.token_certificate)!==b.token_certificate_sha256)throw Error('DIRECT4_SOL_ARTIFACT_CHANGED');
 const memo=await attachPlanTokenMemo(p.body,b.token_certificate,true),branch=await directAcceptedSol(p,b.results,memo.count);
 if(!branch.gate.passed||!branch.draft||await directHash(branch.draft)!==await directHash(b.sol.draft)||
  await directHash(branch.gate)!==await directHash(b.sol.gate)||await directHash(branch.draft.request)!==b.request_sha256)throw Error('DIRECT4_SOL_BINDING_CHANGED');
 // Erased type adapter only: the actual object contains four categories, never theme projections.
 return p.body as unknown as JlsPlan;
}
export const direct4ReadyContract:ReadyContract={verify:verifyDirect4Ready,validate:async(raw,s,plan)=>{
 const a=(s.ready as unknown as Direct4Ready).body;
 return await validateDirectReport(raw,a.preparation,a.results,planTokenMemo(plan)!.count) as unknown as Awaited<ReturnType<ReadyContract['validate']>>;
},reportItems:validated=>{const v=validated as Awaited<ReturnType<typeof validateDirectReport>>;
 return [...v.report.categories,...v.report.positive_aspects,...v.report.negative_aspects,v.report.conclusion,...v.report.recommendations].map(()=>({status:'bound'}));}};
