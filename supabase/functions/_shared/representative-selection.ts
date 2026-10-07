// Selection boundary: English snapshot text + seen review IDs ONLY.
// No ratings, model outputs, labels, sentiments, probabilities or disagreements.
export interface AnalyticCandidate {id:string;analysis_text:string;analysis_language?:string}
export interface RepresentativeItem {review_id:string;position:number;analysis_text_sha256:string;selection_rank_hash:string;excluded:boolean;confirmed_at?:string|null}
export async function holdoutHash(value:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('')}
export const holdoutSeed=(sourceId:string)=>sourceId+':representative-holdout-v1:'
export async function representativePool(sourceId:string,reviews:AnalyticCandidate[],goldIds:string[],previousIds:string[]) {
  const texts=reviews.filter(r=>r.analysis_text?.trim()),gold=new Set(goldIds),previous=new Set(previousIds),seen=new Set([...gold,...previous])
  if(new Set(reviews.map(r=>r.id)).size!==reviews.length||texts.some(r=>r.analysis_language!=='en'))throw new Error('HOLDOUT_ENGLISH_SOURCE_REQUIRED')
  const seed=holdoutSeed(sourceId),ranked=await Promise.all(texts.filter(r=>!seen.has(r.id)).map(async r=>({review_id:r.id,analysis_text_sha256:await holdoutHash(r.analysis_text),selection_rank_hash:await holdoutHash(seed+r.id)})))
  ranked.sort((a,b)=>a.selection_rank_hash<b.selection_rank_hash?-1:a.selection_rank_hash>b.selection_rank_hash?1:a.review_id.localeCompare(b.review_id))
  return {seed,ranked,stats:{total_text_reviews:texts.length,excluded_gold_reviews:texts.filter(r=>gold.has(r.id)).length,excluded_previous_adjudication:texts.filter(r=>previous.has(r.id)).length,excluded_previous_additional:texts.filter(r=>previous.has(r.id)&&!gold.has(r.id)).length,eligible_holdout_reviews:ranked.length}}
}
export async function selectRepresentativeItems(sourceId:string,reviews:AnalyticCandidate[],goldIds:string[],previousIds:string[]){const pool=await representativePool(sourceId,reviews,goldIds,previousIds);if(pool.ranked.length<12)throw new Error('HOLDOUT_INSUFFICIENT_REVIEWS');return {items:pool.ranked.slice(0,12).map((r,i)=>({...r,position:i+1,excluded:false})),stats:pool.stats,seed:pool.seed}}
export async function representativeReplacement(sourceId:string,reviews:AnalyticCandidate[],goldIds:string[],previousIds:string[],items:RepresentativeItem[],reviewId:string){const current=items.find(i=>i.review_id===reviewId&&!i.excluded);if(!current)throw new Error('HOLDOUT_REVIEW_INVALID');const used=new Set(items.map(i=>i.review_id)),pool=await representativePool(sourceId,reviews,goldIds,previousIds),next=pool.ranked.find(r=>!used.has(r.review_id));if(!next)throw new Error('HOLDOUT_REPLACEMENT_UNAVAILABLE');return {...next,position:current.position,excluded:false}}
