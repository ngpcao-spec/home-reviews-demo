// Technical continuation adapter, using the existing candidate protocol family,
// immutable source archive, durable Sol-ready worker and exact compact prompt.
// deno-lint-ignore no-import-prefix
import {z} from 'npm:zod@4.6.5';
import {DIRECT4_CANDIDATES,verifyCandidateSource,type CandidateSource,type CandidateInput,type CandidateProtocol} from './jls-direct4-candidates.ts';
import {COMPACT_SOL_WIRE,prepareCompactSolWire,compactSolResponse,reconstructCompactSolResponse} from './parallel-sol-wire.ts';
import {validateParallelReport} from './parallel-report.ts';
import {directHash,directCanonical,DIRECT_CATEGORY_KEYS} from './jev-direct-categories.ts';
import {analysisTextSha256} from './analysis-text.ts';
import {SHORT_CLASSIFIER_CONFIG} from './jev-direct-short-config.ts';
import {verifyDirectReportSources,bindDirectSolWire,DIRECT_SYNTHESIS_VERSION,DIRECT_CANDIDATE_EMPTY} from './jev-direct-report-preparation.ts';
import {attachPlanTokenMemo,tokenCertificate} from './jls-token-memo.ts';
import {SOL_SIZE_POLICY,solRequestSize} from './jls-sol-size.ts';
import type {ReadyContract} from './jls-sol-ready-worker.ts';

export const COMPACT_COMPARISON='jls-direct4-compact-comparison-v1';
type Metadata={review_id:string;analysis_language:string;translation_source:string;translation_provenance:unknown};
export type CompactComparisonArchive={id:string;sha256:string;body:{organization_id:string;establishment_id:string;
 protocol:{body:CandidateProtocol['body']};source_input:{dataset:CandidateInput['dataset']};[key:string]:unknown}};
const sourceView=(s:CandidateSource,metadata:Metadata[])=>({organization_id:s.organization_id,establishment_id:s.establishment_id,
 statistics:s.statistics,statistics_sha256:s.statistics_sha256,evidence:s.selected,reviews:s.sources.map(r=>{
  const m=metadata.find(m=>m.review_id===r.id),extra=r as typeof r&{analysis_language?:string;analysis_source?:string;translation_provenance?:unknown};
  return {...r,analysis_language:extra.analysis_language??m?.analysis_language,analysis_source:extra.analysis_source??m?.translation_source,translation_provenance:extra.translation_provenance??m?.translation_provenance};
 })});
