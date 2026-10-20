// Scoped adapter for a second fixed historical corpus, using the existing queues,
// direct-four parser/selector/Luna contract and durable Sol receipt worker.
import {DIRECT_CONFIG,directCategoryPayload,directHash,directCanonical,parseDirectCategoriesRounded,directCategoryCounts} from './jev-direct-categories.ts';
import {analysisTextSha256} from './analysis-text.ts';
import {historicalSnapshotFingerprint,type FrozenHistorical} from './jls-snapshot-v2.ts';
import {prepareDirectReport,directAcceptedSol,validateDirectReport,parseDirectReportLuna,DIRECT_REPORT_POLICY,DIRECT_SYNTHESIS_VERSION,DIRECT_SYNTHESIS_POLICY,type DirectReportPreparation,type DirectReportInput,type DirectReportSourceBinding} from './jev-direct-report-preparation.ts';
import {DIRECT4_READY_VERSION,direct4ReadyContract,type Direct4Ready} from './jls-direct4-execution.ts';
import {attachPlanTokenMemo,tokenCertificate,planTokenMemo} from './jls-token-memo.ts';
import {SOL_SIZE_POLICY} from './jls-sol-size.ts';
import type {RestaurantProtocol} from './jls-restaurant.ts';
import type {RestaurantState,RestaurantExecutionContract} from './jls-restaurant-worker.ts';
import type {ReadyContract,ReadyState} from './jls-sol-ready-worker.ts';
import type {JlsPlan} from './jev-luna-sol.ts';

