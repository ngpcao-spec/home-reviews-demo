// Per-review logical identity. Batch aliases/order are transport metadata and
// remain on the original task/receipt; they are never individual fake receipts.
import {directHash} from './jev-direct-categories.ts';
import {analysisTextSha256} from './analysis-text.ts';
import {INITIAL_BATCH_CONTRACT,planInitialBatches,initialBatchIdentity,type TokenCounter} from './jev-review-batches.ts';
import {chosenAnalysisText} from './chosen-analysis-text.ts';
export const SHARED_JEV_VERSION='shared-jev-initial-v1';
export const SHARED_JEV_COMPATIBILITY={version:SHARED_JEV_VERSION,model:INITIAL_BATCH_CONTRACT.model,
 configuration_sha256:INITIAL_BATCH_CONTRACT.common_configuration_sha256,
 instructions_sha256:INITIAL_BATCH_CONTRACT.common_instructions_sha256,parser:'jev-direct-categories-parser-v1.1-rounding'};
export interface SharedSource {id:string;google_review_id?:string;organization_id:string;establishment_id:string;
 analysis_text:string|null;analysis_text_sha256:string|null;analysis_language:string|null}
export async function sharedJevIdentity(r:SharedSource){
 if(!r.analysis_text)return null;
 if(!r.google_review_id?.trim()||await analysisTextSha256(r.analysis_text)!==r.analysis_text_sha256)throw Error('SHARED_JEV_SOURCE_INCOMPATIBLE');
 const body={...SHARED_JEV_COMPATIBILITY,organization_id:r.organization_id,establishment_id:r.establishment_id,
  google_review_id:r.google_review_id,analysis_text_sha256:r.analysis_text_sha256,analysis_language:r.analysis_language??'und'};
 return {review_id:r.id,body,sha256:await directHash(body)};
}
export async function sharedJevIdentities(rows:SharedSource[]){
 const refs=(await Promise.all(rows.map(sharedJevIdentity))).filter((x):x is NonNullable<typeof x>=>x!==null);
 if(new Set(refs.map(r=>r.review_id)).size!==refs.length||new Set(refs.map(r=>r.sha256)).size!==refs.length)throw Error('SHARED_JEV_DUPLICATE_REVIEW');
 return refs;
}
export async function sharedBatchPlans(rows:{review_id:string;text:string}[],count:TokenCounter){
 const plans=[];
 for(const b of planInitialBatches([...rows].sort((a,b)=>a.review_id.localeCompare(b.review_id)),count)){
  const identity=await initialBatchIdentity(b);plans.push({number:b.number,reviews:b.review_ids.length,review_ids:b.review_ids,
   request_wire:JSON.stringify(b.payload),request_sha256:identity.request_sha256,mapping:b.mapping,preflight:b.preflight,identity});
 }return plans;
}
export interface SharedAnalysisRow {review_id:string;identity:Awaited<ReturnType<typeof sharedJevIdentity>>;
 state:string;task_id:string|null;source_review_id:string|null;result:unknown;result_sha256:string|null;receipt_sha256:string|null;
 question_keys:unknown;request_sha256:string|null}
// Uses the same chosen-text policy as manual reports, with no translation call.
export async function automaticJevSnapshot(raw:{organization_id:string;establishment_id:string;language:'fr'|'vi';reviews:Record<string,unknown>[]}){
 const reviews=[];
 for(const row of raw.reviews){
  const chosen=await chosenAnalysisText(row as unknown as Parameters<typeof chosenAnalysisText>[0],raw.language);
  if(!chosen.analysis_text)continue;
  reviews.push({...row,id:String(row.id),google_review_id:String(row.external_review_id??''),organization_id:raw.organization_id,
   establishment_id:raw.establishment_id,...chosen,translation_provenance:chosen.analysis_translation_provenance});
 }
 return {reviews};
}
export function sharedMissingIds(rows:{review_id:string;state:string;owned:boolean;task_id:string|null}[]){
 if(rows.some(r=>['unknown','failed','expired'].includes(r.state)))throw Error('SHARED_JEV_PREVIOUS_ATTEMPT_BLOCKED');
 return rows.filter(r=>r.state==='pending'&&r.owned&&!r.task_id).map(r=>r.review_id);
}
