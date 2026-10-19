// Freeze sources and request identities only. No references, results, consent or jobs.
import {DIRECT_CONFIG,DIRECT_CATEGORY_KEYS,directCategoryPayload,directHash} from './jev-direct-categories.ts';
import {analysisTextSha256} from './analysis-text.ts';
export const DIRECT_SOURCE_ID='bc00633a-30d8-4a90-8e22-dcc6a0efaeb9';
export const DIRECT_PROTOCOL_VERSION='jev-direct-categories4-chill80-v1';
export const DIRECT_PREPARATION_KIND='jev_direct_categories4_chill80_protocol_v1';
export const DIRECT_SOURCE_SHA256='2570b86b982ee2aed4d074d02777a2204543a89c75f056cb2601110abf5cfe1f';
export interface DirectSourceReview {id:string;organization_id:string;establishment_id:string;rating:number;
 original_text:string;original_text_sha256:string;analysis_text:string|null;analysis_text_sha256:string|null;
 analysis_language:string|null;analysis_source:string;translation_provenance:unknown}
export interface DirectFrozenSource {id:string;table:string;record_sha256:string;record_hash_verified:boolean;reviews_sha256:string;
 organization_id:string;parent_protocol_id:string;establishment_id:string;authority_user_id:string;historical_report_id:string;
 snapshot_sha256:string;reviews:DirectSourceReview[]}
export const DIRECT_REPLAY_POLICY=Object.freeze({max_jev_calls:80,max_questions:320,max_attempts_per_review:1,repeat_count:1,automatic_retry:false,
 fallback:false,model_probe_calls:0,provider_client_max_attempts:1,redirects:'error',raw_receipt_before_parsing:true,
 uncertain_billing_attempt_is_consumed:true,authenticated_scope_and_atomic_reservation_required_before_future_dispatch:true});
export interface DirectReplayReview {review_id:string;establishment_id:string;organization_id:string;analysis_text:string;analysis_text_sha256:string;
 analysis_language:string;original_text_sha256:string;translation_source:string;translation_provenance:unknown;
 review_alias:string;request_sha256:string;request_raw_sha256:string}
