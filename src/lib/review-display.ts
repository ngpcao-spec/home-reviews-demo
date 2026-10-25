import {supabase} from './supabase'
import type {PreferredLanguage} from '../types/domain'
export interface ReviewDisplay {review_id:string;language:PreferredLanguage;original_text:string;source_sha256:string;status:string;translated_text?:string|null;source_language?:string|null;error_code?:string|null}
type Waiting={id:string;resolve:(r:ReviewDisplay)=>void;reject:(e:Error)=>void}
const batches=new Map<string,Waiting[]>()
/** Mounted visible reviews share one authenticated request. Server selects the account language. */
export function readReviewDisplay(account:string,language:PreferredLanguage,id:string):Promise<ReviewDisplay>{
 const batchKey=`${account}:${language}`
 return new Promise((resolve,reject)=>{
  const pending=batches.get(batchKey)
  if(pending){pending.push({id,resolve,reject});return}
  batches.set(batchKey,[{id,resolve,reject}])
  setTimeout(()=>{
   const waiting=batches.get(batchKey)??[];batches.delete(batchKey)
   const ids=[...new Set(waiting.map(w=>w.id))]
   for(let n=0;n<ids.length;n+=30){
    const group=ids.slice(n,n+30),listeners=waiting.filter(w=>group.includes(w.id))
    void(async()=>{
     try{
      if(!supabase)throw Error('TRANSLATION_UNAVAILABLE')
      const {data,error}=await supabase.rpc('read_review_display',{p_reviews:group,p_prepare:false})
      if(error)throw Error('TRANSLATION_UNAVAILABLE')
      for(const w of listeners){const row=(data as ReviewDisplay[]).find(r=>r.review_id===w.id&&r.language===language);if(row)w.resolve(row);else w.reject(Error('DISPLAY_LANGUAGE_CHANGED'))}
     }catch{for(const w of listeners)w.reject(Error('TRANSLATION_UNAVAILABLE'))}
    })()
   }
  },25)
 })
}
