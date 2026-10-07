import {requireUser,assertMembership} from '../_shared/auth.ts'
import {enforceRateLimit} from '../_shared/rate-limit.ts'
import {representativeHandler,REFERENCE_GOLD,PREVIOUS_ADJUDICATION,type CorrectedReference,type RepresentativeTest} from '../_shared/representative-api.ts'
import type {GoldSource,GoldBenchmark,GoldLabel} from '../_shared/gold-core.ts'
import type {RepresentativeItem} from '../_shared/representative-selection.ts'
// No provider clients. Only own test RPCs write; V2 is created separately, once.
Deno.serve(representativeHandler(async request=>{
  const context=await requireUser(request);if(request.method==='POST')enforceRateLimit('representative:'+context.user.id,60,60_000)
  const identity=await context.admin.from('analysis_gold_sets').select('organization_id').eq('id',REFERENCE_GOLD).single();if(identity.error||!identity.data)throw new Error('HOLDOUT_SOURCE_INVALID')
  const org=identity.data.organization_id;await assertMembership(context.client,context.user.id,org,['owner','admin','manager'])
  const get=async(id?:string)=>{let query=context.admin.from('analysis_representative_human_tests').select('*').eq('organization_id',org);query=id?query.eq('id',id):query.eq('name','shabu-v7-representative-holdout-v1');const {data,error}=await query.maybeSingle();if(error)throw new Error('HOLDOUT_READ_FAILED');if(id&&!data)throw new Error('HOLDOUT_NOT_FOUND');return data as RepresentativeTest|null}
  const reference=async()=>{const {data,error}=await context.admin.from('analysis_corrected_references').select('*').eq('organization_id',org).eq('source_gold_set_id',REFERENCE_GOLD).eq('source_adjudication_id',PREVIOUS_ADJUDICATION).eq('status','completed').single();if(error||!data)throw new Error('HOLDOUT_REFERENCE_REQUIRED');return data as CorrectedReference}
  const children=async(table:'analysis_representative_human_test_items'|'analysis_representative_human_labels',id:string)=>{await get(id);const {data,error}=await context.admin.from(table).select('*').eq('test_id',id).limit(1000);if(error)throw new Error('HOLDOUT_READ_FAILED');return data??[]}
  return {user:context.user.id,get,
    selection:async()=>{const r=await reference();const [snapshot,gold,previous,seen]=await Promise.all([
      context.admin.from('historical_report_runs').select('status,snapshot').eq('generation_id',r.source_generation_id).eq('organization_id',org).single(),
      context.admin.from('analysis_gold_set_reviews').select('review_id').eq('gold_set_id',REFERENCE_GOLD).limit(1000),
      context.admin.from('analysis_gold_adjudications').select('id,status,comparison').eq('id',PREVIOUS_ADJUDICATION).eq('organization_id',org).single(),
      context.admin.from('analysis_gold_adjudication_items').select('review_id').eq('adjudication_id',PREVIOUS_ADJUDICATION).limit(1000)])
      if(snapshot.error||gold.error||previous.error||seen.error||snapshot.data?.status!=='completed'||snapshot.data?.snapshot.analysis_version!==7||previous.data?.status!=='completed')throw new Error('HOLDOUT_SOURCE_INVALID');const c=previous.data.comparison
      return {reference:r,reviews:(snapshot.data.snapshot.reviews as GoldSource['snapshot']['reviews']).map(({id,analysis_text,analysis_language})=>({id,analysis_text,analysis_language})),goldIds:(gold.data??[]).map(x=>x.review_id),previousIds:(seen.data??[]).map(x=>x.review_id),previous:{id:previous.data.id,comparable_labels:c.comparable_labels,human_uncertain:c.human_uncertain,jev_agreement_percent:c.jev.agreement_with_human_percent,sol_agreement_percent:c.sol.agreement_with_human_percent}}
    },
    predictions:async()=>{const r=await reference();const [source,benchmark]=await Promise.all([context.admin.from('historical_report_runs').select('generation_id,organization_id,establishment_id,status,snapshot,findings').eq('generation_id',r.source_generation_id).eq('organization_id',org).single(),context.admin.from('jev_benchmark_runs').select('id,organization_id,establishment_id,source_generation_id,source_analysis_version,status,benchmark_type,repeat_count,served_models,decisions').eq('id',r.jev_benchmark_id).eq('organization_id',org).single()]);if(source.error||benchmark.error)throw new Error('HOLDOUT_SOURCE_INVALID');return {source:source.data as GoldSource,benchmark:benchmark.data as GoldBenchmark}},
    items:async id=>await children('analysis_representative_human_test_items',id) as RepresentativeItem[],labels:async id=>await children('analysis_representative_human_labels',id) as GoldLabel[],
    create:async payload=>{const {data,error}=await context.admin.rpc('create_representative_human_test',payload);if(error||!data)throw new Error('HOLDOUT_CREATE_FAILED');return data as string},
    write:async(id,revision,action,payload)=>{const {error}=await context.admin.rpc('write_representative_human_test',{p_user:context.user.id,p_id:id,p_revision:revision,p_action:action,p_payload:payload});if(error){const code=['HOLDOUT_IMMUTABLE','HOLDOUT_REVISION_CHANGED','HOLDOUT_INCOMPLETE','HOLDOUT_THEME_INVALID','FORBIDDEN'].find(c=>error.message.includes(c));throw new Error(code??'HOLDOUT_SAVE_FAILED')}}
  }
}))