export const HISTORICAL_DIRECT4='jls-direct4-historical-v1';
export const FROZEN_CORPUS_DIRECT4='jls-direct4-frozen-corpus-v1';
export const BISTRO='6a53577a-c816-4548-845e-870995fbaed9';
export const BISTRO_HISTORY='fa55c8a5-f6e3-43df-a792-e9beed974457';
export const BISTRO_FINGERPRINT='929b2c3d97b83317c391e4b0a418771ea1b8d4c2eb4566375a52e7baac2077e7';
export const BISTRO_HISTORY_SHA='0d34685f8bba042afa53f7aab095516f21e17da27ea8390dacca7bbaf0eba46c';
function requestFromFrozenState(state:Record<string,unknown>){
 if(typeof state.review_alias!=='string'||typeof state.analysis_text!=='string')throw Error('DIRECT4_HISTORICAL_REQUEST_CHANGED');
 return directCategoryPayload(state.review_alias,state.analysis_text);
}
export interface HistoricalDirect4Input {historical:FrozenHistorical;published_report:unknown;record_sha256:string;existing_direct_cache_rows:number;existing_direct4_protocols:number;published_report_canonical?:string}
export async function prepareHistoricalDirect4(input:HistoricalDirect4Input,code:string,version:string=HISTORICAL_DIRECT4){
 const h=input.historical;
 const generic=version===FROZEN_CORPUS_DIRECT4;
 if(!generic&&version!==HISTORICAL_DIRECT4)throw Error('DIRECT4_PROTOCOL_VERSION_INVALID');
 if(!generic&&(h.id!==BISTRO_HISTORY||h.establishment_id!==BISTRO||
  input.record_sha256!==BISTRO_HISTORY_SHA||await historicalSnapshotFingerprint(h.snapshot)!==BISTRO_FINGERPRINT))throw Error('DIRECT4_HISTORICAL_SOURCE_CHANGED');
 if(h.status!=='completed'||h.language!=='vi'||h.snapshot.analysis_version!==7||
  await directHash(h)!==input.record_sha256||await historicalSnapshotFingerprint(h.snapshot)!==h.snapshot.base.source_fingerprint||
  !h.snapshot.reviews.length||new Set(h.snapshot.reviews.map(r=>r.id)).size!==h.snapshot.reviews.length||
  !generic&&h.snapshot.reviews.length!==100||!/^[a-f0-9]{40}$/.test(code))throw Error('DIRECT4_HISTORICAL_SOURCE_CHANGED');
 if(generic&&(!input.published_report_canonical||directCanonical(JSON.parse(input.published_report_canonical))!==directCanonical(input.published_report)))throw Error('DIRECT4_PUBLISHED_CANONICAL_REQUIRED');
 // There are no direct-four caches for this corpus. Do not borrow 25-theme results.
 if(input.existing_direct_cache_rows!==0||input.existing_direct4_protocols!==0)throw Error('DIRECT4_HISTORICAL_CACHE_REVIEW_REQUIRED');
 const reviews=await Promise.all(h.snapshot.reviews.map(async r=>{
  const hasText=!!(r.original_text??'').trim();
  if(hasText&&!r.analysis_text?.trim()||!hasText&&r.analysis_text?.trim())throw Error('DIRECT4_HISTORICAL_TEXT_REQUIRED');
  return {id:r.id,organization_id:h.organization_id,establishment_id:h.establishment_id,rating:r.rating,
   original_text:r.original_text??'',original_text_sha256:await analysisTextSha256(r.original_text??''),
   analysis_text:hasText?r.analysis_text:null,analysis_text_sha256:hasText?await analysisTextSha256(r.analysis_text):null,
   analysis_language:r.analysis_language,analysis_source:r.analysis_source,translation_provenance:{historical_run_id:h.id,
    source:r.analysis_source,original_language:r.original_language,frozen:true,provider_translation_id:null},
   review_detailed_rating:r.review_detailed_rating,review_context:r.review_context,published_at:r.published_at};
 }));
 const textual=reviews.filter(r=>r.analysis_text);
 if(!textual.length||!generic&&textual.length!==68)throw Error('DIRECT4_HISTORICAL_DENOMINATORS_CHANGED');
 if(generic&&textual.some(r=>r.analysis_language!=='en'||!['original_en','google_translation_en','verified_translation_override_en'].includes(r.analysis_source)))throw Error('DIRECT4_FROZEN_ENGLISH_REQUIRED');
 const source_snapshot={reviews,source_reviews_sha256:await directHash(reviews)};
 const pending=await Promise.all([...textual].sort((a,b)=>a.id.localeCompare(b.id)).map(async(r,n)=>{
  const payload=directCategoryPayload('review_'+String(n+1).padStart(3,'0'),r.analysis_text!);
  return {review_id:r.id,payload:{model:payload.model,state:payload.state},request_sha256:await directHash(payload),request_raw_sha256:await analysisTextSha256(JSON.stringify(payload)),
   identity:{configuration_id:DIRECT_CONFIG.id,configuration_sha256:await directHash(DIRECT_CONFIG),analysis_text_sha256:r.analysis_text_sha256,
    requested_model:DIRECT_CONFIG.requested_model,expected_served_model:'record_native_no_probe'}};
 }));
 const configuration={version,jev:DIRECT_CONFIG,jev_request_template:{questions:DIRECT_CONFIG.questions},
  ...(generic?{synthesis_version:DIRECT_SYNTHESIS_VERSION,synthesis_policy_sha256:await directHash(DIRECT_SYNTHESIS_POLICY)}:{}),
  direct_report_policy:DIRECT_REPORT_POLICY,policy:{language:'vi',automatic_retry:false,provider_client_retries:0,apify_calls:0},
  parser:'jev-direct-categories-parser-v1.1-rounding',stages:['jev','prepare_evidence','luna','prepare_sol','sol','validate_sol']};
 const body={version,organization_id:h.organization_id,establishment_id:h.establishment_id,authority_user_id:h.requested_by,
  language:'vi',historical:{id:h.id,generation_id:h.generation_id,record_sha256:input.record_sha256,source_fingerprint:h.snapshot.base.source_fingerprint,
   snapshot_sha256:await directHash(h.snapshot),published_report_sha256:generic?await analysisTextSha256(input.published_report_canonical!):await directHash(input.published_report)},
  ...(generic?{published_report_canonical:input.published_report_canonical}:{}),
  frozen_historical:h,frozen_published_report:input.published_report,source_snapshot,source_snapshot_sha256:await directHash(source_snapshot),
  configuration,configuration_sha256:await directHash(configuration),classification_configuration_sha256:await directHash(DIRECT_CONFIG),
  pending,pending_sha256:await directHash(pending),cache:[],cache_sha256:await directHash([]),
  denominators:{source_reviews:reviews.length,analytical_reviews:textual.length,textless_statistics_only:reviews.length-textual.length},
  non_english_frozen_review_ids:reviews.filter(r=>r.analysis_text&&r.analysis_language!=='en').map(r=>r.id),
  max_jev_calls:textual.length,max_luna_calls:32,max_sol_calls:1,max_apify_calls:0,sol_size_policy:SOL_SIZE_POLICY,
  automatic_retry:false,production_enabled:false,spending_authorization:null,run_id:null,provider_calls:0,
  code_provenance:code,preparation_is_not_spending_authorization:true};
 return {body,sha256:await directHash(body)};
}
export type HistoricalDirect4Protocol=Awaited<ReturnType<typeof prepareHistoricalDirect4>>;
export async function verifyHistoricalDirect4(p:HistoricalDirect4Protocol['body'],sha:string){
 const generic=p.version===FROZEN_CORPUS_DIRECT4,h=p.frozen_historical,all=p.source_snapshot.reviews,textual=all.filter(r=>r.analysis_text);
 if(!generic&&(p.version!==HISTORICAL_DIRECT4||p.establishment_id!==BISTRO||p.historical.id!==BISTRO_HISTORY||
  p.historical.record_sha256!==BISTRO_HISTORY_SHA||p.historical.source_fingerprint!==BISTRO_FINGERPRINT||p.pending.length!==68))throw Error('DIRECT4_HISTORICAL_PROTOCOL_CHANGED');
 const publishedHash=generic&&p.published_report_canonical?await analysisTextSha256(p.published_report_canonical):await directHash(p.frozen_published_report);
 if(generic&&(!p.published_report_canonical||directCanonical(JSON.parse(p.published_report_canonical))!==directCanonical(p.frozen_published_report)||
  p.historical.generation_id!==h.generation_id||p.configuration.version!==p.version||
  directCanonical(p.configuration.jev_request_template.questions)!==directCanonical(DIRECT_CONFIG.questions)||
  directCanonical(p.configuration.direct_report_policy)!==directCanonical(DIRECT_REPORT_POLICY)||
  p.cache.length!==0||p.cache_sha256!==await directHash([])||!/^[a-f0-9]{40}$/.test(p.code_provenance)||
  p.configuration.synthesis_version!==DIRECT_SYNTHESIS_VERSION||p.configuration.synthesis_policy_sha256!==await directHash(DIRECT_SYNTHESIS_POLICY)||
  !textual.length||p.denominators.source_reviews!==all.length||p.denominators.analytical_reviews!==textual.length||
  p.denominators.textless_statistics_only!==all.length-textual.length||all.length!==h.snapshot.reviews.length||
  new Set(all.map(r=>r.id)).size!==all.length||new Set(p.pending.map(t=>t.review_id)).size!==textual.length||p.pending.length!==textual.length||
  textual.some(r=>r.analysis_language!=='en'||!['original_en','google_translation_en','verified_translation_override_en'].includes(r.analysis_source))))throw Error('DIRECT4_FROZEN_PROTOCOL_CHANGED');
 if(await directHash(p)!==sha||p.establishment_id!==h.establishment_id||p.historical.id!==h.id||h.status!=='completed'||h.language!=='vi'||h.snapshot.analysis_version!==7||
  await directHash(h)!==p.historical.record_sha256||await directHash(h.snapshot)!==p.historical.snapshot_sha256||
  p.historical.source_fingerprint!==h.snapshot.base.source_fingerprint||await historicalSnapshotFingerprint(h.snapshot)!==p.historical.source_fingerprint||
  p.source_snapshot_sha256!==await directHash(p.source_snapshot)||p.source_snapshot.source_reviews_sha256!==await directHash(p.source_snapshot.reviews)||
  p.classification_configuration_sha256!==await directHash(DIRECT_CONFIG)||await directHash(p.configuration.jev)!==await directHash(DIRECT_CONFIG)||
  await directHash(p.configuration)!==p.configuration_sha256||await directHash(p.pending)!==p.pending_sha256||
  p.max_jev_calls!==p.pending.length||p.max_luna_calls!==32||p.max_sol_calls!==1||p.max_apify_calls!==0||
  p.automatic_retry!==false||p.production_enabled!==false||p.configuration.policy.provider_client_retries!==0||
  p.run_id!==null||p.spending_authorization!==null||p.authority_user_id!==p.frozen_historical.requested_by||
  p.organization_id!==p.frozen_historical.organization_id||p.historical.published_report_sha256!==publishedHash||
  await directHash(p.sol_size_policy)!==await directHash(SOL_SIZE_POLICY))throw Error('DIRECT4_HISTORICAL_PROTOCOL_CHANGED');
 for(const [n,r] of p.source_snapshot.reviews.entries()){
  const original=p.frozen_historical.snapshot.reviews[n];
  if(r.id!==original.id||r.original_text!==(original.original_text??'')||r.analysis_text!==(original.analysis_text.trim()?original.analysis_text:null)||
   r.rating!==original.rating||directCanonical(r.review_detailed_rating)!==directCanonical(original.review_detailed_rating)||directCanonical(r.review_context)!==directCanonical(original.review_context)||
   r.analysis_language!==original.analysis_language||r.analysis_source!==original.analysis_source||r.published_at!==original.published_at||
   generic&&directCanonical(r.translation_provenance)!==directCanonical({historical_run_id:h.id,source:original.analysis_source,original_language:original.original_language,frozen:true,provider_translation_id:null})||
   r.organization_id!==p.organization_id||r.establishment_id!==p.establishment_id||await analysisTextSha256(r.original_text)!==r.original_text_sha256||
   r.analysis_text&&await analysisTextSha256(r.analysis_text)!==r.analysis_text_sha256)throw Error('DIRECT4_HISTORICAL_TEXT_CHANGED');
 }
 for(const t of p.pending){const r=p.source_snapshot.reviews.find(r=>r.id===t.review_id),request=requestFromFrozenState(t.payload.state);
  if(!r?.analysis_text||t.payload.state.analysis_text!==r.analysis_text||t.payload.model!==DIRECT_CONFIG.requested_model||
   t.identity.configuration_sha256!==p.classification_configuration_sha256||t.identity.analysis_text_sha256!==r.analysis_text_sha256||
   t.identity.requested_model!==DIRECT_CONFIG.requested_model||t.identity.expected_served_model!=='record_native_no_probe'||
   await directHash(request)!==t.request_sha256||await analysisTextSha256(JSON.stringify(request))!==t.request_raw_sha256)throw Error('DIRECT4_HISTORICAL_REQUEST_CHANGED');}
}
const protocol=(s:RestaurantState)=>s.protocol.body as unknown as HistoricalDirect4Protocol['body'];
export function historicalDirect4Contract(preparation?:DirectReportPreparation):RestaurantExecutionContract{return {
 frozenAnalysisSource:true,verify:async(p,sha)=>verifyHistoricalDirect4(p as unknown as HistoricalDirect4Protocol['body'],sha),
 requestWire:(_s,t)=>{
  if(t.phase!=='jev')return JSON.stringify(t.request);
  const q=t.request as ReturnType<typeof directCategoryPayload>,wire=requestFromFrozenState(q.state);
  if(directCanonical(q)!==directCanonical(wire))throw Error('DIRECT4_HISTORICAL_REQUEST_CHANGED');
  return JSON.stringify(wire);
 },
 parseJev:async(_s,_t,raw)=>({direct4_result:parseDirectCategoriesRounded(raw)}),
 parseLuna:async(_s,t,raw)=>{const g=preparation?.body.luna_groups.find(g=>g.review_id===t.review_id);
  if(!g||t.request_sha256!==g.request_sha256)throw Error('DIRECT4_HISTORICAL_LUNA_MANIFEST_CHANGED');
  const result=await parseDirectReportLuna(g,raw);return {direct4_result:result,decisions:result.decisions};},
 completed:async(s,w,port)=>{
  if(s.run.stage==='jev'){if(!await port.stage(s.run.id,w,'prepare_evidence',[]))throw Error('DIRECT4_HISTORICAL_STAGE_FAILED');return;}
  if(s.run.stage!=='luna'||!preparation)throw Error('DIRECT4_HISTORICAL_STAGE_INVALID');
  const results=await historicalLunaResults(s,preparation),body={results,results_sha256:await directHash(results)};
  if(!await port.artifact(s.run.id,w,'luna_decisions',body,await directHash(body))||!await port.stage(s.run.id,w,'prepare_sol',[]))throw Error('DIRECT4_HISTORICAL_STAGE_FAILED');
 }};}
