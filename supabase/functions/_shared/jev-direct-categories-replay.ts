// Pure offline replay. No provider, execution, consent, queue or database dependencies.
import {analysisTextSha256} from './analysis-text.ts';
import {DIRECT_CONFIG,DIRECT_CATEGORY_KEYS,DIRECT_ROUNDING_PARSER_VERSION,DIRECT_PROBABILITY_SUM_TOLERANCE,
 directCanonical,directHash,directCategoryPayload,directCategoryCounts,parseDirectCategoriesRounded,
 type DirectCategoryResult,type DirectProbabilityDiagnostic} from './jev-direct-categories.ts';

interface SavedReview {
 review_id:string;organization_id:string;establishment_id:string;analysis_text:string;analysis_text_sha256:string;
 analysis_language:string;review_alias:string;request_sha256:string;request_raw_sha256:string;
 raw_response_text:string;response_raw_sha256:string;result:DirectCategoryResult|null;
 result_id:string;result_sha256:string;status:string;error:string|null;
 [key:string]:unknown;
}
export interface DirectReplaySource {
 id:string;sha256:string;organization_id:string;protocol_id:string;
 body:{version:string;configuration_id:string;configuration_sha256:string;denominators:unknown;
  reviews:SavedReview[];usage:unknown;[key:string]:unknown};
}
export async function replayDirectSavedArchive(source:DirectReplaySource,code_commit:string){
 if(!/^[a-f0-9]{40}$/.test(code_commit)||source.sha256!==await directHash(source.body)||
  source.body.version!=='jev-direct-categories4-full80-dataset-v1'||
  source.body.configuration_id!==DIRECT_CONFIG.id||source.body.configuration_sha256!==await directHash(DIRECT_CONFIG)||
  directCanonical(source.body.denominators)!==directCanonical({source_reviews:100,analytical_reviews:80,textless_statistics_only:20})||
  source.body.reviews.length!==80||new Set(source.body.reviews.map(r=>r.review_id)).size!==80||
  new Set(source.body.reviews.map(r=>r.establishment_id)).size!==1)throw Error('DIRECT_REPLAY_SOURCE_INTEGRITY_FAILED');
 const reviews=[];
 for(const row of source.body.reviews){
  const request=directCategoryPayload(row.review_alias,row.analysis_text);
  if(row.organization_id!==source.organization_id||row.analysis_language!=='en'||
   await analysisTextSha256(row.analysis_text)!==row.analysis_text_sha256||
   await directHash(request)!==row.request_sha256||await analysisTextSha256(JSON.stringify(request))!==row.request_raw_sha256||
   typeof row.raw_response_text!=='string'||await analysisTextSha256(row.raw_response_text)!==row.response_raw_sha256)
   throw Error('DIRECT_REPLAY_TEXT_OR_RECEIPT_CHANGED:'+row.review_id);
  let result:DirectCategoryResult|null=null,error:string|null=null,diagnostic:DirectProbabilityDiagnostic|null=null;
  try{result=parseDirectCategoriesRounded(JSON.parse(row.raw_response_text));}
  catch(e){error=e instanceof Error?e.message:String(e);diagnostic=(e as {diagnostic?:DirectProbabilityDiagnostic})?.diagnostic??null;}
  const {result:oldResult,result_id,result_sha256,status,error:oldError,...unchanged}=row;
  reviews.push({...structuredClone(unchanged),
   source_result:{id:result_id,sha256:result_sha256,status,error:oldError,parser_version:oldResult?.version??DIRECT_CONFIG.parser_version},
   status:result?'technically_usable':'unusable',error,diagnostic,result,
   result_sha256:await directHash(result),result_provenance:'offline_saved_raw_response_replay'});
 }
 const body={version:'jev-direct-categories4-rounding-replay-v1',
  source_archive:{table:'public.analysis_jls_snapshot_preparations',id:source.id,sha256:source.sha256,version:source.body.version},
  parser_version:DIRECT_ROUNDING_PARSER_VERSION,parser_code_commit:code_commit,
  probability_policy:{absolute_sum_tolerance:DIRECT_PROBABILITY_SUM_TOLERANCE,
   floating_margin:'8 * Number.EPSILON * max(1, abs(sum), 6)',normalize:false,override_native_choice:false},
  configuration_id:source.body.configuration_id,configuration_sha256:source.body.configuration_sha256,
  denominators:structuredClone(source.body.denominators),reviews,
  counts:directCategoryCounts(reviews.map(r=>r.review_id),reviews),
  recovered_review_ids:reviews.filter(r=>r.source_result.status!=='completed'&&r.result!==null).map(r=>r.review_id),
  probability_diagnostics:reviews.flatMap(r=>(r.result?.probability_diagnostics??[]).map(d=>({review_id:r.review_id,...d}))),
  remaining_anomalies:reviews.filter(r=>r.error!==null).map(r=>({review_id:r.review_id,error:r.error,diagnostic:r.diagnostic})),
  uncertainties:reviews.flatMap(r=>DIRECT_CATEGORY_KEYS.flatMap(category=>{const a=r.result?.categories[category];
   return a&&a.status!=='classified'?[{review_id:r.review_id,category,status:a.status,native_choice:a.native_choice}]:[];})),
  original_usage_reused:structuredClone(source.body.usage),new_provider_calls:0,new_input_tokens:0,new_output_tokens:0,
  jev_calls:0,luna_calls:0,sol_calls:0,apify_calls:0,provider_retries:0,spending_authorization:null,run_id:null,
  semantic_correctness_validated:false,human_reference:false,production_modified:false};
 return {body,sha256:await directHash(body)};
}
