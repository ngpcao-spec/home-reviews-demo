import { normalizeReviewLanguage } from './review-language.ts'
export type AnalysisSource='original_en'|'google_translation_en'|'fallback_original'|'textless'
export interface AnalysisReview {original_text:string|null;original_language?:string|null;analysis_text?:string;analysis_language?:string|null;analysis_source?:AnalysisSource;review_translations?:{language:string;translated_text:string}[]|null}
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
export function analysisInputStats(reviews:AnalysisReview[]) {
  const values=reviews.map(r=>r.analysis_source?{analysis_text:r.analysis_text??'',analysis_language:r.analysis_language,analysis_source:r.analysis_source}:analysisTextForReview(r))
  const text=values.filter(r=>r.analysis_text.trim()),original_english_count=text.filter(r=>r.analysis_source==='original_en').length,google_english_translation_count=text.filter(r=>r.analysis_source==='google_translation_en').length
  return {total_reviews:reviews.length,reviews_with_text:text.length,textless_reviews:reviews.length-text.length,original_english_count,google_english_translation_count,fallback_non_english_count:text.filter(r=>r.analysis_source==='fallback_original' && r.analysis_language!=='en').length,english_analysis_coverage_percent:text.length?(original_english_count+google_english_translation_count)/text.length*100:100}
}
