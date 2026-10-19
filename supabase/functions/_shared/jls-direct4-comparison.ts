// A versioned preparation/contract over the existing restaurant and Sol-ready workers.
import {directHash,directCanonical} from './jev-direct-categories.ts';
import {analysisTextSha256} from './analysis-text.ts';
import {DIRECT_SYNTHESIS_VERSION,DIRECT_COMPARISON_SELECTION,prepareDirectReport,directReportLunaGroups,
 directAcceptedSol,parseDirectReportLuna,validateDirectReport,type DirectReportInput,type DirectReportPreparation,
 type DirectLunaResult,type DirectReportSourceBinding} from './jev-direct-report-preparation.ts';
import {attachPlanTokenMemo,tokenCertificate,planTokenMemo} from './jls-token-memo.ts';
import {SOL_SIZE_POLICY} from './jls-sol-size.ts';
import {direct4ReadyContract} from './jls-direct4-execution.ts';
import type {RestaurantState,RestaurantExecutionContract} from './jls-restaurant-worker.ts';
import type {RestaurantProtocol} from './jls-restaurant.ts';
import type {ReadyContract,ReadyState} from './jls-sol-ready-worker.ts';
import type {JlsPlan} from './jev-luna-sol.ts';
export const DIRECT4_COMPARISON='jls-direct4-synthesis-comparison-v1';
export const COMPARISON_SOURCE='16f110ba-78ad-4eab-8568-33d476dd4641';
export interface ComparisonSource {id:string;sha256:string;organization_id:string;body:{run:{id:string;protocol_id:string;organization_id:string};
 source_reference:unknown;source_snapshot:DirectReportInput['snapshot']['body'];jev_dataset:DirectReportInput['dataset'];
 report_preparation:DirectReportPreparation;luna_results:DirectLunaResult[];sol_result:unknown;[key:string]:unknown}}