export async function compileHistoricalDirect4Evidence(s:RestaurantState){
 const p=protocol(s);await verifyHistoricalDirect4(p,s.protocol.sha256);
 const rows=[];
 for(const t of p.pending){const source=p.source_snapshot.reviews.find(r=>r.id===t.review_id)!,task=s.tasks.find(x=>x.phase==='jev'&&x.review_id===t.review_id),
  a=s.artifacts.find(x=>x.kind==='task:'+task?.id);
  if(!task||task.status!=='completed'||task.request_count!==1||!a||await directHash(a.body)!==a.sha256||task.request_sha256!==t.request_sha256||
   typeof a.body.raw_response_text!=='string'||await analysisTextSha256(a.body.raw_response_text)!==a.body.raw_response_sha256)throw Error('DIRECT4_HISTORICAL_JEV_INCOMPLETE');
  const result=parseDirectCategoriesRounded(JSON.parse(a.body.raw_response_text));
  if(directCanonical(result)!==directCanonical(a.body.direct4_result))throw Error('DIRECT4_HISTORICAL_JEV_RESULT_CHANGED');
  rows.push({review_id:t.review_id,analysis_text:source.analysis_text!,analysis_text_sha256:source.analysis_text_sha256!,
   analysis_language:source.analysis_language??'und',organization_id:p.organization_id,establishment_id:p.establishment_id,
   result,result_sha256:await directHash(result),raw_response_text:a.body.raw_response_text,response_raw_sha256:String(a.body.raw_response_sha256),
   translation_source:source.analysis_source,translation_provenance:source.translation_provenance,receipt_id:task.id});
 }
 const datasetBody={version:'jev-direct-categories4-dataset-v1',configuration_id:DIRECT_CONFIG.id,configuration_sha256:await directHash(DIRECT_CONFIG),
  reviews:rows,counts:directCategoryCounts(rows.map(r=>r.review_id),rows)};
 const dataset={id:s.run.id,protocol_id:s.protocol.id,organization_id:p.organization_id,body:datasetBody,sha256:await directHash(datasetBody)},
 snapshot={id:s.protocol.id,protocol_id:s.protocol.id,organization_id:p.organization_id,body:p.source_snapshot,sha256:p.source_snapshot_sha256};
 const binding:DirectReportSourceBinding={dataset_id:dataset.id,dataset_sha256:dataset.sha256,snapshot_id:snapshot.id,snapshot_sha256:snapshot.sha256,source_reviews:p.denominators.source_reviews,text_reviews:p.denominators.analytical_reviews};
 const prepared=await prepareDirectReport({dataset,snapshot,prior_luna_requests:[]} as DirectReportInput,p.code_provenance,binding,p.version===FROZEN_CORPUS_DIRECT4?DIRECT_SYNTHESIS_VERSION:undefined);
 return {dataset,preparation:prepared,binding,jev_source_tasks:s.tasks.filter(t=>t.phase==='jev').map(t=>({task_id:t.id,request_sha256:t.request_sha256,
  artifact_sha256:s.artifacts.find(a=>a.kind==='task:'+t.id)!.sha256})),protocol_sha256:s.protocol.sha256};
}
export type HistoricalDirectEvidence=Awaited<ReturnType<typeof compileHistoricalDirect4Evidence>>;
export async function historicalLunaResults(s:RestaurantState,p:DirectReportPreparation){
 const results=[];
 for(const g of p.body.luna_groups){const t=s.tasks.find(t=>t.phase==='luna'&&t.review_id===g.review_id),a=s.artifacts.find(a=>a.kind==='task:'+t?.id);
  if(!t||t.status!=='completed'||t.request_count!==1||t.request_sha256!==g.request_sha256||!a||await directHash(a.body)!==a.sha256||
   typeof a.body.raw_response_text!=='string'||await analysisTextSha256(a.body.raw_response_text)!==a.body.raw_response_sha256)throw Error('DIRECT4_HISTORICAL_LUNA_INCOMPLETE');
  const native=await parseDirectReportLuna(g,JSON.parse(a.body.raw_response_text));
  if(directCanonical(native)!==directCanonical(a.body.direct4_result))throw Error('DIRECT4_HISTORICAL_LUNA_CHANGED');results.push(native);
 }return results;
}
export async function compileHistoricalDirect4Sol(s:RestaurantState){
 const p=protocol(s);await verifyHistoricalDirect4(p,s.protocol.sha256);
 const a=s.artifacts.find(a=>a.kind==='direct4_report_preparation');
 if(!a||a.sha256!==await directHash(a.body))throw Error('DIRECT4_HISTORICAL_PREPARATION_MISSING');
 const prep=a.body as unknown as DirectReportPreparation;
 if(prep.sha256!==await directHash(prep.body))throw Error('DIRECT4_HISTORICAL_PREPARATION_CHANGED');
 const results=await historicalLunaResults(s,prep),memo=await attachPlanTokenMemo(prep.body),branch=await directAcceptedSol(prep,results,memo.count);
 if(!branch.draft)throw Error('DIRECT4_HISTORICAL_EVIDENCE_INSUFFICIENT');
 const request_json=JSON.stringify(branch.draft.request),cert=await tokenCertificate(prep.body);
 const body={version:DIRECT4_READY_VERSION,source_protocol_id:s.protocol.id,source_protocol_sha256:s.protocol.sha256,source_run_id:s.run.id,
  preparation:prep,preparation_artifact_sha256:a.sha256,results,results_sha256:await directHash(results),source_tasks:s.tasks.filter(t=>t.phase==='luna').map(t=>({task_id:t.id,review_id:t.review_id,request_sha256:t.request_sha256,artifact_sha256:s.artifacts.find(a=>a.kind==='task:'+t.id)!.sha256})),
  sol:{gate:branch.gate,draft:branch.draft},request_json,request_sha256:await directHash(branch.draft.request),request_raw_sha256:await analysisTextSha256(request_json),
  measurement:branch.draft.measurement,token_certificate:cert,token_certificate_sha256:await directHash(cert)};
 return {body,sha256:await directHash(body)};
}
export async function verifyHistoricalDirect4Ready(s:ReadyState){
 const p=s.protocol.body as unknown as HistoricalDirect4Protocol['body'];await verifyHistoricalDirect4(p,s.protocol.sha256);
 const a=s.ready as unknown as Direct4Ready,b=a.body,prep=b.preparation;
 if(a.sha256!==await directHash(b)||b.source_protocol_sha256!==s.protocol.sha256||prep.sha256!==await directHash(prep.body)||
  prep.body.source_snapshot.sha256!==p.source_snapshot_sha256||prep.body.source_snapshot.id!==s.protocol.id||
  prep.body.organization_id!==p.organization_id||prep.body.establishment_id!==p.establishment_id||
  prep.body.statistics.scope.analysed_text_reviews!==p.denominators.analytical_reviews||prep.body.statistics.scope.source_reviews!==p.denominators.source_reviews||
  p.version===FROZEN_CORPUS_DIRECT4&&prep.body.version!==DIRECT_SYNTHESIS_VERSION||
  await analysisTextSha256(b.request_json)!==b.request_raw_sha256||await directHash(JSON.parse(b.request_json))!==b.request_sha256||
  await directHash(b.results)!==b.results_sha256||await directHash(b.token_certificate)!==b.token_certificate_sha256)throw Error('DIRECT4_HISTORICAL_READY_CHANGED');
 const memo=await attachPlanTokenMemo(prep.body,b.token_certificate,true),branch=await directAcceptedSol(prep,b.results,memo.count,b.request_json);
 if(!branch.gate.passed||!branch.draft||await directHash(branch.draft)!==await directHash(b.sol.draft))throw Error('DIRECT4_HISTORICAL_SOL_BINDING_CHANGED');
 return prep.body as unknown as JlsPlan;
}
export const historicalDirect4ReadyContract:ReadyContract={verify:verifyHistoricalDirect4Ready,validate:async(raw,s,plan)=>{
 const a=(s.ready as unknown as Direct4Ready).body;
 return await validateDirectReport(raw,a.preparation,a.results,planTokenMemo(plan)!.count,a.request_json) as unknown as Awaited<ReturnType<ReadyContract['validate']>>;
},reportItems:direct4ReadyContract.reportItems};
export const asRestaurantProtocol=(p:HistoricalDirect4Protocol['body'])=>p as unknown as RestaurantProtocol;
