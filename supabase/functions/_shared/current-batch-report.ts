// General current-request preparation. No supplier transport, import or prompt override.
import {z} from 'npm:zod@4.6.5';
import {planInitialBatches,initialBatchIdentity,INITIAL_BATCH_CONTRACT,type TokenCounter} from './jev-review-batches.ts';
import {directHash,DIRECT_DEFINITIONS} from './jev-direct-categories.ts';
import {DIRECT_COVERAGE_VERSION} from './jev-direct-evidence-selection.ts';
import {verifyEvidenceSelector} from './report-evidence-selector.ts';
import {compactSolResponse,compactSolInstructions,COMPACT_SOL_WIRE} from './parallel-sol-wire.ts';
import {SOL_SIZE_POLICY} from './jls-sol-size.ts';
import {verifyParallelProtocol,type ParallelProtocol} from './parallel-report.ts';
export const CURRENT_BATCH_VERSION='jev-current-batches-initial-v1';
export const BATCH_TRANSPORT='batch_initial_v1';
export async function currentBatchManifest(protocol:{body:ParallelProtocol;sha256:string},count:TokenCounter){
 await verifyParallelProtocol(protocol.body,protocol.sha256);
 const p=protocol.body,d=p.current_delivery;
 if(!d||p.configuration.sol_wire_version!==COMPACT_SOL_WIRE||!p.configuration.evidence_selector)
  throw Error('CURRENT_BATCH_INITIAL_CONFIGURATION_REQUIRED');
 const selector=await verifyEvidenceSelector(p.configuration.evidence_selector);
 // Canonical order for every restaurant, never a special case for the reference corpus.
 const rows=p.source_snapshot.reviews.filter(r=>r.analysis_text).map(r=>({review_id:r.id,text:r.analysis_text!})).sort((a,b)=>a.review_id.localeCompare(b.review_id));
 if(!rows.length)throw Error('NO_TEXT_REVIEWS_AVAILABLE');
 const plans=[];for(const b of planInitialBatches(rows,count)){
  const identity=await initialBatchIdentity(b);
  plans.push({number:b.number,reviews:b.review_ids.length,review_ids:b.review_ids,request_wire:JSON.stringify(b.payload),request_sha256:identity.request_sha256,
   mapping:b.mapping,preflight:b.preflight,identity});
 }
 const stars=(rs:typeof p.source_snapshot.reviews)=>Object.fromEntries([1,2,3,4,5].map(s=>[s,rs.filter(r=>r.rating===s).length]));
 const statistics={scope:{source_reviews:p.source_snapshot.reviews.length,analysed_text_reviews:rows.length,textless_statistics_only:p.source_snapshot.reviews.length-rows.length},counts:{},
  star_distribution_all:stars(p.source_snapshot.reviews),star_distribution_analysed:stars(p.source_snapshot.reviews.filter(r=>r.analysis_text)),
  categories:DIRECT_DEFINITIONS,uncertainty_preserved:true,frequency_unit:'distinct_review_per_category_not_specific_incident'};
 const {$schema:_,...schema}=z.toJSONSchema(compactSolResponse);
 const request={model:'gpt-6.1-sol',reasoning:{effort:'low'},max_output_tokens:SOL_SIZE_POLICY.max_output_tokens,
  input:[{role:'system',content:compactSolInstructions(p.language as 'fr'|'vi')},{role:'user',content:'{}'}],
  text:{format:{type:'json_schema',name:'jls_direct4_compact_sol_v1',strict:true,schema}}};
 const body={version:CURRENT_BATCH_VERSION,transport:BATCH_TRANSPORT,organization_id:p.organization_id,establishment_id:p.establishment_id,
  authority_user_id:p.authority_user_id,language:p.language,current_delivery:d,reference:p.reference,frozen_report:p.frozen_report,
  snapshot:p.source_snapshot,snapshot_sha256:p.source_snapshot_sha256,source_protocol_sha256:protocol.sha256,plans,
  configuration:{jev:INITIAL_BATCH_CONTRACT,selector,sol_wire:COMPACT_SOL_WIRE,
   sol_model:request.model,sol_reasoning:request.reasoning,sol_max_output_tokens:request.max_output_tokens},
  template:{statistics,packet:{language:p.language},request_json:JSON.stringify(request),...(selector.version===DIRECT_COVERAGE_VERSION?{}:{evidence_selector:selector})},max_new_jev_calls:plans.length,
  max_sol_calls:1,max_luna_calls:0,max_apify_calls:0,automatic_retry:false};
 return {body,sha256:await directHash(body)};
}
export type CurrentBatchManifest=Awaited<ReturnType<typeof currentBatchManifest>>;
