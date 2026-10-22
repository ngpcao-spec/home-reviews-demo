// Candidate-only comparison contract over the existing durable Sol-ready worker.
// No supplier transport, verdict reuse or report generation runs at preparation.
// deno-lint-ignore no-import-prefix
import {z} from 'npm:zod@4.6.5';
import {directHash,directCanonical,DIRECT_CATEGORY_KEYS} from './jev-direct-categories.ts';
import {analysisTextSha256} from './analysis-text.ts';
import {SHORT_CLASSIFIER_CONFIG} from './jev-direct-short-config.ts';
import {SHORT_CONFIG} from './direct4-short-comparison.ts';
import {balancedDirectReportInstructions,directSynthesisStatistics,directReportResponse,bindDirectSolWire,
 verifyDirectReportSources,validateDirectReportEvidence,DIRECT_CANDIDATE_EMPTY,DIRECT_SYNTHESIS_VERSION,
 type DirectReportInput,type DirectReportPreparation,type DirectReportEvidence,type DirectReportSourceBinding} from './jev-direct-report-preparation.ts';
import {SOL_SIZE_POLICY,solRequestSize} from './jls-sol-size.ts';
import {attachPlanTokenMemo,tokenCertificate,planTokenMemo} from './jls-token-memo.ts';
import type {ReadyContract,ReadyState} from './jls-sol-ready-worker.ts';
import type {JlsPlan} from './jev-luna-sol.ts';
export const DIRECT4_CANDIDATES='jls-direct4-no-luna-candidates-v1';
export interface CandidateInput {
 reference_archive:{id:string;sha256:string};source_run_id:string;source_protocol_id:string;source_protocol_sha256:string;
 organization_id:string;establishment_id:string;authority_user_id:string;bundle_sha256:string;
 dataset:DirectReportInput['dataset'];sources:DirectReportInput['snapshot']['body']['reviews'];
 statistics:DirectReportPreparation['body']['statistics'];statistics_sha256:string;selected:DirectReportEvidence[];
 originals:NonNullable<DirectReportPreparation['body']['synthesis']>['originals'];synthesis:string;
}
export const COMPACT_REUSED_SOURCE='jls-direct4-compact-reused-source-v1';
export interface ReusedShortBinding {version:typeof COMPACT_REUSED_SOURCE;dataset_binding:DirectReportSourceBinding;analysed_review_ids:string[];
 corpus_archive:{id:string;sha256:string};classification_archive:{id:string;sha256:string};classification_protocol:{id:string;sha256:string};}
