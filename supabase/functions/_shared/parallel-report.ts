// Versioned application adapter over the existing direct-four classifier,
// selector, restaurant queue and Sol receipt worker. No supplier transport here.
// deno-lint-ignore no-import-prefix
import {z} from 'npm:zod@4.6.5';
import {directCanonical,directHash,directCategoryCounts,parseDirectCategoriesRounded} from './jev-direct-categories.ts';
import {SHORT_CLASSIFIER_CONFIG} from './jev-direct-short-config.ts';
import {shortJev} from './direct4-short-comparison.ts';
import {analysisTextSha256} from './analysis-text.ts';
import {selectDirectReportSources,directReportResponse,directSynthesisStatistics,validateDirectReportEvidence,DIRECT_SYNTHESIS_VERSION,type DirectReportInput,type DirectReportEvidence} from './jev-direct-report-preparation.ts';
import {candidateInstructions} from './jls-direct4-candidates.ts';
import {attachPlanTokenMemo,tokenCertificate} from './jls-token-memo.ts';
import {SOL_SIZE_POLICY,solRequestSize} from './jls-sol-size.ts';
import type {RestaurantState,RestaurantExecutionContract} from './jls-restaurant-worker.ts';
import type {ReadyContract,ReadyState} from './jls-sol-ready-worker.ts';
import {COMPACT_SOL_WIRE,prepareCompactSolWire,verifyCompactSolWire,reconstructCompactSolResponse,compactSolResponse} from './parallel-sol-wire.ts';
import {evidenceSelectorBinding,verifyEvidenceSelector,type EvidenceSelectorVersion,type EvidenceSelectorBinding} from './report-evidence-selector.ts';
export const PARALLEL_REPORT='jls-direct4-parallel-no-luna-v1';
export const REFERENCE_DERIVATION='jls-direct4-reference-links-v1';
type SourceReview=DirectReportInput['snapshot']['body']['reviews'][number]&{analysis_language:string|null;analysis_source:string;translation_provenance:unknown};
export type ParallelHistory={id:string;organization_id:string;establishment_id:string;generation_id:string;status:string;snapshot:{reviews:Record<string,unknown>[];base:Record<string,unknown>}};
export type ParallelCurrent={id:string;organization_id:string;establishment_id:string;generation_id:string;preferred_language:string;stored_reviews_count:number;source_fingerprint:string;[key:string]:unknown};
export const CURRENT_V2='jev-short-sol-compact-v2';
export interface CurrentDelivery {version:typeof CURRENT_V2;source_run_id:string;generation_id:string;request_id:string}
export function validParallelDelivery(p:{production_enabled:boolean;current_delivery?:CurrentDelivery;reference:{historical_run_id:string;generation_id:string};frozen_report:{[key:string]:unknown}}){
 const d=p.current_delivery;
 return d? p.production_enabled===true&&d.version===CURRENT_V2&&d.source_run_id===p.reference.historical_run_id&&d.generation_id===p.reference.generation_id&&
 /^[a-f0-9-]{36}$/.test(d.request_id)&&p.frozen_report.ai_status==='source_frozen':p.production_enabled===false;
}
export async function parallelProtocol(report:ParallelCurrent,history:ParallelHistory,user:string,code:string,delivery?:CurrentDelivery,selectorVersion?:EvidenceSelectorVersion){
 if(history.status!==(delivery?'source_frozen':'completed')||delivery&&(delivery.source_run_id!==history.id||delivery.generation_id!==history.generation_id||delivery.version!==CURRENT_V2)||history.generation_id!==report.generation_id||history.organization_id!==report.organization_id||history.establishment_id!==report.establishment_id||
  !Array.isArray(history.snapshot.reviews)||history.snapshot.reviews.length!==report.stored_reviews_count||!history.snapshot.reviews.length||
  history.snapshot.base.source_fingerprint!==report.source_fingerprint||!['fr','vi'].includes(report.preferred_language)||!/^[a-f0-9]{40}$/.test(code))throw Error('PARALLEL_CORPUS_UNAVAILABLE');
 const reviews=await Promise.all(history.snapshot.reviews.map(async r=>{
  const original=delivery?(r.original_text??r.text??''):r.original_text??'';
  if(typeof r.id!=='string'||typeof r.analysis_text!=='string'||typeof original!=='string'||
   !!String(original).trim()!==!!r.analysis_text.trim())throw Error('PARALLEL_SOURCE_TEXT_UNAVAILABLE');
  return {id:r.id,organization_id:report.organization_id,establishment_id:report.establishment_id,rating:r.rating,
   original_text:original,original_text_sha256:await analysisTextSha256(String(original)),
   analysis_text:r.analysis_text.trim()?r.analysis_text:null,analysis_text_sha256:r.analysis_text.trim()?await analysisTextSha256(r.analysis_text):null,
   analysis_language:r.analysis_language,analysis_source:r.analysis_source,translation_provenance:{historical_run_id:history.id,source:r.analysis_source,original_language:r.original_language,frozen:true,provider_translation_id:null,...(r.analysis_translation_provenance&&typeof r.analysis_translation_provenance==='object'?r.analysis_translation_provenance:{} )},
   review_detailed_rating:r.review_detailed_rating,review_context:r.review_context,published_at:r.published_at} as SourceReview;
 }));
 if(new Set(reviews.map(r=>r.id)).size!==reviews.length)throw Error('PARALLEL_DUPLICATE_REVIEW');
 const textual=reviews.filter(r=>r.analysis_text),config=SHORT_CLASSIFIER_CONFIG,configHash=await directHash(config);
 const pending=await Promise.all(textual.map(async r=>{const payload=shortJev({review_alias:'review_'+r.id,analysis_text:r.analysis_text!});return {
  review_id:r.id,payload,request_sha256:await directHash(payload),request_raw_sha256:await analysisTextSha256(JSON.stringify(payload)),
  identity:{configuration_id:config.id,configuration_sha256:configHash,analysis_text_sha256:r.analysis_text_sha256,requested_model:'jev-1.13.0',expected_served_model:'jev-1.13.0'}};}));
 const source_snapshot={reviews,source_reviews_sha256:await directHash(reviews)};
 const configuration={version:PARALLEL_REPORT,jev:config,synthesis:DIRECT_SYNTHESIS_VERSION,reference_derivation:REFERENCE_DERIVATION,language:report.preferred_language,sol_wire_version:COMPACT_SOL_WIRE,
  evidence_selector:await evidenceSelectorBinding(selectorVersion) as EvidenceSelectorBinding|undefined,
  policy:{provider_client_retries:0,automatic_retry:false,apify_calls:0,luna_calls:0}};
 const body={version:PARALLEL_REPORT,organization_id:report.organization_id,establishment_id:report.establishment_id,authority_user_id:user,language:report.preferred_language,
  reference:{report_id:report.id,generation_id:report.generation_id,historical_run_id:history.id,source_fingerprint:report.source_fingerprint,report_sha256:await directHash(report)},
  frozen_report:report,source_snapshot,source_snapshot_sha256:await directHash(source_snapshot),configuration,configuration_sha256:await directHash(configuration),
  classification_configuration_sha256:configHash,pending,pending_sha256:await directHash(pending),cache:[],cache_sha256:await directHash([]),
  denominators:{source_reviews:reviews.length,analytical_reviews:textual.length,textless_statistics_only:reviews.length-textual.length},
  max_jev_calls:pending.length,max_luna_calls:0,max_sol_calls:1,max_apify_calls:0,automatic_retry:false,production_enabled:!!delivery,...(delivery?{current_delivery:delivery}:{}),sol_size_policy:SOL_SIZE_POLICY,code_provenance:code};
 return {body,sha256:await directHash(body)};
}
export type ParallelProtocol=Awaited<ReturnType<typeof parallelProtocol>>['body'];
export interface ParallelRuntimeCertificate {protocol_id:string;protocol_sha256:string;organization_id:string;establishment_id:string;authority_user_id:string;body:Record<string,unknown>;sha256:string}
// The server loads this immutable certificate itself; it is never client input.
// It attests the full source/request checks at sealing. Keep checking the whole
// protocol hash and every actual task payload/receipt in the shared worker.
export async function verifyParallelRuntime(p:ParallelProtocol,sha:string,protocolId:string,c:ParallelRuntimeCertificate){
 if(c.protocol_id!==protocolId||c.protocol_sha256!==sha||c.organization_id!==p.organization_id||c.establishment_id!==p.establishment_id||c.authority_user_id!==p.authority_user_id||
  c.body.version!=='parallel-runtime-certificate-v1'||c.body.protocol_id!==protocolId||c.body.protocol_sha256!==sha||c.body.organization_id!==p.organization_id||c.body.establishment_id!==p.establishment_id||c.body.authority_user_id!==p.authority_user_id||
  c.body.source_snapshot_sha256!==p.source_snapshot_sha256||c.body.configuration_sha256!==p.configuration_sha256||c.body.pending_sha256!==p.pending_sha256||c.sha256!==await directHash(c.body))throw Error('PARALLEL_RUNTIME_CERTIFICATE_CHANGED');
 if(await directHash(p)!==sha||p.version!==PARALLEL_REPORT||p.classification_configuration_sha256!==await directHash(SHORT_CLASSIFIER_CONFIG)||
  p.max_luna_calls!==0||p.max_sol_calls!==1||p.max_apify_calls!==0||p.automatic_retry!==false||!validParallelDelivery(p)||
  p.configuration.sol_wire_version!==undefined&&p.configuration.sol_wire_version!==COMPACT_SOL_WIRE||
  await directHash(p.sol_size_policy)!==await directHash(SOL_SIZE_POLICY))throw Error('PARALLEL_PROTOCOL_CHANGED');
 if(p.configuration.evidence_selector!==undefined){try{await verifyEvidenceSelector(p.configuration.evidence_selector);}catch{throw Error('PARALLEL_PROTOCOL_CHANGED');}}
}
export async function verifyParallelProtocol(p:ParallelProtocol,sha:string){
 if(p.configuration.evidence_selector!==undefined){try{await verifyEvidenceSelector(p.configuration.evidence_selector);}catch{throw Error('PARALLEL_EVIDENCE_SELECTOR_CHANGED');}}
 if(p.configuration.sol_wire_version!==undefined&&p.configuration.sol_wire_version!==COMPACT_SOL_WIRE)throw Error('PARALLEL_SOL_WIRE_VERSION_CHANGED');
 if(p.version!==PARALLEL_REPORT||await directHash(p)!==sha||p.configuration_sha256!==await directHash(p.configuration)||p.source_snapshot_sha256!==await directHash(p.source_snapshot)||
  p.classification_configuration_sha256!==await directHash(SHORT_CLASSIFIER_CONFIG)||directCanonical(p.configuration.jev)!==directCanonical(SHORT_CLASSIFIER_CONFIG)||
  p.pending_sha256!==await directHash(p.pending)||p.max_jev_calls!==p.pending.length||p.max_luna_calls!==0||p.max_sol_calls!==1||p.max_apify_calls!==0||p.automatic_retry!==false||!validParallelDelivery(p)||
  p.source_snapshot.source_reviews_sha256!==await directHash(p.source_snapshot.reviews)||p.reference.report_sha256!==await directHash(p.frozen_report)||
  p.denominators.source_reviews!==p.source_snapshot.reviews.length||p.denominators.analytical_reviews!==p.source_snapshot.reviews.filter(r=>r.analysis_text).length||
  p.denominators.textless_statistics_only+p.denominators.analytical_reviews!==p.denominators.source_reviews||new Set(p.pending.map(t=>t.review_id)).size!==p.pending.length||
  await directHash(p.sol_size_policy)!==await directHash(SOL_SIZE_POLICY))throw Error('PARALLEL_PROTOCOL_CHANGED');
 for(const r of p.source_snapshot.reviews){if(r.organization_id!==p.organization_id||r.establishment_id!==p.establishment_id||await analysisTextSha256(r.original_text)!==r.original_text_sha256||
   r.analysis_text&&await analysisTextSha256(r.analysis_text)!==r.analysis_text_sha256)throw Error('PARALLEL_SOURCE_CHANGED');}
 for(const t of p.pending){const r=p.source_snapshot.reviews.find(r=>r.id===t.review_id);if(!r?.analysis_text||t.request_sha256!==await directHash(shortJev({review_alias:'review_'+r.id,analysis_text:r.analysis_text}))||
   t.identity.configuration_sha256!==p.classification_configuration_sha256||t.identity.analysis_text_sha256!==r.analysis_text_sha256||t.identity.expected_served_model!=='jev-1.13.0')throw Error('PARALLEL_REQUEST_CHANGED');}
}
export const asParallel=(s:RestaurantState)=>s.protocol.body as unknown as ParallelProtocol;
export const parallelExecutionContract:RestaurantExecutionContract={frozenAnalysisSource:true,expectedRequestedModel:()=> 'jev-1.13.0',
 verify:(p,sha)=>verifyParallelProtocol(p as unknown as ParallelProtocol,sha),
 parseJev:(_s,_t,raw)=>{const result=parseDirectCategoriesRounded(raw);if(result.model!=='jev-1.13.0')throw Error('PARALLEL_SERVED_MODEL_CHANGED');return Promise.resolve({direct4_result:result});},
 completed:async(s,w,port)=>{if(s.run.stage!=='jev'||!await port.stage(s.run.id,w,'prepare_evidence',[]))throw Error('PARALLEL_STAGE_CHANGED');}};