async function draft(s:CandidateSource,metadata:Metadata[],count:(s:string)=>number,wire?:string){
 const view=sourceView(s,metadata),compact=await prepareCompactSolWire({...view,source_snapshot_sha256:await directHash(s.sources)},'vi');
 const {$schema:_,...schema}=z.toJSONSchema(compactSolResponse);
 const request=bindDirectSolWire({model:'gpt-6.1-sol',reasoning:{effort:'low'},max_output_tokens:SOL_SIZE_POLICY.max_output_tokens,
  input:[{role:'system',content:compact.prompt},{role:'user',content:JSON.stringify(compact.packet)}],
  text:{format:{type:'json_schema',name:'jls_direct4_compact_sol_v1',strict:true,schema}}},compact.packet,wire);
 return {packet:compact.packet,prompt:compact.prompt,schema,request,measurement:solRequestSize(request,SOL_SIZE_POLICY,count),
  compact_wire:compact.manifest,compact_wire_sha256:compact.manifest_sha256};
}
export async function prepareCompactComparison(a:CompactComparisonArchive,code:string){
 if(await directHash(a.body)!==a.sha256||!/^[a-f0-9]{40}$/.test(code))throw Error('COMPACT_COMPARISON_ARCHIVE_CHANGED');
 const original=a.body.protocol.body,source={...original.source,reference_archive:{id:a.id,sha256:a.sha256}},dataset=a.body.source_input.dataset;
 if(source.organization_id!==a.body.organization_id||source.establishment_id!==a.body.establishment_id||dataset.sha256!==source.dataset_sha256)throw Error('COMPACT_COMPARISON_SCOPE_CHANGED');
 await verifyCandidateSource(source);
 const snapshotBody={reviews:source.sources,source_reviews_sha256:await directHash(source.sources)};
 const counts=await verifyDirectReportSources({dataset,snapshot:{id:source.source_protocol_id,protocol_id:dataset.protocol_id,organization_id:source.organization_id,
  body:snapshotBody,sha256:await directHash(snapshotBody)},prior_luna_requests:[]},{dataset_id:dataset.id,dataset_sha256:dataset.sha256,
  snapshot_id:source.source_protocol_id,snapshot_sha256:await directHash(snapshotBody),source_reviews:source.sources.length,text_reviews:dataset.body.reviews.length,
  classification_configuration:{id:SHORT_CLASSIFIER_CONFIG.id,sha256:await directHash(SHORT_CLASSIFIER_CONFIG)}});
 if(directCanonical(counts)!==directCanonical(source.statistics.counts))throw Error('COMPACT_COMPARISON_COUNTS_CHANGED');
 const review_metadata=dataset.body.reviews.map(r=>({review_id:r.review_id,analysis_language:r.analysis_language,translation_source:r.translation_source,translation_provenance:r.translation_provenance})).sort((a,b)=>a.review_id<b.review_id?-1:1);
 const memo=await attachPlanTokenMemo(source),d=await draft(source,review_metadata,memo.count),cert=await tokenCertificate(source),request_json=JSON.stringify(d.request);
 const configuration={version:DIRECT4_CANDIDATES,comparison_version:COMPACT_COMPARISON,sol_wire_version:COMPACT_SOL_WIRE,synthesis_version:DIRECT_SYNTHESIS_VERSION,
  sol_prompt_sha256:await analysisTextSha256(d.prompt),sol_schema_sha256:await directHash(d.schema),
  policy:{model:'gpt-6.1-sol',language:'vi',automatic_retry:false,provider_client_retries:0,apify_calls:0}};
 const body={version:DIRECT4_CANDIDATES,organization_id:source.organization_id,establishment_id:source.establishment_id,authority_user_id:source.authority_user_id,
  language:'vi',source,source_sha256:await directHash(source),review_metadata,review_metadata_sha256:await directHash(review_metadata),
  configuration,configuration_sha256:await directHash(configuration),code_provenance:code,pending:[],pending_sha256:await directHash([]),
  max_jev_calls:0,max_luna_calls:0,max_sol_calls:1,max_apify_calls:0,automatic_retry:false,production_enabled:false,preparation_is_not_spending_authorization:true,
  spending_authorization:null,run_id:null,sol_size_policy:SOL_SIZE_POLICY,
  ready_template:{draft:d,request_json,request_sha256:await directHash(d.request),request_raw_sha256:await analysisTextSha256(request_json),measurement:d.measurement,
   token_certificate:cert,token_certificate_sha256:await directHash(cert)}};
 return {body,sha256:await directHash(body)};
}
export type CompactComparison=Awaited<ReturnType<typeof prepareCompactComparison>>;
export async function verifyCompactComparison(p:CompactComparison['body'],sha:string){
 if(p.version!==DIRECT4_CANDIDATES||p.configuration.comparison_version!==COMPACT_COMPARISON||p.configuration.sol_wire_version!==COMPACT_SOL_WIRE||
  p.max_jev_calls!==0||p.max_luna_calls!==0||p.max_sol_calls!==1||p.max_apify_calls!==0||p.automatic_retry!==false||p.production_enabled!==false||
  p.spending_authorization!==null||p.run_id!==null||p.pending.length||p.pending_sha256!==await directHash([])||
  p.organization_id!==p.source.organization_id||p.establishment_id!==p.source.establishment_id||p.authority_user_id!==p.source.authority_user_id||
  p.source_sha256!==await directHash(p.source)||p.review_metadata_sha256!==await directHash(p.review_metadata)||p.configuration_sha256!==await directHash(p.configuration)||
  await directHash(p)!==sha||await directHash(p.sol_size_policy)!==await directHash(SOL_SIZE_POLICY))throw Error('COMPACT_COMPARISON_CHANGED');
 await verifyCandidateSource(p.source);
 const a=p.ready_template;
 if(a.token_certificate_sha256!==await directHash(a.token_certificate)||a.request_sha256!==await directHash(JSON.parse(a.request_json))||
  a.request_raw_sha256!==await analysisTextSha256(a.request_json))throw Error('COMPACT_COMPARISON_REQUEST_CHANGED');
 const memo=await attachPlanTokenMemo(p,a.token_certificate,true),expected=await draft(p.source,p.review_metadata,memo.count,a.request_json);
 if(directCanonical(expected)!==directCanonical(a.draft)||p.configuration.sol_prompt_sha256!==await analysisTextSha256(expected.prompt)||
  p.configuration.sol_schema_sha256!==await directHash(expected.schema)||directCanonical(a.measurement)!==directCanonical(expected.measurement))throw Error('COMPACT_COMPARISON_REQUEST_CHANGED');
}
export const compactComparisonContract:ReadyContract={verify:async s=>{
 const p=s.protocol.body as unknown as CompactComparison['body'];await verifyCompactComparison(p,s.protocol.sha256);
 const b=s.ready.body as unknown as Record<string,unknown>,a=p.ready_template;
 if(await directHash(b)!==s.ready.sha256||b.source_protocol_id!==s.protocol.id||b.source_protocol_sha256!==s.protocol.sha256||b.source_run_id!==s.operation.run_id||
  directCanonical(b.candidate_template)!==directCanonical(a)||b.request_json!==a.request_json||b.request_sha256!==a.request_sha256||b.request_raw_sha256!==a.request_raw_sha256)
  throw Error('COMPACT_COMPARISON_READY_CHANGED');
 return p as unknown as Awaited<ReturnType<ReadyContract['verify']>>;
},validate:async(raw,s)=>{
 const p=s.protocol.body as unknown as CompactComparison['body'],a=p.ready_template;
 const reconstructed=reconstructCompactSolResponse(raw,a.draft.compact_wire,p.source.selected);
 const result=await validateParallelReport(reconstructed,{evidence:p.source.selected,statistics:p.source.statistics,statistics_sha256:p.source.statistics_sha256} as never);
 return {...result,response_format_version:COMPACT_SOL_WIRE,compact_response:raw,source_reconstruction:{version:COMPACT_SOL_WIRE,manifest_sha256:a.draft.compact_wire_sha256,generated_text_changed:false},
  evidence_verification:'sol_self_review_same_call_not_independent'} as unknown as Awaited<ReturnType<ReadyContract['validate']>>;
},reportItems:value=>(value as {technical_checks_passed:boolean}).technical_checks_passed?[]:[{status:'review_needed'}]};
export function compactComparisonMock(p:CompactComparison['body']){
 const associations=p.ready_template.draft.packet.associations;
 return {id:'EXPLICIT_TECHNICAL_MOCK',model:'gpt-6.1-sol',status:'completed',usage:{input_tokens:1,output_tokens:1,total_tokens:2},
  output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({format_version:COMPACT_SOL_WIRE,report:{
   categories:DIRECT_CATEGORY_KEYS.map(category=>({category,text:associations.some(e=>e.category===category)?'EXPLICIT TECHNICAL MOCK.':DIRECT_CANDIDATE_EMPTY,
    refs:associations.filter(e=>e.category===category).slice(0,1).map(e=>e.ref)})),positive_aspects:[],negative_aspects:[],
   conclusion:{text:'EXPLICIT TECHNICAL MOCK.',refs:[associations[0].ref]},recommendations:[]}})}]}]};
}
