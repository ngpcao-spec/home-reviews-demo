import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'
import { analysisTextForReview,analysisInputStats } from './analysis-text.ts'
import {normalizeReviewLanguage,translationLanguage,GOOGLE_REVIEWS_IMPORT_LANGUAGE} from './review-language.ts'
import {ApifyError,startApifyRun,getApifyRun,fetchApifyDataset,normalizeApifyDataset,apifyRunFinished,apifyRunSucceeded} from './apify.ts'
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
export async function processEnglishJob(admin:SupabaseClient,job:EnglishJob,token:string) {
  const log=(event:string,fields:Record<string,unknown>={})=>console.info(event,{job_id:job.id,establishment_id:job.establishment_id,...fields})
  let providerReads=0
  const checkpoint=async(values:Record<string,unknown>)=>{
    const {data,error}=await admin.from('english_translation_backfill_jobs').update({...values,lease_token:null,lease_until:null,updated_at:new Date().toISOString()}).eq('id',job.id).eq('lease_token',job.lease_token).select('id').single()
    if(error || !data)throw new Error('ENGLISH_BACKFILL_LEASE_LOST')
  }
  try {
    if(Date.now()>Date.parse(job.deadline_at))throw new Error('ENGLISH_BACKFILL_DEADLINE')
    if(!job.provider_run_id) {
      const {data:e,error}=await admin.from('establishments').select('google_maps_url,google_id').eq('id',job.establishment_id).eq('organization_id',job.organization_id).single()
      if(error || !e)throw new Error('ESTABLISHMENT_NOT_FOUND')
      log('ENGLISH_TRANSLATION_BACKFILL_STARTED')
      // Mark the costly start before calling the provider. An ambiguous crash must
      // never silently create a second paid Apify run.
      const {data:marked,error:mark}=await admin.from('english_translation_backfill_jobs').update({status:'starting',updated_at:new Date().toISOString()}).eq('id',job.id).eq('lease_token',job.lease_token).select('id').single()
      if(mark || !marked)throw new Error('ENGLISH_BACKFILL_LEASE_LOST')
      providerReads++
      const run=await startApifyRun(token,{placeUrl:e.google_maps_url||e.google_id,language:GOOGLE_REVIEWS_IMPORT_LANGUAGE,sort:'newest',limit:job.provider_limit})
      await checkpoint({status:'running',provider_run_id:run.runId,provider_dataset_id:run.datasetId,provider_requests:job.provider_requests+1})
      return
    }
    providerReads++
    const run=await getApifyRun(token,job.provider_run_id)
    if(!apifyRunFinished(run.status)){await checkpoint({status:'running',provider_requests:job.provider_requests+providerReads});return}
    if(!apifyRunSucceeded(run.status))throw new Error('ENGLISH_APIFY_RUN_FAILED')
    const items=await fetchApifyDataset(token,job.provider_dataset_id||run.datasetId,()=>providerReads++)
    const stored=await englishReviews(admin,job.establishment_id,job.organization_id),targetIds=new Set(job.targets.map(r=>r.id)),targets=stored.filter(r=>targetIds.has(r.id))
    const translations=matchedEnglishTranslations(targets,normalizeApifyDataset(items,'').reviews)
    for(let offset=0;offset<translations.length;offset+=50){const {error}=await admin.from('review_translations').upsert(translations.slice(offset,offset+50),{onConflict:'review_id,language'});if(error)throw new Error('ENGLISH_TRANSLATION_SAVE_FAILED')}
    log('ENGLISH_TRANSLATION_PERSISTED',{count:translations.length})
    const coverage=englishCoverage(await englishReviews(admin,job.establishment_id,job.organization_id))
    if(coverage.english_translation_missing)log('ENGLISH_TRANSLATION_MISSING',{count:coverage.english_translation_missing})
    log('GOOGLE_REVIEWS_ENGLISH_FETCH_COMPLETED',{run_id:run.runId})
    await checkpoint({status:'completed',result:{...coverage,provider_requests:job.provider_requests+providerReads},provider_requests:job.provider_requests+providerReads,completed_at:new Date().toISOString()})
    log('ENGLISH_TRANSLATION_BACKFILL_COMPLETED',{...coverage})
  }catch(error) {
    const code=error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)?error.message:'ENGLISH_BACKFILL_FAILED'
    if(code==='ENGLISH_BACKFILL_LEASE_LOST')return
    if(job.provider_run_id && error instanceof ApifyError && /^(APIFY_(TIMEOUT|UNAVAILABLE|RATE_LIMIT)|APIFY_HTTP_5\d\d|APIFY_DATASET_HTTP_5\d\d)$/.test(code)){await checkpoint({status:'running',error_code:code,provider_requests:job.provider_requests+providerReads});return}
    await checkpoint({status:'failed',error_code:code,provider_requests:job.provider_requests+providerReads,completed_at:new Date().toISOString()})
  }
}
