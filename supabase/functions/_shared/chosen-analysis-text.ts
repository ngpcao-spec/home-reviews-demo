import {analysisTextSha256,type AnalysisReview} from './analysis-text.ts'
import {collectionLanguage,normalizeReviewLanguage} from './review-language.ts'
export const CHOSEN_ANALYSIS_POLICY='account_google_or_original_v1'
export async function chosenAnalysisText(review:AnalysisReview,target:'fr'|'vi'){
 collectionLanguage(target)
 const original=review.original_text||review.text||'',source=normalizeReviewLanguage(review.original_language),hash=await analysisTextSha256(original)
 const textual=original.replace(/[\s\u200b\ufeff]/gu,'').length>0
 const translation=textual&&source!==target?review.review_translations?.find(t=>normalizeReviewLanguage(t.language)===target&&t.translated_text.trim()&&t.source_text_sha256===hash):undefined
 const text=textual?(translation?.translated_text??original):''
 return {analysis_text:text,analysis_language:translation?target:source,analysis_source:(!textual?'textless':translation?'google_translation_target':source===target?'original_target':'fallback_original') as 'textless'|'google_translation_target'|'original_target'|'fallback_original',
  analysis_target_language:target,analysis_text_sha256:await analysisTextSha256(text),
  analysis_translation_provenance:{policy:CHOSEN_ANALYSIS_POLICY,target_language:target,original_language:source,original_text_sha256:hash,provider_translation_id:translation?.id??null,provider_translation_language:translation?.language??null,provider:'google',translation_available:!!translation,translation_missing:textual&&source!==target&&!translation}}
}
export function chosenAnalysisStats(reviews:readonly {analysis_text?:string;analysis_source?:string;analysis_target_language?:string;analysis_translation_provenance?:{translation_missing:boolean}}[],language:'fr'|'vi'){
 const text=reviews.filter(r=>r.analysis_text?.trim())
 return {policy:CHOSEN_ANALYSIS_POLICY,target_language:language,total_reviews:reviews.length,reviews_with_text:text.length,textless_reviews:reviews.length-text.length,
  original_target_count:text.filter(r=>r.analysis_source==='original_target').length,google_target_translation_count:text.filter(r=>r.analysis_source==='google_translation_target').length,
  missing_target_translation_count:text.filter(r=>r.analysis_translation_provenance?.translation_missing).length,analysed_text_reviews:text.length,analysis_missing_count:0}
}
