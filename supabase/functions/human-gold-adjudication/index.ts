import {requireUser,assertMembership} from '../_shared/auth.ts'
import {enforceRateLimit} from '../_shared/rate-limit.ts'
import {adjudicationHandler,type Adjudication} from '../_shared/gold-adjudication-api.ts'
import {ADJUDICATION_GOLD_ID,type AdjudicationItem,type AdjudicationLabel} from '../_shared/gold-adjudication-core.ts'
import type {GoldSet} from '../_shared/gold-api.ts'
import type {GoldSource,GoldBenchmark,GoldReview,GoldLabel} from '../_shared/gold-core.ts'
// Only the new adjudication RPCs write; all original resources are SELECT only.
Deno.serve(adjudicationHandler(async request=>{
  const context=await requireUser(request);if(request.method==='POST')enforceRateLimit('adjudication:'+context.user.id,120,60_000)
  const identity=await context.admin.from('analysis_gold_sets').select('organization_id').eq('id',ADJUDICATION_GOLD_ID).single();if(identity.error||!identity.data)throw new Error('ADJUDICATION_GOLD_REQUIRED')
  const org=identity.data.organization_id;await assertMembership(context.client,context.user.id,org,['owner','admin','manager'])
  const get=async(id?:string)=>{let query=context.admin.from('analysis_gold_adjudications').select('*').eq('organization_id',org).eq('gold_set_id',ADJUDICATION_GOLD_ID);query=id?query.eq('id',id):query.eq('name','shabu-v7-human-check-v1');const {data,error}=await query.maybeSingle();if(error)throw new Error('ADJUDICATION_READ_FAILED');if(id&&!data)throw new Error('ADJUDICATION_NOT_FOUND');return data as Adjudication|null}
  async function rows(table:'analysis_gold_set_reviews'|'analysis_gold_labels',goldId:string){const dataRows=[];for(let offset=0;;offset+=500){let query=context.admin.from(table).select('*').eq('gold_set_id',goldId).order('review_id');if(table==='analysis_gold_labels')query=query.order('theme_key');const {data,error}=await query.range(offset,offset+499);if(error)throw new Error('ADJUDICATION_READ_FAILED');dataRows.push(...data??[]);if((data?.length??0)<500)break}return dataRows}
  const children=async(table:'analysis_gold_adjudication_items'|'analysis_gold_adjudication_labels',id:string)=>{await get(id);const {data,error}=await context.admin.from(table).select('*').eq('adjudication_id',id).limit(100);if(error)throw new Error('ADJUDICATION_READ_FAILED');return data??[]}
  return {user:context.user.id,get,
    loadBundle:async()=>{
      const {data:g,error}=await context.admin.from('analysis_gold_sets').select('*').eq('id',ADJUDICATION_GOLD_ID).eq('organization_id',org).single();if(error||!g)throw new Error('ADJUDICATION_GOLD_REQUIRED')
      const [source,benchmark,goldReviews,goldLabels]=await Promise.all([context.admin.from('historical_report_runs').select('generation_id,organization_id,establishment_id,status,snapshot,findings').eq('generation_id',g.source_generation_id).eq('organization_id',org).single(),context.admin.from('jev_benchmark_runs').select('id,organization_id,establishment_id,source_generation_id,source_analysis_version,status,benchmark_type,repeat_count,served_models,decisions').eq('id',g.jev_benchmark_id).eq('organization_id',org).single(),rows('analysis_gold_set_reviews',g.id),rows('analysis_gold_labels',g.id)])
      if(source.error||benchmark.error||!source.data||!benchmark.data)throw new Error('ADJUDICATION_SOURCE_CHANGED')
      return {gold:g as GoldSet,source:source.data as GoldSource,benchmark:benchmark.data as GoldBenchmark,goldReviews:goldReviews as GoldReview[],goldLabels:goldLabels as GoldLabel[]}
    },items:async id=>await children('analysis_gold_adjudication_items',id) as AdjudicationItem[],labels:async id=>await children('analysis_gold_adjudication_labels',id) as AdjudicationLabel[],
    create:async payload=>{const {data,error}=await context.admin.rpc('create_gold_adjudication',payload);if(error||!data)throw new Error('ADJUDICATION_CREATE_FAILED');return data as string},
    write:async(id,revision,action,payload)=>{const {error}=await context.admin.rpc('write_gold_adjudication',{p_user:context.user.id,p_id:id,p_revision:revision,p_action:action,p_payload:payload});if(error){const code=['ADJUDICATION_IMMUTABLE','ADJUDICATION_REVISION_CHANGED','ADJUDICATION_INCOMPLETE','ADJUDICATION_THEME_INVALID','FORBIDDEN'].find(c=>error.message.includes(c));throw new Error(code??'ADJUDICATION_SAVE_FAILED')}},
  }
}))