export async function prepareDirectCategories(source:DirectFrozenSource,code_provenance:string){
 if(source.id!==DIRECT_SOURCE_ID||source.record_sha256!==DIRECT_SOURCE_SHA256||source.record_hash_verified!==true||
  source.table!=='public.analysis_jls_snapshot_preparations'||source.reviews_sha256!==await directHash(source.reviews)||
  source.historical_report_id!=='39556285-21ee-4962-9892-da3b4f0e8ca3'||
  source.establishment_id!=='a9a6ec1c-cbb3-4e39-a498-86f2e68bd4b8'||source.reviews.length!==100||
  new Set(source.reviews.map(r=>r.id)).size!==100||!/^[a-f0-9]{40}$/.test(code_provenance))throw Error('JEV_DIRECT_SOURCE_CHANGED');
 const text=source.reviews.filter(r=>r.analysis_text?.trim()),textless=source.reviews.filter(r=>!r.analysis_text?.trim());
 if(text.length!==80||textless.length!==20)throw Error('JEV_DIRECT_SCOPE_100_80_REQUIRED');
 for(const r of source.reviews){
  if(r.organization_id!==source.organization_id||r.establishment_id!==source.establishment_id||
   await analysisTextSha256(r.original_text)!==r.original_text_sha256||
   (r.original_text.trim()?(r.analysis_language!=='en'||!r.analysis_text?.trim()||await analysisTextSha256(r.analysis_text)!==r.analysis_text_sha256):!!r.analysis_text?.trim()))throw Error('JEV_DIRECT_TEXT_OR_TENANT_CHANGED');
 }
 const configuration_sha256=await directHash(DIRECT_CONFIG),questions_sha256=await directHash(DIRECT_CONFIG.questions),reviews:DirectReplayReview[]=[];
 for(const r of [...text].sort((a,b)=>a.id.localeCompare(b.id))){
  const review_alias='review_'+String(reviews.length+1).padStart(3,'0'),payload=directCategoryPayload(review_alias,r.analysis_text!);
  reviews.push({review_id:r.id,establishment_id:r.establishment_id,organization_id:r.organization_id,
   analysis_text:r.analysis_text!,analysis_text_sha256:r.analysis_text_sha256!,analysis_language:'en',
   original_text_sha256:r.original_text_sha256,translation_source:r.analysis_source,translation_provenance:r.translation_provenance,
   review_alias,request_sha256:await directHash(payload),request_raw_sha256:await analysisTextSha256(JSON.stringify(payload))});
 }
 const policy=DIRECT_REPLAY_POLICY;
 const body={version:DIRECT_PROTOCOL_VERSION,organization_id:source.organization_id,establishment_id:source.establishment_id,
  authority_user_id:source.authority_user_id,source:{table:source.table,id:source.id,record_sha256:source.record_sha256,
   parent_protocol_id:source.parent_protocol_id,historical_report_id:source.historical_report_id,snapshot_sha256:source.snapshot_sha256,
   reviews_sha256:source.reviews_sha256},configuration:DIRECT_CONFIG,configuration_sha256,questions_sha256,
  reviews,reviews_sha256:await directHash(reviews),request_manifest_sha256:await directHash(reviews.map(r=>({review_id:r.review_id,
   analysis_text_sha256:r.analysis_text_sha256,request_sha256:r.request_sha256,request_raw_sha256:r.request_raw_sha256}))),
  denominators:{source_reviews:100,analytical_reviews:80,textless_statistics_only:20},
  textless_review_ids:textless.map(r=>r.id).sort(),category_keys:DIRECT_CATEGORY_KEYS,policy,policy_sha256:await directHash(policy),
  requested_model:DIRECT_CONFIG.requested_model,served_model:null,served_model_policy:'record_from_each_future_response_no_model_probe',
  previous_25_theme_classifications_reused:false,reference_annotations:null,results:null,run_id:null,spending_authorization:null,
  provider_calls:0,code_provenance,production_enabled:false,preparation_is_not_spending_authorization:true};
 return {body,sha256:await directHash(body)};
}
export type DirectCategoriesProtocol=Awaited<ReturnType<typeof prepareDirectCategories>>;
export async function verifyDirectCategoriesProtocol(p:DirectCategoriesProtocol){
 const b=p.body;
 if(p.sha256!==await directHash(b)||b.version!==DIRECT_PROTOCOL_VERSION||b.configuration_sha256!==await directHash(DIRECT_CONFIG)||
  await directHash(b.configuration)!==b.configuration_sha256||b.questions_sha256!==await directHash(DIRECT_CONFIG.questions)||
  b.reviews.length!==80||new Set(b.reviews.map(r=>r.review_id)).size!==80||b.textless_review_ids.length!==20||
  new Set([...b.reviews.map(r=>r.review_id),...b.textless_review_ids]).size!==100||
  b.reviews_sha256!==await directHash(b.reviews)||b.policy_sha256!==await directHash(b.policy)||b.policy_sha256!==await directHash(DIRECT_REPLAY_POLICY)||
  b.policy.max_jev_calls!==80||b.policy.max_attempts_per_review!==1||b.policy.automatic_retry!==false||
  b.run_id!==null||b.spending_authorization!==null||b.provider_calls!==0||b.results!==null||b.reference_annotations!==null||
  b.previous_25_theme_classifications_reused!==false||b.production_enabled!==false||b.preparation_is_not_spending_authorization!==true||
  b.requested_model!==DIRECT_CONFIG.requested_model||b.served_model!==null||b.source.id!==DIRECT_SOURCE_ID||b.source.record_sha256!==DIRECT_SOURCE_SHA256||
  await directHash(b.denominators)!==await directHash({source_reviews:100,analytical_reviews:80,textless_statistics_only:20})||
  await directHash(b.category_keys)!==await directHash(DIRECT_CATEGORY_KEYS))
  throw Error('JEV_DIRECT_PROTOCOL_CHANGED');
 for(const r of b.reviews){const q=directCategoryPayload(r.review_alias,r.analysis_text);
  if(r.organization_id!==b.organization_id||r.establishment_id!==b.establishment_id||r.analysis_language!=='en'||await analysisTextSha256(r.analysis_text)!==r.analysis_text_sha256||
   await directHash(q)!==r.request_sha256||await analysisTextSha256(JSON.stringify(q))!==r.request_raw_sha256)throw Error('JEV_DIRECT_FROZEN_REQUEST_CHANGED');}
 if(b.request_manifest_sha256!==await directHash(b.reviews.map(r=>({review_id:r.review_id,analysis_text_sha256:r.analysis_text_sha256,
  request_sha256:r.request_sha256,request_raw_sha256:r.request_raw_sha256}))))throw Error('JEV_DIRECT_MANIFEST_CHANGED');
 return true;
}
