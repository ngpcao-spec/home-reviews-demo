import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2'
import {analysisTextForFreshReview,type AnalysisReview,type EnglishTranslationOverride} from './analysis-text.ts'
/** Read-only, org-scoped. Call only while building a new dataset, never on a stored snapshot. */
export async function freshEnglishAnalysisInputs(admin:SupabaseClient,reviews:(AnalysisReview&{id:string})[],organization:string,asOf:string){if(!reviews.length)return []
 if(reviews.some(r=>r.analysis_text!==undefined||r.analysis_source!==undefined))throw new Error('ENGLISH_OVERRIDE_FROZEN_INPUT')
 const ids=reviews.map(r=>r.id);if(new Set(ids).size!==ids.length)throw new Error('ENGLISH_OVERRIDE_REVIEW_IDS_INVALID')
 const {data,error}=await admin.rpc('read_analysis_english_translation_overrides',{p_organization:organization,p_review_ids:ids,p_as_of:asOf});if(error||!Array.isArray(data))throw new Error('ENGLISH_OVERRIDE_READ_FAILED')
 const overrides=new Map<string,EnglishTranslationOverride>();for(const row of data as EnglishTranslationOverride[]){if(!ids.includes(row.review_id)||overrides.has(row.review_id))throw new Error('ENGLISH_OVERRIDE_SCOPE_INVALID');overrides.set(row.review_id,row)}
 return await Promise.all(reviews.map(async review=>{const resolved=await analysisTextForFreshReview(review,overrides.get(review.id),asOf);if('analysis_translation_override' in resolved&&resolved.analysis_translation_override.status==='rejected')console.warn('ENGLISH_TRANSLATION_OVERRIDE_REJECTED',{review_id:review.id,errors:resolved.analysis_translation_override.errors});return resolved}))
}