export async function parallelSolEnvelope(s:RestaurantState,runtime?:ParallelRuntimeCertificate){
 const p=asParallel(s);if(runtime)await verifyParallelRuntime(p,s.protocol.sha256,s.protocol.id,runtime);else await verifyParallelProtocol(p,s.protocol.sha256);
 const rows:DirectReportInput['dataset']['body']['reviews']=[];
 for(const t of s.tasks.filter(t=>t.phase==='jev')){
  const r=p.source_snapshot.reviews.find(r=>r.id===t.review_id),a=s.artifacts.find(a=>a.kind==='task:'+t.id);
  if(!r?.analysis_text||!['completed','reused'].includes(t.status)||!a||a.sha256!==await directHash(a.body)||typeof a.body.raw_response_text!=='string')throw Error('PARALLEL_JEV_INCOMPLETE');
  const result=a.body.direct4_result as ReturnType<typeof parseDirectCategoriesRounded>;
  if(!result||result.model!=='jev-1.13.0')throw Error('PARALLEL_JEV_RESULT_CHANGED');
  // verifyDirectReportSources below parses the raw response, checks its hash,
  // compares the complete native result and checks every frozen text. Do it once.
  rows.push({review_id:r.id,organization_id:p.organization_id,establishment_id:p.establishment_id,analysis_text:r.analysis_text,analysis_text_sha256:r.analysis_text_sha256!,analysis_language:r.analysis_language??'und',
   result,result_sha256:await directHash(result),raw_response_text:a.body.raw_response_text,response_raw_sha256:String(a.body.raw_response_sha256),translation_source:r.analysis_source,
   translation_provenance:r.translation_provenance,receipt_id:t.id});
 }
 if(rows.length!==p.denominators.analytical_reviews||!rows.length)throw Error('PARALLEL_JEV_INCOMPLETE');
 const datasetBody={version:'jev-direct-categories4-dataset-v1',configuration_id:SHORT_CLASSIFIER_CONFIG.id,configuration_sha256:p.classification_configuration_sha256,reviews:rows,counts:directCategoryCounts(rows.map(r=>r.review_id),rows)};
 const dataset={id:s.run.id,protocol_id:s.protocol.id,organization_id:p.organization_id,body:datasetBody,sha256:await directHash(datasetBody)};
 const snapshot={id:s.protocol.id,protocol_id:s.protocol.id,organization_id:p.organization_id,body:p.source_snapshot,sha256:p.source_snapshot_sha256};
 const b=await selectDirectReportSources({dataset,snapshot,prior_luna_requests:[]},p.code_provenance,{dataset_id:dataset.id,dataset_sha256:dataset.sha256,snapshot_id:snapshot.id,snapshot_sha256:snapshot.sha256,
  source_reviews:p.denominators.source_reviews,text_reviews:rows.length,classification_configuration:{id:SHORT_CLASSIFIER_CONFIG.id,sha256:p.classification_configuration_sha256}},DIRECT_SYNTHESIS_VERSION,undefined,p.configuration.evidence_selector?.version);
 const evidence=b.selection.selected;
 if(!evidence.length)throw Error('PARALLEL_EVIDENCE_INSUFFICIENT');
 const legacyPacket={format_version:'jls-direct-categories4-report-v1',language:p.language,synthesis_version:DIRECT_SYNTHESIS_VERSION,
  statistics:directSynthesisStatistics(b.statistics),statistics_sha256:b.statistics_sha256,statistics_provenance:'automatic_jev_not_validated_by_sol',
  evidence:evidence.map(e=>({evidence_id:e.evidence_id,review_id:e.review_id,category:e.category,polarity:e.polarity,quote:e.quote,quote_sha256:e.quote_sha256,context_same_as_quote:e.context===e.quote,...(e.context===e.quote?{}:{context:e.context}),
   analysis_text_sha256:e.analysis_text_sha256,translation_source:e.translation_source,quote_start:e.quote_start,quote_end:e.quote_end,context_start:e.context_start,context_end:e.context_end})),
  original_reviews:b.synthesis!.originals,coverage:b.selection.coverage,scope:'UNVERIFIED_CUSTOMER_CANDIDATES_SOL_SELF_REVIEW'};
 const compact=p.configuration.sol_wire_version===COMPACT_SOL_WIRE?await prepareCompactSolWire({organization_id:p.organization_id,establishment_id:p.establishment_id,
  source_snapshot_sha256:p.source_snapshot_sha256,statistics:b.statistics,statistics_sha256:b.statistics_sha256,evidence,reviews:p.source_snapshot.reviews},p.language as 'fr'|'vi'):null;
 const packet=compact?.packet??legacyPacket;
 const prompt=compact?.prompt??(p.language==='fr'?candidateInstructions(b.statistics.scope).replaceAll('in Vietnamese','in French')+'\nWrite all restaurateur-facing prose in French. Keep schema keys unchanged.':candidateInstructions(b.statistics.scope));
 const {$schema:_,...schema}=z.toJSONSchema(compact?compactSolResponse:directReportResponse);
 const request={model:'gpt-6.1-sol',reasoning:{effort:'low'},max_output_tokens:SOL_SIZE_POLICY.max_output_tokens,input:[{role:'system',content:prompt},{role:'user',content:JSON.stringify(packet)}],text:{format:{type:'json_schema',name:compact?'jls_direct4_compact_sol_v1':'jls_direct_categories4_report_v1',strict:true,schema}}};
 const request_json=JSON.stringify(request);
 const classification_sources=s.tasks.filter(t=>t.phase==='jev').map(t=>{const a=s.artifacts.find(a=>a.kind==='task:'+t.id)!;return {task_id:t.id,review_id:t.review_id,artifact_sha256:a.sha256,result_sha256:rows.find(r=>r.review_id===t.review_id)!.result_sha256,reused:t.status==='reused'};});
 // Raw classifications already live in immutable task receipts. Bind their
 // manifest instead of copying all 75/100/500 raw answers into each Sol wake.
 const dataset_manifest={id:dataset.id,protocol_id:dataset.protocol_id,organization_id:dataset.organization_id,sha256:dataset.sha256,configuration_sha256:p.classification_configuration_sha256,review_count:rows.length};
 const selection={algorithm:b.selection.algorithm,algorithm_sha256:b.selection.algorithm_sha256,candidate_ids:b.selection.candidates.map(e=>e.evidence_id),coverage:b.selection.coverage,distinct_selected_reviews:b.selection.distinct_selected_reviews,
  ...(b.selection.coverage_diagnostics?{coverage_diagnostics:b.selection.coverage_diagnostics}:{})};
 const body={version:PARALLEL_REPORT,source_protocol_id:s.protocol.id,source_protocol_sha256:s.protocol.sha256,source_run_id:s.run.id,dataset:dataset_manifest,classification_sources,classification_sources_sha256:await directHash(classification_sources),statistics:b.statistics,statistics_sha256:b.statistics_sha256,
  evidence,selection,packet,...(compact?{compact_wire:compact.manifest,compact_wire_sha256:compact.manifest_sha256}:{}),prompt_sha256:await analysisTextSha256(prompt),schema_sha256:await directHash(schema),request_json,
  request_sha256:await directHash(request),request_raw_sha256:await analysisTextSha256(request_json)};
 return {body,sha256:await directHash(body)};
}
export async function measureParallelSolEnvelope(envelope:Awaited<ReturnType<typeof parallelSolEnvelope>>){
 const b=envelope.body,request=JSON.parse(b.request_json);
 if(b.version!==PARALLEL_REPORT||envelope.sha256!==await directHash(b)||b.request_raw_sha256!==await analysisTextSha256(b.request_json)||b.request_sha256!==await directHash(request))throw Error('PARALLEL_SOL_ENVELOPE_CHANGED');
 const memo=await attachPlanTokenMemo(b.packet),measurement=solRequestSize(request,SOL_SIZE_POLICY,memo.count),cert=await tokenCertificate(b.packet);
 const body={...b,measurement,token_certificate:cert,token_certificate_sha256:await directHash(cert)};
 return {body,sha256:await directHash(body)};
}
export async function compileParallelSol(s:RestaurantState){return await measureParallelSolEnvelope(await parallelSolEnvelope(s));}
export type ParallelReady=Awaited<ReturnType<typeof compileParallelSol>>;
type Report=ReturnType<typeof directReportResponse.parse>;
// Conservative link-only derivation: no free-text rewriting or replacement IDs.
export function deriveReferenceLinks(raw:unknown,evidence:DirectReportEvidence[]){
 const original=directReportResponse.parse(raw),derived=structuredClone(original),changes:{path:string;before:string[];after:string[];reason:string}[]=[],issues:{path:string;reason:string}[]=[];
 const dedup=(item:{evidence_ids:string[]},path:string)=>{const before=[...item.evidence_ids];item.evidence_ids=[...new Set(before)];if(before.length!==item.evidence_ids.length)changes.push({path,before,after:[...item.evidence_ids],reason:'duplicate_reference'});};
 derived.report.categories.forEach((x,i)=>dedup(x,`categories[${i}]`));derived.report.positive_aspects.forEach((x,i)=>dedup(x,`positive_aspects[${i}]`));derived.report.negative_aspects.forEach((x,i)=>dedup(x,`negative_aspects[${i}]`));dedup(derived.report.conclusion,'conclusion');
 derived.report.recommendations.forEach((r,i)=>{const path=`recommendations[${i}]`;dedup(r,path);const observed=new Set(r.observations.map(o=>o.evidence_id));
  if(r.observations.every(o=>{const e=evidence.find(e=>e.evidence_id===o.evidence_id);return e&&r.evidence_ids.includes(e.evidence_id)&&e.category===r.category&&e.quote===o.quote&&e.quote_sha256===o.quote_sha256;})){
   const before=[...r.evidence_ids];r.evidence_ids=r.evidence_ids.filter(id=>observed.has(id));if(before.length!==r.evidence_ids.length)changes.push({path,before,after:[...r.evidence_ids],reason:'reference_without_corresponding_observation'});
  }else issues.push({path,reason:'observation_coverage_not_established'});
 });
 for(const [key,polarity] of [['positive_aspects','positive'],['negative_aspects','negative']] as const)derived.report[key].forEach((item,i)=>{
  const path=`${key}[${i}]`,before=[...item.evidence_ids],valid=before.map(id=>evidence.find(e=>e.evidence_id===id)).filter((e):e is DirectReportEvidence=>!!e&&e.category===item.category&&e.polarity===polarity);
  const incompatible=before.filter(id=>!valid.some(e=>e.evidence_id===id));
  if(incompatible.length&&incompatible.every(id=>{const e=evidence.find(e=>e.evidence_id===id);return e&&valid.some(v=>v.category===e.category&&v.review_id===e.review_id&&v.quote===e.quote&&v.context===e.context);})){item.evidence_ids=valid.map(e=>e.evidence_id);changes.push({path,before,after:[...item.evidence_ids],reason:'extra_incompatible_polarity_same_review_and_identical_text'});}
  else if(incompatible.length)issues.push({path,reason:'remaining_passage_coverage_not_established'});
 });
 return {version:REFERENCE_DERIVATION,original,derived,changes,issues,human_validated:false,semantic_correctness_guaranteed:false};
}
export async function validateParallelReport(raw:unknown,ready:ParallelReady['body']){
 const d=deriveReferenceLinks(raw,ready.evidence);
 // Exact quotation and statistics checks remain mandatory, including on failure.
 if(d.derived.statistics_sha256!==ready.statistics_sha256)throw Error('DIRECT_REPORT_STATISTICS_OR_CATEGORIES_CHANGED');
 for(const r of d.derived.report.recommendations)for(const o of r.observations){const e=ready.evidence.find(e=>e.evidence_id===o.evidence_id);if(!e||o.quote!==e.quote||o.quote_sha256!==e.quote_sha256||await analysisTextSha256(o.quote)!==o.quote_sha256)throw Error('DIRECT_REPORT_QUOTE_CHANGED');}
 const inspect=(item:{evidence_ids:string[];category?:string;text?:string},path:string,polarity?:string)=>{
  const valid=item.evidence_ids.length>0&&item.evidence_ids.every(id=>ready.evidence.some(e=>e.evidence_id===id&&(!item.category||e.category===item.category)&&(!polarity||e.polarity===polarity)));
  if(!valid&&!(path.startsWith('categories[')&&!item.evidence_ids.length&&item.text==='Chưa đủ căn cứ từ các ý kiến được cung cấp cho nhóm này.'))
   if(!d.issues.some(i=>i.path===path))d.issues.push({path,reason:'remaining_passage_coverage_not_established'});
 };
 d.derived.report.categories.forEach((s,i)=>inspect(s,`categories[${i}]`));d.derived.report.positive_aspects.forEach((s,i)=>inspect(s,`positive_aspects[${i}]`,'positive'));
 d.derived.report.negative_aspects.forEach((s,i)=>inspect(s,`negative_aspects[${i}]`,'negative'));inspect(d.derived.report.conclusion,'conclusion');d.derived.report.recommendations.forEach((s,i)=>inspect(s,`recommendations[${i}]`));
 let error:string|null=null;
 try{await validateDirectReportEvidence(d.derived,ready.statistics_sha256,ready.evidence,true);}catch(e){error=e instanceof Error?e.message:'DIRECT_REPORT_INVALID';}
 const {original:_,derived:__,...derivation}=d;
 return {...d.derived,original_report:d.original,reference_derivation:derivation,original_report_sha256:await directHash(d.original),derived_report_sha256:await directHash(d.derived),
  server_statistics:ready.statistics,validator_version:REFERENCE_DERIVATION,technical_checks_passed:error===null,validation_error:error,
  section_issues:d.issues,human_validated:false,semantic_correctness_guaranteed:false};
}
export const parallelReadyContract:ReadyContract={verify:async(s:ReadyState)=>{
 const p=s.protocol.body as unknown as ParallelProtocol,b=s.ready.body as unknown as ParallelReady['body'];await verifyParallelProtocol(p,s.protocol.sha256);
 if(await directHash(b)!==s.ready.sha256||b.source_protocol_id!==s.protocol.id||b.source_protocol_sha256!==s.protocol.sha256||b.source_run_id!==s.operation.run_id||
  b.dataset.id!==s.operation.run_id||b.dataset.protocol_id!==s.protocol.id||b.dataset.configuration_sha256!==p.classification_configuration_sha256||b.dataset.review_count!==p.denominators.analytical_reviews||
  b.classification_sources.length!==b.dataset.review_count||b.classification_sources_sha256!==await directHash(b.classification_sources)||
  await directHash(b.statistics)!==b.statistics_sha256||await directHash(JSON.parse(b.request_json))!==b.request_sha256||await analysisTextSha256(b.request_json)!==b.request_raw_sha256||
  await directHash(b.token_certificate)!==b.token_certificate_sha256)throw Error('PARALLEL_SOL_READY_CHANGED');
 if(p.configuration.evidence_selector&&(b.selection.algorithm!==p.configuration.evidence_selector.version||
  b.selection.algorithm_sha256!==p.configuration.evidence_selector.sha256))throw Error('PARALLEL_EVIDENCE_SELECTOR_CHANGED');
 const request=JSON.parse(b.request_json);if(request.model!=='gpt-6.1-sol'||request.reasoning?.effort!=='low'||directCanonical(JSON.parse(request.input[1].content))!==directCanonical(b.packet)||await analysisTextSha256(request.input[0].content)!==b.prompt_sha256||await directHash(request.text.format.schema)!==b.schema_sha256)throw Error('PARALLEL_SOL_REQUEST_CHANGED');
 const memo=await attachPlanTokenMemo(b.packet,b.token_certificate,true);solRequestSize(request,SOL_SIZE_POLICY,memo.count);
 for(const e of b.evidence){const r=p.source_snapshot.reviews.find(r=>r.id===e.review_id);if(!r?.analysis_text||r.analysis_text_sha256!==e.analysis_text_sha256||r.analysis_text.slice(e.quote_start,e.quote_end)!==e.quote||r.analysis_text.slice(e.context_start,e.context_end)!==e.context||await analysisTextSha256(e.quote)!==e.quote_sha256)throw Error('PARALLEL_EVIDENCE_CHANGED');}
 if(p.configuration.sol_wire_version===COMPACT_SOL_WIRE){
  if(!b.compact_wire||!b.compact_wire_sha256)throw Error('COMPACT_SOL_BINDINGS_CHANGED');
  await verifyCompactSolWire({organization_id:p.organization_id,establishment_id:p.establishment_id,source_snapshot_sha256:p.source_snapshot_sha256,
   statistics:b.statistics,statistics_sha256:b.statistics_sha256,evidence:b.evidence,reviews:p.source_snapshot.reviews},p.language as 'fr'|'vi',b.compact_wire,b.compact_wire_sha256,b.packet);
 }else if(b.compact_wire)throw Error('COMPACT_SOL_BINDINGS_CHANGED');
 return b.packet as unknown as Awaited<ReturnType<ReadyContract['verify']>>;
},validate:async(raw,s)=>{
 const ready=s.ready.body as unknown as ParallelReady['body'];
 const reconstructed=ready.compact_wire?reconstructCompactSolResponse(raw,ready.compact_wire,ready.evidence):raw;
 const result=await validateParallelReport(reconstructed,ready);
 return {...result,...(ready.compact_wire?{response_format_version:COMPACT_SOL_WIRE,compact_response:raw,
  source_reconstruction:{version:COMPACT_SOL_WIRE,manifest_sha256:ready.compact_wire_sha256,generated_text_changed:false}}:{})} as unknown as Awaited<ReturnType<ReadyContract['validate']>>;
},
 reportItems:value=>{const r=value as {technical_checks_passed:boolean};return r.technical_checks_passed?[]:[{status:'review_needed'}];}};
export type ParallelReport=Report;
