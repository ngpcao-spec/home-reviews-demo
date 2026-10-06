import { requireUser, assertMembership } from '../_shared/auth.ts'
import { benchmarkHandler } from '../_shared/jev-benchmark-handler.ts'
import type { BenchmarkSource } from '../_shared/jev-benchmark.ts'

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
        const {data,error}=await context.client.from('jev_benchmark_runs').select('id,organization_id,status,error_code,comparison').eq('id',id).maybeSingle()
        if(error)throw new Error('JEV_BENCHMARK_READ_FAILED')
        return data
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
