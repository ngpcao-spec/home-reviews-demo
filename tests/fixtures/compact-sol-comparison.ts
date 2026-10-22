import {directHash,directCategoryCounts,DIRECT_CATEGORY_KEYS,parseDirectCategoriesRounded} from '../../supabase/functions/_shared/jev-direct-categories.ts';
import {analysisTextSha256} from '../../supabase/functions/_shared/analysis-text.ts';
import {SHORT_CLASSIFIER_CONFIG} from '../../supabase/functions/_shared/jev-direct-short-config.ts';
import {directReportCandidates,DIRECT_SYNTHESIS_VERSION,type DirectReportInput} from '../../supabase/functions/_shared/jev-direct-report-preparation.ts';
import {prepareCompactComparison,type CompactComparisonArchive} from '../../supabase/functions/_shared/compact-sol-comparison.ts';
import {SHORT_CONFIG} from '../../supabase/functions/_shared/direct4-short-comparison.ts';
import {COMPACT_REUSED_SOURCE} from '../../supabase/functions/_shared/jls-direct4-candidates.ts';

// Explicit synthetic native results. Never submitted to a provider or used as
// annotations/quality references. Shared by offline Vitest and Deno tests.
export async function compactComparisonFixture(reused:boolean|'parallel'=false){
 const org=crypto.randomUUID(),est=crypto.randomUUID(),pid=crypto.randomUUID(),authority=crypto.randomUUID();
 const parallel=reused==='parallel',config=reused&&!parallel?SHORT_CONFIG:SHORT_CLASSIFIER_CONFIG;
 const sourceCount=reused?100:135,textCount=parallel?68:reused?91:75,analysedCount=parallel?68:reused?87:75;
 const sources=await Promise.all(Array.from({length:sourceCount},async(_,i)=>{
  const text=i<textCount?`EXPLICIT SYNTHETIC REVIEW ${i}. Friendly staff, tasty food, a quiet room and fair prices, but sometimes slow service.`:'';
  return {id:crypto.randomUUID(),organization_id:org,establishment_id:est,rating:5,original_text:text,original_text_sha256:await analysisTextSha256(text),analysis_text:text||null,analysis_text_sha256:text?await analysisTextSha256(text):null};
 }));
 const rows=await Promise.all(sources.slice(0,analysedCount).map(async r=>{
  const raw={model:'jev-1.13.0',answers:Object.fromEntries(DIRECT_CATEGORY_KEYS.map(k=>[k,{type:'choice',choice:k==='service'?'mixed':'positive'}]))};
  const raw_response_text=JSON.stringify(raw),result=parseDirectCategoriesRounded(raw);
  return {review_id:r.id,organization_id:org,establishment_id:est,analysis_text:r.analysis_text!,analysis_text_sha256:r.analysis_text_sha256!,analysis_language:'en',result,result_sha256:await directHash(result),
   raw_response_text,response_raw_sha256:await analysisTextSha256(raw_response_text),translation_source:'original_en',translation_provenance:{original_language:'en'},receipt_id:crypto.randomUUID()};
 }));
 const body={version:'jev-direct-categories4-dataset-v1',configuration_id:config.id,configuration_sha256:await directHash(config),reviews:rows,counts:directCategoryCounts(rows.map(r=>r.review_id),rows)},
  dataset={id:crypto.randomUUID(),protocol_id:pid,organization_id:org,body,sha256:await directHash(body)},snapshotBody={reviews:sources,source_reviews_sha256:await directHash(sources)};
 const input:DirectReportInput={dataset,snapshot:{id:pid,protocol_id:pid,organization_id:org,body:snapshotBody,sha256:await directHash(snapshotBody)},prior_luna_requests:[]};
 const selected=(await directReportCandidates(input)).slice(0,32),originals=[...new Set(selected.map(e=>e.review_id))].map(review_id=>{
  const r=sources.find(r=>r.id===review_id)!;return {review_id,original_text:r.original_text,original_text_sha256:r.original_text_sha256,analysis_text_sha256:r.analysis_text_sha256!,translation_source:'original_en',translation_provenance:{original_language:'en'}};
 });
 const statistics={scope:parallel?{source_reviews:100,analysed_text_reviews:68,textless_statistics_only:32}:reused?{source_reviews:100,analysed_text_reviews:87,textless_statistics_only:9,technical_missing_reviews:4,textual_source_reviews:91}:{source_reviews:135,analysed_text_reviews:75,textless_statistics_only:60},counts:body.counts,star_distribution_all:{5:sources.length}};
 const source={reference_archive:{id:crypto.randomUUID(),sha256:'a'.repeat(64)},source_run_id:crypto.randomUUID(),source_protocol_id:pid,source_protocol_sha256:'b'.repeat(64),organization_id:org,establishment_id:est,authority_user_id:authority,
  bundle_sha256:'c'.repeat(64),dataset_sha256:dataset.sha256,sources,statistics,statistics_sha256:await directHash(statistics),selected,originals,synthesis:DIRECT_SYNTHESIS_VERSION,
  ...(reused?{source_binding:{version:COMPACT_REUSED_SOURCE,dataset_binding:{dataset_id:dataset.id,dataset_sha256:dataset.sha256,snapshot_id:pid,snapshot_sha256:await directHash(snapshotBody),source_reviews:100,text_reviews:analysedCount,technical_missing_review_ids:sources.slice(analysedCount,textCount).map(r=>r.id),classification_configuration:{id:config.id,sha256:await directHash(config)}},analysed_review_ids:rows.map(r=>r.review_id),corpus_archive:{id:crypto.randomUUID(),sha256:'d'.repeat(64)},classification_archive:{id:crypto.randomUUID(),sha256:'e'.repeat(64)},classification_protocol:{id:crypto.randomUUID(),sha256:'f'.repeat(64)}}}:{} )};
 const archiveBody={version:reused?COMPACT_REUSED_SOURCE:'jls-direct4-no-luna-comparison-archive-v1',organization_id:org,establishment_id:est,protocol:{body:{source}},source_input:{dataset}};
 const archive={id:crypto.randomUUID(),body:archiveBody,sha256:await directHash(archiveBody)} as unknown as CompactComparisonArchive;
 return {archive,protocol:await prepareCompactComparison(archive,'a'.repeat(40))};
}
