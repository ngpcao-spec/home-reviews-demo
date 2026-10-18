// Explicit technical mocks; no reference annotations or supplier predictions are created.
import frozen from './jev-boundaries-targeted9.json';
import criteria from '../../docs/jev-boundaries-targeted9-criteria-20261018.json';
import {prepareTargetedJev,parseTargetedJevResult,type TargetCriteria} from '../../supabase/functions/_shared/jev-boundaries-targeted-protocol';
import {CHILL80_BENCHMARK,CHILL80_SOURCE,CHILL80_TARGETED,type Chill80Input} from '../../supabase/functions/_shared/jev-chill-reanalysis80';
import {THEME_KEYS,type ThemeDecision} from '../../supabase/functions/_shared/jev-themes';
import {economicThemeResults} from '../../supabase/functions/_shared/jev-economy-cache';
import {hybridHash} from '../../supabase/functions/_shared/jev-hybrid-evidence';
import {negativeHash} from '../../supabase/functions/_shared/negative-validation-core';
export const syntheticJev=()=>({model:'jev-1.13.0',usage:{input_tokens:10,output_tokens:0},
 answers:Object.fromEntries(THEME_KEYS.map(k=>[k,{type:'choice',choice:'absent',probabilities:{absent:1,positive:0,negative:0,both:0}}]))});
export async function syntheticChill80():Promise<Chill80Input>{
 const reviews=structuredClone(frozen.source.reviews);
 for(let i=10;i<=100;i++){const text=i<=80?'Synthetic English review '+i+'.':'';
  reviews.push({...structuredClone(reviews[0]),id:'00000000-0000-4000-8000-'+String(i).padStart(12,'0'),
   rating:i%5+1,original_text:text,original_text_sha256:await negativeHash(text),analysis_text:text||null,
   analysis_text_sha256:text?await negativeHash(text):null,analysis_language:text?'en':null});}
 const source={id:frozen.source.source_protocol.id,body:{organization_id:reviews[0].organization_id,establishment_id:reviews[0].establishment_id,
  authority_user_id:frozen.source.source_protocol.authority_user_id,frozen_v2:{historical_run_id:CHILL80_SOURCE},
  snapshot:{source_sha256:await hybridHash(reviews),source:{reviews}}},sha256:''};source.sha256=await hybridHash(source.body);
 const native={themes:Object.fromEntries(THEME_KEYS.map(k=>[k,{choice:'absent',probabilities:{absent:1,positive:0,negative:0,both:0}}]))} as ThemeDecision;
 const baseline=reviews.filter(r=>r.analysis_text).map(r=>({id:r.id,review_id:r.id,organization_id:r.organization_id,establishment_id:r.establishment_id,
  configuration_id:'v12_economy_1pass_v1',analysis_text_sha256:r.analysis_text_sha256!,instruction_sha256:frozen.baseline[0].instruction_sha256,
  threshold_sha256:frozen.baseline[0].threshold_sha256,served_model:'jev-1.13.0',status:'completed',response:structuredClone(native),theme_results:economicThemeResults(native)}));
 const refs=await Promise.all(baseline.slice(0,9).map(async b=>({review_id:b.review_id,cache_id:b.id,analysis_text_sha256:b.analysis_text_sha256,
  configuration_id:b.configuration_id,instruction_sha256:b.instruction_sha256,threshold_sha256:b.threshold_sha256,served_model:b.served_model,
  response_sha256:await hybridHash(b.response),theme_results_sha256:await hybridHash(b.theme_results)})));
 const bp=await prepareTargetedJev({source_protocol:{id:source.id,sha256:source.sha256,snapshot_sha256:source.body.snapshot.source_sha256,
  authority_user_id:source.body.authority_user_id},reviews:reviews.slice(0,9)},criteria as TargetCriteria,refs);
 const ebody={targeted_protocol_id:CHILL80_TARGETED,protocol_sha256:bp.sha256},records=[];
 for(const r of bp.body.reviews){const suffix=String(r.position).padStart(2,'0'),raw=syntheticJev();
  const a={review_id:r.id,attempt_count:1,request_sha256:r.request_sha256,execution_id:CHILL80_BENCHMARK};
  const aid='attempt-'+suffix,rid='receipt-'+suffix;
  const t={review_id:r.id,execution_id:CHILL80_BENCHMARK,attempt_id:aid,attempt_count:1,protocol_sha256:bp.sha256,http_status:200,
   requested_model:'jev-latest',analysis_text_sha256:r.analysis_text_sha256,request_sha256:r.request_sha256,request_raw_sha256:r.request_raw_sha256,
   raw_response_text:JSON.stringify(raw),response_raw_sha256:await negativeHash(JSON.stringify(raw)),duration_ms:1};
  const result={review_id:r.id,execution_id:CHILL80_BENCHMARK,receipt_id:rid,attempt_id:aid,configuration_sha256:bp.body.configuration_sha256,
   protocol_sha256:bp.sha256,request_sha256:r.request_sha256,status:'completed',error:null,result:await parseTargetedJevResult(bp,r.id,raw)};
  records.push({id:aid,kind:'jev_targeted9_attempt_'+suffix,body:a,sha256:await hybridHash(a)},
   {id:rid,kind:'jev_targeted9_receipt_'+suffix,body:t,sha256:await hybridHash(t)},
   {id:'result-'+suffix,kind:'jev_targeted9_result_'+suffix,body:result,sha256:await hybridHash(result)});
 }
 return {source,baseline,benchmark_protocol:{...bp,id:CHILL80_TARGETED},benchmark_execution:{id:CHILL80_BENCHMARK,kind:'jev_targeted9_execution_v1',body:ebody,sha256:await hybridHash(ebody)},benchmark_records:records};
}
