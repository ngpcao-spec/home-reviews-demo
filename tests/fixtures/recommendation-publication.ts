import {customerRatingStats} from '../../supabase/functions/_shared/customer-ratings';
import {directHash} from '../../supabase/functions/_shared/jev-direct-categories';
const org='10000000-0000-4000-8000-000000000001',est='20000000-0000-4000-8000-000000000001',report='40000000-0000-4000-8000-000000000001',source='50000000-0000-4000-8000-000000000001';
const cats=['quality','service','ambiance'] as const,labels=['positive','negative','mixed','neutral','not_mentioned','uncertain','refused','unavailable'] as const;
type Label=typeof labels[number];
export async function recommendationPublication(t=150,options:{positive?:number;negative?:number;mixed?:number;texts?:number;rating?:number;details?:unknown}={}){
 const {positive=0,negative=0,mixed=0,texts=t,rating=5}=options;
 const bindings=Array.from({length:t},(_,i)=>({id:'60000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),rating:1,published_at:'2026-10-26T00:00:00Z',review_detailed_rating:options.details??{Food:rating,Service:rating,Atmosphere:rating},
  analysis_text_sha256:i<texts?'a'.repeat(64):'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',review_context:{}}));
 const classification=(i:number):Label=>i<positive?'positive':i<positive+negative?'negative':i<positive+negative+mixed?'mixed':'not_mentioned';
 const categories=Object.fromEntries(cats.map(k=>[k,{denominator_reviews:texts,exclusive:Object.fromEntries(labels.map(l=>[l,Array.from({length:texts},(_,i)=>classification(i)).filter(v=>v===l).length])),
  positive_review_ids:bindings.slice(0,texts).filter((_,i)=>['positive','mixed'].includes(classification(i))).map(x=>x.id),negative_review_ids:bindings.slice(0,texts).filter((_,i)=>['negative','mixed'].includes(classification(i))).map(x=>x.id)}]));
 const statistics={scope:{source_reviews:t,analysed_text_reviews:texts,textless_statistics_only:t-texts},counts:{total_reviews:texts,received_results:texts,confidence_filter_applied:false,aggregation:'one_review_once_per_category; mixed_in_both_polarities; total_is_unique_source_reviews_never_sum_of_categories',categories}};
 return {establishment_id:est,organization_id:org,language:'vi',report_id:report,source_run_id:source,source_created_at:'2026-10-26T01:00:00Z',generated_at:'2026-10-26T01:01:00Z',stale:false,stale_reason:null,
  scope:{review_count:t,review_ids:bindings.map(x=>x.id),fingerprint:'fingerprint',source_run_id:source,organization_id:org,establishment_id:est,period_start:'2026-01-01',period_end:'2026-10-26',as_of:'2026-10-26'},
  source_bindings:bindings,evidence_bindings:[],provenance:{},
  document:{id:report,current_source_run_id:source,state:'completed',controls:{technical_checks_passed:true},statistics,source_report:{customer_rating_statistics:customerRatingStats(bindings)},
   derived_report:{statistics_sha256:await directHash(statistics),report:{positive_aspects:[{text:'An existing positive.',category:'quality',evidence_ids:[]}],negative_aspects:[{text:'An existing reservation.',category:'quality',evidence_ids:[]}]}}}};
}
