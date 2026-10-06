import { requireUser, assertMembership } from '../_shared/auth.ts'
import { benchmarkHandler } from '../_shared/jev-benchmark-handler.ts'
import type { BenchmarkSource } from '../_shared/jev-benchmark.ts'
import { eligibleJevSources } from '../_shared/jev-benchmark-read.ts'

declare const EdgeRuntime: { waitUntil(work:Promise<void>):void }

Deno.serve(benchmarkHandler({
  // The only runtime source of TYPESAFE_API_KEY. Never copied to storage or logs.
  env:name=>name==='TYPESAFE_API_KEY'?Deno.env.get('TYPESAFE_API_KEY'):Deno.env.get(name),
  waitUntil:work=>EdgeRuntime.waitUntil(work),
  log:(event,fields)=>console.info(JSON.stringify({event,...fields})),
  authenticate:async request=>{
    const context=await requireUser(request)
    // historical_report_runs is server-only (no user SELECT policy). Resolve its
    // organization, authorize membership, then read the snapshot with an org filter.
    // Only the experimental table has any mutation capability in this function.
    const benchmarks=context.admin.from('jev_benchmark_runs')
    const summaryFields='id,benchmark_type,organization_id,establishment_id,source_generation_id,status,error_code,comparison,created_at,completed_at,requested_model,served_models,repeat_count,reviews_total,reviews_with_text,reviews_without_text,request_count,retry_count,jev_input_tokens,jev_output_tokens'
    return {
      authorize:async organizationId=>{await assertMembership(context.client,context.user.id,organizationId,['owner','admin','manager'])},
      readSource:async id=>{
        const {data:identity,error:identityError}=await context.admin.from('historical_report_runs').select('organization_id').eq('generation_id',id).maybeSingle()
        if(identityError)throw new Error('SOURCE_READ_FAILED')
        if(!identity)return null
        await assertMembership(context.client,context.user.id,identity.organization_id,['owner','admin','manager'])
        const {data,error}=await context.admin.from('historical_report_runs').select('generation_id,organization_id,establishment_id,status,model,snapshot,classifications,findings,input_tokens,output_tokens,token_usage_complete,started_at,completed_at').eq('generation_id',id).eq('organization_id',identity.organization_id).maybeSingle()
        if(error)throw new Error('SOURCE_READ_FAILED')
        return data as BenchmarkSource|null
      },
      readBenchmark:async id=>{
        const {data,error}=await context.client.from('jev_benchmark_runs').select(summaryFields).eq('id',id).maybeSingle()
        if(error)throw new Error('JEV_BENCHMARK_READ_FAILED')
        return data
      },
      listEligible:async()=>{
        const {data:members,error:me}=await context.client.from('organization_members').select('organization_id').eq('user_id',context.user.id).in('role',['owner','admin','manager'])
        if(me)throw new Error('FORBIDDEN')
        const organizations=(members??[]).map(m=>m.organization_id)
        if(!organizations.length)throw new Error('FORBIDDEN')
        // Server-only read; never return the snapshot texts to the frontend.
        const rows=[]
        for(let offset=0;;offset+=100) {
          const {data,error}=await context.admin.from('historical_report_runs').select('generation_id,organization_id,establishment_id,completed_at,snapshot,establishments(name)').in('organization_id',organizations).eq('status','completed').in('snapshot->>analysis_version',['6','7']).order('completed_at',{ascending:false}).order('generation_id',{ascending:false}).range(offset,offset+99)
          if(error)throw new Error('SOURCE_READ_FAILED')
          rows.push(...(data??[]))
          if((data?.length??0)<100)break
        }
        return eligibleJevSources(rows as unknown as Parameters<typeof eligibleJevSources>[0])
      },
      readLatest:async (sourceId,type='axes_phase1')=>{
        // Exact status priority, without a limit that could hide an older running run.
        for(const status of ['running','completed','failed']) {
          const {data,error}=await context.client.from('jev_benchmark_runs').select(summaryFields).eq('source_generation_id',sourceId).eq('benchmark_type',type).eq('status',status).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle()
          if(error)throw new Error('JEV_BENCHMARK_READ_FAILED')
          if(data)return data
        }
        return null
      },
      insertBenchmark:async row=>{
        const {error}=await benchmarks.insert(row)
        if(error)throw new Error(error.code==='23505'?'BENCHMARK_ALREADY_RUNNING':'JEV_PERSIST_FAILED')
      },
      updateBenchmark:async(id,row)=>{
        const {data,error}=await benchmarks.update(row).eq('id',id).select('id').single()
        if(error || !data)throw new Error('JEV_PERSIST_FAILED')
      },
    }
  },
}))
