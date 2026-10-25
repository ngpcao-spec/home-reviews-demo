import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'
import { analysisTextForReview,analysisInputStats } from './analysis-text.ts'
import {normalizeReviewLanguage,translationLanguage} from './review-language.ts'
export interface EnglishReview {id:string;external_review_id:string;original_text:string|null;original_language:string|null;review_translations:{language:string;translated_text:string}[]}
export async function englishReviews(admin:SupabaseClient,establishment:string,organization:string):Promise<EnglishReview[]> {
  const rows:EnglishReview[]=[]
  for(let offset=0;;offset+=500){const {data,error}=await admin.from('reviews').select('id,external_review_id,original_text,original_language,review_translations(language,translated_text)').eq('establishment_id',establishment).eq('organization_id',organization).order('id').range(offset,offset+499);if(error)throw new Error('ENGLISH_REVIEWS_READ_FAILED');rows.push(...data as EnglishReview[]??[]);if((data?.length??0)<500)break}
  return rows
}
export function englishCoverage(reviews:EnglishReview[]) {
  const stats=analysisInputStats(reviews.map(r=>({...r,...analysisTextForReview(r)})))
  return {stored_reviews:stats.total_reviews,reviews_with_text:stats.reviews_with_text,original_english:stats.original_english_count,english_translation_found:stats.google_english_translation_count,english_translation_missing:stats.fallback_non_english_count,coverage_percent:stats.english_analysis_coverage_percent}
}
export const englishBackfillLimit=(count:number)=>Math.min(Math.max(count+50,100),1000)
export function matchedEnglishTranslations(reviews:EnglishReview[],provider:{externalReviewId:string;translatedLanguage?:string|null;translatedText?:string|null}[]) {
  const byId=new Map(reviews.map(r=>[r.external_review_id,r])),result=new Map<string,{review_id:string;language:'en';translated_text:string;updated_at:string}>()
  for(const item of provider){const r=byId.get(item.externalReviewId);if(!r || !r.original_text?.trim() || normalizeReviewLanguage(r.original_language)==='en' || translationLanguage(item.translatedLanguage)!=='en' || !item.translatedText?.trim())continue;result.set(r.id,{review_id:r.id,language:'en',translated_text:item.translatedText,updated_at:new Date().toISOString()})}
  return [...result.values()]
}
export interface EnglishJob {id:string;organization_id:string;establishment_id:string;status:string;requested_by:string;provider_run_id:string|null;provider_dataset_id:string|null;targets:{id:string;external_review_id:string}[];provider_requests:number;provider_limit:number;lease_token:string;deadline_at:string}
export async function processEnglishJob(_admin:SupabaseClient,_job:EnglishJob,_token:string) { return {status:'retired',error_code:'ENGLISH_BACKFILL_RETIRED',provider_requests:0} }