export type CandidateSource=Omit<CandidateInput,'dataset'>&{dataset_sha256:string;source_binding?:ReusedShortBinding};
export function candidateInstructions(scope:CandidateInput['statistics']['scope']){
 return balancedDirectReportInstructions(scope)
 .replace('must link accepted evidence_ids of its category','must link candidate evidence_ids of its category that your examination of the supplied text supports')
 .replace('For a category without accepted evidence, use no evidence_ids and exactly this text: Chưa đủ bằng chứng được chấp nhận cho nhóm này.',
  'If your examination supports no candidate for a category, omit its evidence_ids and use exactly: '+DIRECT_CANDIDATE_EMPTY)
 .replace('Consider the accepted criticisms','Consider candidate criticisms that your examination of the supplied text supports')
 .replace('It is context, not a new Luna verdict: do not invent a new accepted category, polarity or claim from the original.',
  'It is context, not an independently verified finding: do not invent a different category, polarity or claim from the original.')
 .replace('coverage describes losses at selection and Luna, not semantic truth. A missing accepted proof limits illustration, not the server category statistics.',
  'coverage describes selection only, not semantic truth. An unsupported candidate limits illustration, not the server category statistics.')
 +'\nCANDIDATE-ONLY EXPERIMENT: All supplied evidence items are customer opinions to examine, not validated facts. Check whether each quoted text and its context support the proposed category and polarity. You may discard an unfounded JEV association; do not force it into the report or silently reclassify it. No separate evidence-verification verdicts are supplied. JEV statistics are unchanged automatic classifications, not statistics validated by your reading. Your examination and writing in one call are not independent validation. Preserve supported positive, negative and mixed opinions; distinguish trends from isolated reports and propose proportionate actions without inventing cause or frequency. If no candidate supports any category, use the same insufficient-evidence text for the conclusion, no references, no aspects and no recommendations.';
}
function candidateDraft(s:CandidateSource,count:(v:string)=>number,wire?:string){
 const packet={format_version:'jls-direct-categories4-report-v1',language:'vi',synthesis_version:DIRECT_SYNTHESIS_VERSION,
  statistics:directSynthesisStatistics(s.statistics),statistics_sha256:s.statistics_sha256,
  statistics_provenance:'unchanged_automatic_jev_classifications_not_validated_by_sol',
  evidence:s.selected.map(e=>({evidence_id:e.evidence_id,review_id:e.review_id,category:e.category,polarity:e.polarity,
   quote:e.quote,quote_sha256:e.quote_sha256,analysis_text_sha256:e.analysis_text_sha256,translation_source:e.translation_source,
   context_same_as_quote:e.context===e.quote,...(e.context===e.quote?{}:{context:e.context}),
   quote_start:e.quote_start,quote_end:e.quote_end,context_start:e.context_start,context_end:e.context_end})),
  original_reviews:s.originals,
  coverage:DIRECT_CATEGORY_KEYS.map(category=>({category,selected_positive:s.selected.filter(e=>e.category===category&&e.polarity==='positive').length,
   selected_negative:s.selected.filter(e=>e.category===category&&e.polarity==='negative').length})),
  scope:'UNVERIFIED_CUSTOMER_CANDIDATES_SOL_SELF_REVIEW',
  methodology_vi:`Báo cáo thử nghiệm trên ${s.statistics.scope.analysed_text_reviews} đánh giá có văn bản trong lô ${s.statistics.scope.source_reviews} đánh giá; ${s.statistics.scope.textless_statistics_only} đánh giá không có văn bản chỉ dùng cho thống kê chung. Thống kê là phân loại tự động của JEV, không được Sol xác nhận lại. Số liệu theo nhóm không phải tần suất của từng sự cố. Sol xem xét trích dẫn và viết báo cáo trong cùng một lượt; đây không phải xác nhận độc lập của con người.`};
 const prompt=candidateInstructions(s.statistics.scope),{$schema:_,...schema}=z.toJSONSchema(directReportResponse);
 const request=bindDirectSolWire({model:'gpt-6.1-sol',reasoning:{effort:'low'},max_output_tokens:SOL_SIZE_POLICY.max_output_tokens,
  input:[{role:'system',content:prompt},{role:'user',content:JSON.stringify(packet)}],
  text:{format:{type:'json_schema',name:'jls_direct_categories4_report_v1',strict:true,schema}}},packet,wire);
 return {packet,prompt,schema,request,measurement:solRequestSize(request,SOL_SIZE_POLICY,count)};
}
export async function verifyCandidateSource(s:CandidateSource){
 const reused=s.source_binding,b=reused?.dataset_binding,missing=b?.technical_missing_review_ids??[],scope=s.statistics.scope;
 const reusedConfig=b?.classification_configuration;
 const supportedConfig=!!reusedConfig&&((reusedConfig.id===SHORT_CONFIG.id&&reusedConfig.sha256===await directHash(SHORT_CONFIG))||
  (reusedConfig.id===SHORT_CLASSIFIER_CONFIG.id&&reusedConfig.sha256===await directHash(SHORT_CLASSIFIER_CONFIG)));
 if(reused&&(reused.version!==COMPACT_REUSED_SOURCE||!b||b.snapshot_id!==s.source_protocol_id||b.dataset_sha256!==s.dataset_sha256||
  !supportedConfig||
  reused.analysed_review_ids.length!==b.text_reviews||new Set(reused.analysed_review_ids).size!==b.text_reviews||new Set(missing).size!==missing.length||
  missing.some(id=>reused.analysed_review_ids.includes(id))||s.sources.some(r=>!!r.analysis_text!==reused.analysed_review_ids.includes(r.id)&&!missing.includes(r.id))||
  missing.some(id=>!s.sources.some(r=>r.id===id&&r.analysis_text))||s.selected.some(e=>!reused.analysed_review_ids.includes(e.review_id)||e.jev_configuration!==reusedConfig!.id)||
  (scope.technical_missing_reviews??0)!==missing.length||(scope.textual_source_reviews??b.text_reviews)!==b.text_reviews+missing.length))throw Error('COMPACT_REUSED_SCOPE_CHANGED');
 const sourceCount=b?.source_reviews??135,textCount=b?.text_reviews??75;
 if(s.synthesis!==DIRECT_SYNTHESIS_VERSION||s.sources.length!==sourceCount||new Set(s.sources.map(r=>r.id)).size!==sourceCount||
  s.sources.filter(r=>r.analysis_text).length!==textCount+missing.length||s.selected.length<1||s.selected.length>32||(!reused&&s.selected.length!==32)||new Set(s.selected.map(e=>e.evidence_id)).size!==s.selected.length||
  await directHash(s.statistics)!==s.statistics_sha256||scope.source_reviews!==sourceCount||scope.analysed_text_reviews!==textCount||scope.textless_statistics_only!==sourceCount-textCount-missing.length)
  throw Error('DIRECT_CANDIDATES_SOURCE_CHANGED');
 for(const e of s.selected){const r=s.sources.find(r=>r.id===e.review_id),o=s.originals.find(o=>o.review_id===e.review_id);
  if(!r?.analysis_text||!o||r.organization_id!==s.organization_id||r.establishment_id!==s.establishment_id||
   r.analysis_text_sha256!==e.analysis_text_sha256||await analysisTextSha256(r.analysis_text)!==e.analysis_text_sha256||
   await analysisTextSha256(r.original_text)!==r.original_text_sha256||o.original_text!==r.original_text||o.original_text_sha256!==r.original_text_sha256||
   e.quote!==r.analysis_text.slice(e.quote_start,e.quote_end)||await analysisTextSha256(e.quote)!==e.quote_sha256||
   e.context!==r.analysis_text.slice(e.context_start,e.context_end)||!e.context.includes(e.quote))throw Error('DIRECT_CANDIDATES_QUOTE_CHANGED');
 }
 if(s.originals.some(o=>!s.selected.some(e=>e.review_id===o.review_id)))throw Error('DIRECT_CANDIDATES_ORIGINAL_CHANGED');
}
export async function prepareCandidateOnly(i:CandidateInput,code:string){
 if(!/^[a-f0-9]{40}$/.test(code))throw Error('DIRECT_CANDIDATES_CODE_REQUIRED');
 const {dataset,...source}=i,s={...source,dataset_sha256:dataset.sha256};await verifyCandidateSource(s);
 const snap={reviews:i.sources,source_reviews_sha256:await directHash(i.sources)};
 const counts=await verifyDirectReportSources({dataset,snapshot:{id:i.source_protocol_id,protocol_id:i.source_protocol_id,organization_id:i.organization_id,body:snap,sha256:await directHash(snap)},prior_luna_requests:[]},
  {dataset_id:dataset.id,dataset_sha256:dataset.sha256,snapshot_id:i.source_protocol_id,snapshot_sha256:await directHash(snap),source_reviews:135,text_reviews:75,
   classification_configuration:{id:SHORT_CLASSIFIER_CONFIG.id,sha256:await directHash(SHORT_CLASSIFIER_CONFIG)}});
 if(directCanonical(counts)!==directCanonical(i.statistics.counts))throw Error('DIRECT_CANDIDATES_COUNTS_CHANGED');
 const memo=await attachPlanTokenMemo(s),draft=candidateDraft(s,memo.count),cert=await tokenCertificate(s),request_json=JSON.stringify(draft.request);
 const configuration={version:DIRECT4_CANDIDATES,synthesis_version:DIRECT_SYNTHESIS_VERSION,sol_prompt_sha256:await analysisTextSha256(draft.prompt),
  sol_schema_sha256:await directHash(draft.schema),policy:{model:'gpt-6.1-sol',language:'vi',automatic_retry:false,provider_client_retries:0,apify_calls:0}};
 const body={version:DIRECT4_CANDIDATES,organization_id:i.organization_id,establishment_id:i.establishment_id,authority_user_id:i.authority_user_id,language:'vi',
  source:s,source_sha256:await directHash(s),configuration,configuration_sha256:await directHash(configuration),code_provenance:code,
  pending:[],pending_sha256:await directHash([]),max_jev_calls:0,max_luna_calls:0,max_sol_calls:1,max_apify_calls:0,automatic_retry:false,
  sol_size_policy:SOL_SIZE_POLICY,production_enabled:false,preparation_is_not_spending_authorization:true,spending_authorization:null,run_id:null,
  ready_template:{draft,request_json,request_sha256:await directHash(draft.request),request_raw_sha256:await analysisTextSha256(request_json),
   measurement:draft.measurement,token_certificate:cert,token_certificate_sha256:await directHash(cert)}};
 return {body,sha256:await directHash(body)};
}
export type CandidateProtocol=Awaited<ReturnType<typeof prepareCandidateOnly>>;
export async function verifyCandidateProtocol(p:CandidateProtocol['body'],sha:string){
 if(p.version!==DIRECT4_CANDIDATES||await directHash(p)!==sha||p.source_sha256!==await directHash(p.source)||
  p.configuration_sha256!==await directHash(p.configuration)||p.organization_id!==p.source.organization_id||p.establishment_id!==p.source.establishment_id||p.authority_user_id!==p.source.authority_user_id||
  p.max_jev_calls!==0||p.max_luna_calls!==0||p.max_sol_calls!==1||p.max_apify_calls!==0||p.automatic_retry!==false||p.production_enabled!==false||p.pending.length||
  p.pending_sha256!==await directHash([])||p.spending_authorization!==null||p.run_id!==null||p.preparation_is_not_spending_authorization!==true||
  p.configuration.policy.automatic_retry!==false||p.configuration.policy.provider_client_retries!==0||p.configuration.policy.apify_calls!==0||p.language!=='vi'||
  await directHash(p.sol_size_policy)!==await directHash(SOL_SIZE_POLICY))throw Error('DIRECT_CANDIDATES_PROTOCOL_CHANGED');
 await verifyCandidateSource(p.source);const a=p.ready_template;
 if(a.token_certificate_sha256!==await directHash(a.token_certificate)||a.request_sha256!==await directHash(JSON.parse(a.request_json))||
  a.request_raw_sha256!==await analysisTextSha256(a.request_json))throw Error('DIRECT_CANDIDATES_REQUEST_CHANGED');
 const memo=await attachPlanTokenMemo(p,a.token_certificate,true),draft=candidateDraft(p.source,memo.count,a.request_json);
 if(directCanonical(draft)!==directCanonical(a.draft)||await directHash(draft.measurement)!==await directHash(a.measurement)||
  p.configuration.sol_prompt_sha256!==await analysisTextSha256(draft.prompt)||p.configuration.sol_schema_sha256!==await directHash(draft.schema))throw Error('DIRECT_CANDIDATES_REQUEST_CHANGED');
}
export const candidateReadyContract:ReadyContract={verify:async(s:ReadyState)=>{
 const p=s.protocol.body as unknown as CandidateProtocol['body'];await verifyCandidateProtocol(p,s.protocol.sha256);
 const b=s.ready.body as unknown as Record<string,unknown>;
 if(await directHash(b)!==s.ready.sha256||b.version!=='jls-direct4-sol-ready-v1'||b.source_protocol_id!==s.protocol.id||b.source_protocol_sha256!==s.protocol.sha256||
  b.source_run_id!==s.operation.run_id||directCanonical(b.candidate_template)!==directCanonical(p.ready_template)||
  b.request_json!==p.ready_template.request_json||b.request_sha256!==p.ready_template.request_sha256||b.request_raw_sha256!==p.ready_template.request_raw_sha256)
  throw Error('DIRECT_CANDIDATES_READY_CHANGED');
 return p as unknown as JlsPlan;
},validate:async(raw,s)=>{
 const p=s.protocol.body as unknown as CandidateProtocol['body'];
 const parsed=await validateDirectReportEvidence(raw,p.source.statistics_sha256,p.source.selected,true);
 return {...parsed,server_statistics:p.source.statistics,methodology_vi:p.ready_template.draft.packet.methodology_vi,
  validator_version:DIRECT4_CANDIDATES+'-bindings-v1',technical_checks_passed:true,human_validated:false,semantic_correctness_guaranteed:false,
  evidence_verification:'sol_self_review_same_call_not_independent',statistics_verification:'automatic_jev_not_validated_by_sol'} as unknown as Awaited<ReturnType<ReadyContract['validate']>>;
},reportItems:()=>[]};
export function candidateMockResponse(p:CandidateProtocol['body']){
 const evidence=p.source.selected;
 return {id:'EXPLICIT_MOCK_NOT_PROVIDER',model:'gpt-6.1-sol',status:'completed',usage:{input_tokens:1,output_tokens:1,total_tokens:2},
  output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({format_version:'jls-direct-categories4-report-v1',statistics_sha256:p.source.statistics_sha256,
   report:{categories:DIRECT_CATEGORY_KEYS.map(category=>({category,text:'MÔ PHỎNG KỸ THUẬT.',evidence_ids:[evidence.find(e=>e.category===category)!.evidence_id]})),
    positive_aspects:[],negative_aspects:[],conclusion:{text:'MÔ PHỎNG KỸ THUẬT.',evidence_ids:[evidence[0].evidence_id]},recommendations:[]}})}]}]};
}
export {planTokenMemo};
