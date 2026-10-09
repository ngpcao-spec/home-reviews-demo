import { normalizeReviewLanguage } from './review-language.ts'
export type AnalysisSource='original_en'|'google_translation_en'|'verified_translation_override_en'|'fallback_original'|'textless'
export interface ProviderTranslation {id?:string;language:string;translated_text:string;created_at?:string;updated_at?:string}
export interface EnglishTranslationOverride {review_id:string;original_text_sha256:string;provider_translation_sha256:string;correction_language:string;corrected_english_text:string;corrected_english_sha256:string;error_type:string;evidence_fr:string;source:string;status:string;benchmark_policy:string;created_at:string}
export const ENGLISH_OVERRIDE_POLICY='verified_english_translation_overrides_v1'
export type EnglishOverrideError='REVIEW_ID_MISMATCH'|'ORIGINAL_HASH_MISMATCH'|'PROVIDER_HASH_MISMATCH'|'CORRECTED_HASH_MISMATCH'|'CORRECTION_LANGUAGE_INVALID'|'OVERRIDE_POLICY_INVALID'|'OVERRIDE_SOURCE_INVALID'|'PROVIDER_ENGLISH_NOT_SELECTED'|'OVERRIDE_TIME_INVALID'|'CORRECTION_TEXT_EMPTY'
export interface EnglishOverrideProvenance {policy:typeof ENGLISH_OVERRIDE_POLICY;status:'applied'|'rejected';review_id:string;override_review_id:string;errors:EnglishOverrideError[];original_text_sha256:string;observed_corrected_english_sha256:string;provider_translation:{table:'review_translations';id:string|null;provider_source:'google_translation_en';provider_name:null;provider_name_status:'not_recorded_in_legacy_schema';language:string;translated_text:string;sha256:string;created_at:string|null;updated_at:string|null}|null;correction:EnglishTranslationOverride}
export interface AnalysisReview {id?:string;original_text:string|null;original_language?:string|null;analysis_text?:string;analysis_language?:string|null;analysis_source?:AnalysisSource;analysis_translation_override?:EnglishOverrideProvenance;review_translations?:ProviderTranslation[]|null}
export const analysisTextSha256=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,'0')).join('')
export function analysisTextForReview(review:AnalysisReview) {
  const original=review.original_text??'',language=normalizeReviewLanguage(review.original_language)
  if(!original.trim())return {analysis_text:'',analysis_language:language,analysis_source:'textless' as const}
  if(language==='en')return {analysis_text:original,analysis_language:'en',analysis_source:'original_en' as const}
  const translated=review.review_translations?.find(t=>normalizeReviewLanguage(t.language)==='en' && t.translated_text?.trim())?.translated_text
  if(translated)return {analysis_text:translated,analysis_language:'en',analysis_source:'google_translation_en' as const}
  return {analysis_text:original,analysis_language:language,analysis_source:'fallback_original' as const}
}
export function groundingText(review:AnalysisReview,version:number):string {return version>=7?(review.analysis_text??''):(review.original_text??'')}
export const benchmarkText=(review:AnalysisReview,version:number)=>groundingText(review,version)
/** Explicit fresh-input boundary. Frozen benchmarkText/groundingText never invoke this resolver. */
export async function analysisTextForFreshReview(review:AnalysisReview,override:EnglishTranslationOverride|undefined,asOf:string){
  if(review.analysis_text!==undefined||review.analysis_source!==undefined)throw new Error('ENGLISH_OVERRIDE_FROZEN_INPUT')
  const base=analysisTextForReview(review);if(!override)return base
  const provider=review.review_translations?.find(t=>normalizeReviewLanguage(t.language)==='en'&&t.translated_text?.trim()),originalHash=await analysisTextSha256(review.original_text??''),providerHash=provider?await analysisTextSha256(provider.translated_text):null,correctedHash=await analysisTextSha256(override.corrected_english_text),errors:EnglishOverrideError[]=[]
  if(!review.id||review.id!==override.review_id)errors.push('REVIEW_ID_MISMATCH')
  if(override.original_text_sha256!==originalHash)errors.push('ORIGINAL_HASH_MISMATCH')
  if(!provider||override.provider_translation_sha256!==providerHash)errors.push('PROVIDER_HASH_MISMATCH')
  if(override.corrected_english_sha256!==correctedHash)errors.push('CORRECTED_HASH_MISMATCH')
  if(override.correction_language!=='en')errors.push('CORRECTION_LANGUAGE_INVALID')
  if(!override.corrected_english_text.trim())errors.push('CORRECTION_TEXT_EMPTY')
  if(override.status!=='candidate_for_future_analysis'||override.benchmark_policy!=='do_not_change_frozen_v9_v11_inputs')errors.push('OVERRIDE_POLICY_INVALID')
  if(override.source!=='chatgpt_gpt_6_manual_audit')errors.push('OVERRIDE_SOURCE_INVALID')
  if(base.analysis_source!=='google_translation_en')errors.push('PROVIDER_ENGLISH_NOT_SELECTED')
  if(!Number.isFinite(Date.parse(asOf))||!Number.isFinite(Date.parse(override.created_at))||Date.parse(override.created_at)>Date.parse(asOf))errors.push('OVERRIDE_TIME_INVALID')
  const provenance:EnglishOverrideProvenance={policy:ENGLISH_OVERRIDE_POLICY,status:errors.length?'rejected':'applied',review_id:review.id??'',override_review_id:override.review_id,errors,original_text_sha256:originalHash,observed_corrected_english_sha256:correctedHash,provider_translation:provider?{table:'review_translations',id:provider.id??null,provider_source:'google_translation_en',provider_name:null,provider_name_status:'not_recorded_in_legacy_schema',language:provider.language,translated_text:provider.translated_text,sha256:providerHash!,created_at:provider.created_at??null,updated_at:provider.updated_at??null}:null,correction:{...override}}
  return {...base,...(!errors.length?{analysis_text:override.corrected_english_text,analysis_language:'en',analysis_source:'verified_translation_override_en' as const}:{}),analysis_translation_override:provenance}
}
export function analysisInputStats(reviews:AnalysisReview[]) {
  const values=reviews.map(r=>r.analysis_source?{analysis_text:r.analysis_text??'',analysis_language:r.analysis_language,analysis_source:r.analysis_source}:analysisTextForReview(r))
  const text=values.filter(r=>r.analysis_text.trim()),original_english_count=text.filter(r=>r.analysis_source==='original_en').length,google_english_translation_count=text.filter(r=>r.analysis_source==='google_translation_en').length
  const corrected=text.filter(r=>r.analysis_source==='verified_translation_override_en').length,anomalies=reviews.filter(r=>r.analysis_translation_override?.status==='rejected').length
  return {total_reviews:reviews.length,reviews_with_text:text.length,textless_reviews:reviews.length-text.length,original_english_count,google_english_translation_count,fallback_non_english_count:text.filter(r=>r.analysis_source==='fallback_original' && r.analysis_language!=='en').length,english_analysis_coverage_percent:text.length?(original_english_count+google_english_translation_count+corrected)/text.length*100:100,...(corrected||anomalies?{verified_english_override_count:corrected,english_override_anomaly_count:anomalies}:{})}
}
