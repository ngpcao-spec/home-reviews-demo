import {requireUser,assertMembership} from '../_shared/auth.ts'
import {goldHandler,type GoldSet} from '../_shared/gold-api.ts'
import {GOLD_SOURCE,GOLD_BENCHMARK,type GoldSource,type GoldBenchmark,type GoldReview,type GoldLabel} from '../_shared/gold-core.ts'
import {enforceRateLimit} from '../_shared/rate-limit.ts'
// Existing report/benchmark capabilities are SELECT only. No model/provider imports.
Deno.serve(goldHandler(async request=>{
  const context=await requireUser(request)
  if(request.method==='POST')enforceRateLimit('gold:'+context.user.id,60,60_000)
  const identity=await context.admin.from('historical_report_runs').select('organization_id').eq('generation_id',GOLD_SOURCE).single()
  if(identity.error||!identity.data)throw new Error('GOLD_SOURCE_INVALID')
  const organization=identity.data.organization_id
  await assertMembership(context.client,context.user.id,organization,['owner','admin','manager'])
  const authorizedSet=async(id?:string)=>{
    let read=context.admin.from('analysis_gold_sets').select('*').eq('organization_id',organization).eq('source_generation_id',GOLD_SOURCE).eq('jev_benchmark_id',GOLD_BENCHMARK)
    read=id?read.eq('id',id):read.eq('name','shabu-v7-gold-v1')
    const {data,error}=await read.maybeSingle();if(error)throw new Error('GOLD_READ_FAILED');if(id&&!data)throw new Error('GOLD_NOT_FOUND');return data as GoldSet|null
  }
  const readChild=async(table:'analysis_gold_set_reviews'|'analysis_gold_labels',id:string)=>{
    await authorizedSet(id)
    const {data,error}=await context.admin.from(table).select('*').eq('gold_set_id',id).limit(2500);if(error)throw new Error('GOLD_READ_FAILED');return data??[]
  }
  return {user:context.user.id,getSet:authorizedSet,
    loadSources:async()=>{
      const [s,b]=await Promise.all([context.admin.from('historical_report_runs').select('generation_id,organization_id,establishment_id,status,snapshot,findings').eq('generation_id',GOLD_SOURCE).eq('organization_id',organization).single(),context.admin.from('jev_benchmark_runs').select('id,organization_id,establishment_id,source_generation_id,source_analysis_version,status,benchmark_type,repeat_count,served_models,decisions').eq('id',GOLD_BENCHMARK).eq('organization_id',organization).single()])
      if(s.error||b.error||!s.data||!b.data)throw new Error('GOLD_SOURCE_INVALID');return {source:s.data as GoldSource,benchmark:b.data as GoldBenchmark}
    },
    reviews:async id=>await readChild('analysis_gold_set_reviews',id) as GoldReview[],labels:async id=>await readChild('analysis_gold_labels',id) as GoldLabel[],
    create:async payload=>{const {data,error}=await context.admin.rpc('create_human_gold_set',payload);if(error||!data)throw new Error('GOLD_CREATE_FAILED');return data as string},
    write:async(id,revision,action,payload)=>{const {error}=await context.admin.rpc('write_human_gold_set',{p_user:context.user.id,p_id:id,p_revision:revision,p_action:action,p_payload:payload});if(error){const code=['GOLD_IMMUTABLE','GOLD_REVISION_CHANGED','GOLD_INCOMPLETE','GOLD_TEXT_INTEGRITY_FAILED','FORBIDDEN'].find(c=>error.message.includes(c));throw new Error(code??'GOLD_SAVE_FAILED')}},
  }
}))