export async function prepareDirect4Comparison(a:ComparisonSource,authority:string,code:string){
 if(a.id!==COMPARISON_SOURCE||await directHash(a.body)!==a.sha256||a.organization_id!==a.body.run.organization_id||!/^[a-f0-9]{40}$/.test(code))throw Error('DIRECT_COMPARISON_SOURCE_CHANGED');
 const old=a.body.report_preparation,oldBranch=await directAcceptedSol(old,a.body.luna_results);
 const input:DirectReportInput={dataset:a.body.jev_dataset,snapshot:{id:a.body.run.protocol_id,protocol_id:a.body.run.protocol_id,
  organization_id:a.organization_id,body:a.body.source_snapshot,sha256:old.body.source_snapshot.sha256},prior_luna_requests:[]};
 const binding:DirectReportSourceBinding={dataset_id:input.dataset.id,dataset_sha256:input.dataset.sha256,snapshot_id:input.snapshot.id,
  snapshot_sha256:input.snapshot.sha256,source_reviews:100,text_reviews:68};
 const first=await prepareDirectReport(input,code,binding,DIRECT_SYNTHESIS_VERSION);
 const reused=oldBranch.accepted.map(e=>e.evidence_id);
 const missing=first.body.selection.candidates.filter(e=>e.polarity==='negative'&&!old.body.selection.selected.some(s=>s.evidence_id===e.evidence_id));
 const preparation=await prepareDirectReport(input,code,binding,DIRECT_SYNTHESIS_VERSION,[...reused,...missing.map(e=>e.evidence_id)]);
 const sourceGroups=old.body.luna_groups.filter(g=>g.evidence_ids.every(id=>reused.includes(id)));
 if(sourceGroups.flatMap(g=>g.evidence_ids).length!==reused.length)throw Error('DIRECT_COMPARISON_PARTIAL_SOURCE_GROUP');
 const reused_results=a.body.luna_results.filter(r=>sourceGroups.some(g=>g.request_sha256===r.request_sha256));
 for(const g of sourceGroups){
  const es=preparation.body.selection.selected.filter(e=>g.evidence_ids.includes(e.evidence_id));
  if(es.some(e=>e.quote!==e.context||g.analysis_text_sha256!==e.analysis_text_sha256||
   !g.quote_context_bindings.some(q=>q.evidence_id===e.evidence_id&&q.category===e.category&&q.polarity===e.polarity&&q.quote_sha256===e.quote_sha256&&q.context_sha256===e.analysis_text_sha256)))throw Error('DIRECT_COMPARISON_REUSE_CHANGED');
  const rebuilt=(await directReportLunaGroups(es))[0],saved=JSON.parse(g.payload.input),expected=JSON.parse(rebuilt.payload.input);
  if(g.payload.model!==rebuilt.payload.model||directCanonical({...saved,review_alias:expected.review_alias})!==directCanonical(expected)||directCanonical(g.payload.questions)!==directCanonical(rebuilt.payload.questions))throw Error('DIRECT_COMPARISON_QUESTION_CHANGED');
 }
 const pending_groups=await directReportLunaGroups(preparation.body.selection.selected.filter(e=>missing.some(m=>m.evidence_id===e.evidence_id)));
 preparation.body.luna_groups=[...sourceGroups,...pending_groups];preparation.body.luna_groups_sha256=await directHash(preparation.body.luna_groups);
 preparation.body.max_luna_calls=pending_groups.length;preparation.body.compatibility.reused_verdicts=reused.length;
 preparation.sha256=await directHash(preparation.body);
 const configuration={version:DIRECT4_COMPARISON,synthesis:DIRECT_SYNTHESIS_VERSION,selection:DIRECT_COMPARISON_SELECTION,
  preparation_configuration_sha256:preparation.body.configuration_sha256,policy:{language:'vi',automatic_retry:false,provider_client_retries:0,apify_calls:0}};
 const body={version:DIRECT4_COMPARISON,organization_id:a.organization_id,establishment_id:old.body.establishment_id,authority_user_id:authority,
  language:'vi',source_archive_id:a.id,source_archive_sha256:a.sha256,source_protocol_id:a.body.run.protocol_id,source_run_id:a.body.run.id,
  source_dataset_sha256:a.body.jev_dataset.sha256,source_snapshot_sha256:input.snapshot.sha256,statistics_sha256:old.body.statistics_sha256,
  source_report_sha256:await directHash(a.body.sol_result),preparation,preparation_sha256:preparation.sha256,
  reused_results,reused_results_sha256:await directHash(reused_results),pending_groups,pending_groups_sha256:await directHash(pending_groups),
  reused_evidence_ids:reused,excluded_historical_decisions:oldBranch.decisions.filter(d=>d.status!=='ACCEPTED'),
  configuration,configuration_sha256:await directHash(configuration),pending:[],max_jev_calls:0,max_luna_calls:pending_groups.length,
  new_luna_questions:missing.length,max_sol_calls:1,max_apify_calls:0,sol_size_policy:SOL_SIZE_POLICY,
  automatic_retry:false,production_enabled:false,preparation_is_not_spending_authorization:true,spending_authorization:null,run_id:null,
  code_provenance:code};
 if(reused.length!==26||missing.length!==6||pending_groups.length!==4||preparation.body.selection.selected.length!==32)throw Error('DIRECT_COMPARISON_SCOPE_CHANGED');
 return {body,sha256:await directHash(body)};
}
export type Direct4Comparison=Awaited<ReturnType<typeof prepareDirect4Comparison>>;
export async function verifyDirect4Comparison(p:Direct4Comparison['body'],sha:string){
 if(p.version!==DIRECT4_COMPARISON||p.source_archive_id!==COMPARISON_SOURCE||await directHash(p)!==sha||
  p.preparation_sha256!==await directHash(p.preparation.body)||p.preparation.sha256!==p.preparation_sha256||
  p.preparation.body.synthesis?.version!==DIRECT_SYNTHESIS_VERSION||p.reused_results_sha256!==await directHash(p.reused_results)||
  p.pending_groups_sha256!==await directHash(p.pending_groups)||p.configuration_sha256!==await directHash(p.configuration)||
  p.max_jev_calls!==0||p.max_luna_calls!==4||p.new_luna_questions!==6||p.max_sol_calls!==1||p.max_apify_calls!==0||
  p.automatic_retry!==false||p.production_enabled!==false||p.configuration.policy.provider_client_retries!==0||
  p.reused_evidence_ids.length!==26||p.spending_authorization!==null||p.run_id!==null||
  p.preparation.body.statistics_sha256!==p.statistics_sha256||await directHash(p.sol_size_policy)!==await directHash(SOL_SIZE_POLICY))throw Error('DIRECT_COMPARISON_PROTOCOL_CHANGED');
 for(const g of p.pending_groups)if(g.payload.model!=='gpt-6-luna'||g.request_sha256!==await directHash(g.payload))throw Error('DIRECT_COMPARISON_REQUEST_CHANGED');
}
export function direct4ComparisonContract(p:Direct4Comparison['body']):RestaurantExecutionContract{return {
 frozenAnalysisSource:true,verify:async(raw,sha)=>verifyDirect4Comparison(raw as unknown as Direct4Comparison['body'],sha),
 parseLuna:async(_s,t,raw)=>{const g=p.pending_groups.find(g=>g.request_sha256===t.request_sha256&&g.review_id===t.review_id);
  if(!g)throw Error('DIRECT_COMPARISON_LUNA_MANIFEST_CHANGED');const native=await parseDirectReportLuna(g,raw);return {direct4_result:native,decisions:native.decisions};},
 completed:async(s,w,port)=>{const results=await comparisonNativeResults(s),body={results,results_sha256:await directHash(results)};
  if(s.run.stage!=='luna'||!await port.artifact(s.run.id,w,'luna_decisions',body,await directHash(body))||!await port.stage(s.run.id,w,'prepare_sol',[]))throw Error('DIRECT_COMPARISON_STAGE_FAILED');}
};}
export async function comparisonNativeResults(s:RestaurantState){
 const p=s.protocol.body as unknown as Direct4Comparison['body'];await verifyDirect4Comparison(p,s.protocol.sha256);const results=[...p.reused_results];
 for(const g of p.pending_groups){const t=s.tasks.find(t=>t.phase==='luna'&&t.review_id===g.review_id&&t.request_sha256===g.request_sha256),
  a=s.artifacts.find(a=>a.kind==='task:'+t?.id);
  if(!t||t.status!=='completed'||t.request_count!==1||!a||await directHash(a.body)!==a.sha256||typeof a.body.raw_response_text!=='string'||
   await analysisTextSha256(a.body.raw_response_text)!==a.body.raw_response_sha256)throw Error('DIRECT_COMPARISON_LUNA_INCOMPLETE');
  const native=await parseDirectReportLuna(g,JSON.parse(a.body.raw_response_text));
  if(directCanonical(native)!==directCanonical(a.body.direct4_result))throw Error('DIRECT_COMPARISON_NATIVE_CHANGED');results.push(native);
 }return results;
}
export async function compileDirect4ComparisonSol(s:RestaurantState){
 const p=s.protocol.body as unknown as Direct4Comparison['body'],results=await comparisonNativeResults(s),prep=p.preparation,
  memo=await attachPlanTokenMemo(prep.body),branch=await directAcceptedSol(prep,results,memo.count);
 if(!branch.draft)throw Error('DIRECT_COMPARISON_EVIDENCE_INSUFFICIENT');
 const request_json=JSON.stringify(branch.draft.request),cert=await tokenCertificate(prep.body),
  body={version:'jls-direct4-sol-ready-v1',source_protocol_id:s.protocol.id,source_protocol_sha256:s.protocol.sha256,source_run_id:s.run.id,
   preparation:prep,preparation_artifact_sha256:await directHash(prep),results,results_sha256:await directHash(results),
   source_tasks:s.tasks.filter(t=>t.phase==='luna').map(t=>({task_id:t.id,review_id:t.review_id,request_sha256:t.request_sha256,
    artifact_sha256:s.artifacts.find(a=>a.kind==='task:'+t.id)!.sha256})),
   sol:{gate:branch.gate,draft:branch.draft},request_json,request_sha256:await directHash(branch.draft.request),request_raw_sha256:await analysisTextSha256(request_json),
   measurement:branch.draft.measurement,token_certificate:cert,token_certificate_sha256:await directHash(cert)};
 return {body,sha256:await directHash(body)};
}
export const direct4ComparisonReadyContract:ReadyContract={verify:async(s:ReadyState)=>{
 const p=s.protocol.body as unknown as Direct4Comparison['body'];await verifyDirect4Comparison(p,s.protocol.sha256);
 const b=s.ready.body as unknown as Awaited<ReturnType<typeof compileDirect4ComparisonSol>>['body'];
 if(await directHash(b)!==s.ready.sha256||b.source_protocol_sha256!==s.protocol.sha256||b.preparation.sha256!==p.preparation_sha256||
  b.results_sha256!==await directHash(b.results)||b.token_certificate_sha256!==await directHash(b.token_certificate)||
  b.request_raw_sha256!==await analysisTextSha256(b.request_json)||b.request_sha256!==await directHash(JSON.parse(b.request_json)))throw Error('DIRECT_COMPARISON_READY_CHANGED');
 const memo=await attachPlanTokenMemo(b.preparation.body,b.token_certificate,true),branch=await directAcceptedSol(b.preparation,b.results,memo.count,b.request_json);
 if(!branch.draft||await directHash(branch.draft)!==await directHash(b.sol.draft))throw Error('DIRECT_COMPARISON_SOL_BINDING_CHANGED');
 return b.preparation.body as unknown as JlsPlan;
},validate:async(raw,s,plan)=>{
 const b=s.ready.body as unknown as Awaited<ReturnType<typeof compileDirect4ComparisonSol>>['body'];
 return await validateDirectReport(raw,b.preparation,b.results,planTokenMemo(plan)!.count,b.request_json) as unknown as Awaited<ReturnType<ReadyContract['validate']>>;
},reportItems:direct4ReadyContract.reportItems};
export const comparisonAsRestaurant=(p:Direct4Comparison['body'])=>p as unknown as RestaurantProtocol;
