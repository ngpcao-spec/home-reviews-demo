import {normalizeApifyDataset,type ApifyRunState} from './apify.ts';
export const INCREMENTAL_SYNC_VERSION='google-reviews-incremental-v1';
export const INCREMENTAL_ACTOR_BUILD='0.0.541';
export const INCREMENTAL_LIMIT=150;
export const INCREMENTAL_OVERLAP_MS=5000;
export type IncrementalCheckpoint={checkpoint_review_at:string|null;checkpoint_review_id:string|null;google_id:string;google_maps_url:string};
export function incrementalSince(job:IncrementalCheckpoint,now=Date.now()){
 if(!job.checkpoint_review_at||!job.checkpoint_review_id?.trim())throw Error('SYNC_INCREMENTAL_CHECKPOINT_MISSING');
 const value=job.checkpoint_review_at;
 if(!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value))||Date.parse(value)>now||Date.parse(value)<INCREMENTAL_OVERLAP_MS)throw Error('SYNC_INCREMENTAL_CHECKPOINT_INVALID');
 return new Date(Date.parse(value)-INCREMENTAL_OVERLAP_MS).toISOString();
}
export function incrementalRunReceipt(payload:Record<string,unknown>){
 const keys=['id','actId','buildId','status','statusMessage','startedAt','finishedAt','stats','usage','usageTotalUsd','chargedEventCounts','isMaxTotalChargeUsdReached','isMaxItemsReached'];
 return Object.fromEntries(keys.filter(k=>payload[k]!==undefined).map(k=>[k,payload[k]]));
}
export function assertIncrementalReceipt(receipt:Record<string,unknown>){
 const message=typeof receipt.statusMessage==='string'?receipt.statusMessage:'';
 const failed=/(\d+)\s+failed/i.exec(message);
 if(receipt.isMaxTotalChargeUsdReached===true||receipt.isMaxItemsReached===true||failed&&Number(failed[1])>0||/(?:charge|billing|budget|item limit).*(?:reached|exceeded)|partial result/i.test(message))throw Error('SYNC_INCREMENTAL_PROVIDER_PARTIAL');
}
/** Review IDs, not response position or a first-known-ID stop, define novelty. */
export function prepareIncrementalResult(items:Record<string,unknown>[],job:IncrementalCheckpoint,run:ApifyRunState,legacy=false,now=Date.now()){
 const since=incrementalSince(job,now);
 if(run.status!=='SUCCEEDED')throw Error('SYNC_INCREMENTAL_RUN_NOT_SUCCESSFUL');
 const page=normalizeApifyDataset(items,job.google_maps_url);
 if(page.reviews.length!==items.length)throw Error('SYNC_INCREMENTAL_INVALID_REVIEW');
 for(const item of items)if(String(item.cid??'')!==job.google_id)throw Error('SYNC_INCREMENTAL_IDENTITY_MISMATCH');
 const byId=new Map<string,typeof page.reviews[number]>();
 for(const review of page.reviews){
  if(!review.externalReviewId.trim()||!review.publishedAt||!Number.isFinite(Date.parse(review.publishedAt))||Date.parse(review.publishedAt)>now||review.rating<1||review.rating>5)throw Error('SYNC_INCREMENTAL_INVALID_REVIEW');
  const prior=byId.get(review.externalReviewId);
  if(prior&&(prior.publishedAt!==review.publishedAt||prior.rating!==review.rating||prior.text!==review.text||prior.translatedText!==review.translatedText))throw Error('SYNC_INCREMENTAL_CONFLICTING_DUPLICATE');
  byId.set(review.externalReviewId,review);
 }
 const unique=[...byId.values()].sort((a,b)=>Date.parse(b.publishedAt!)-Date.parse(a.publishedAt!)||(a.externalReviewId<b.externalReviewId?-1:a.externalReviewId>b.externalReviewId?1:0));
 const crossed=unique.some(r=>Date.parse(r.publishedAt!)<Date.parse(since));
 // A previously started full window is reusable if it demonstrably crosses the frozen boundary.
 if(items.length>=INCREMENTAL_LIMIT&&!(legacy&&crossed))throw Error('SYNC_INCREMENTAL_LIMIT_REACHED');
 if(unique.length&&!unique.some(r=>r.externalReviewId===job.checkpoint_review_id||Date.parse(r.publishedAt!)<Date.parse(job.checkpoint_review_at!)))throw Error('SYNC_INCREMENTAL_BOUNDARY_NOT_REACHED');
 const reviews=unique.filter(r=>Date.parse(r.publishedAt!)>=Date.parse(since));
 const newest=reviews[0];
 const head=newest&&Date.parse(newest.publishedAt!)>Date.parse(job.checkpoint_review_at!)?{id:newest.externalReviewId,at:newest.publishedAt}:{id:job.checkpoint_review_id,at:job.checkpoint_review_at};
 return {page,reviews,head,since,received:items.length,unique:unique.length,external_ids:unique.map(r=>r.externalReviewId),outside_window:unique.length-reviews.length,empty:items.length===0,legacy};
}
