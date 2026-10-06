import {supabase} from './supabase'
export interface EnglishCoverage {stored_reviews:number;reviews_with_text:number;original_english:number;english_translation_found:number;english_translation_missing:number;coverage_percent:number}
export interface EnglishStatus {coverage:EnglishCoverage;job:{id:string;status:string;error_code?:string;created_at?:string}|null}
export async function englishBackfillApi(establishment:string,method:'GET'|'POST'='GET'):Promise<EnglishStatus> {
  if(!supabase)throw new Error('UNAUTHORIZED')
  const {data,error}=await supabase.functions.invoke('backfill-review-english-translations'+(method==='GET'?'?establishment_id='+encodeURIComponent(establishment):''),{method,...(method==='POST'?{body:{establishment_id:establishment}}:{})})
  if(error){let code='ENGLISH_BACKFILL_UNCONFIRMED';const response=(error as {context?:Response}).context;if(response instanceof Response){try{const result=await response.clone().json();if(typeof result.error==='string')code=result.error}catch{/* no transport body exposure */}}throw new Error(code)}
  return data as EnglishStatus
}
