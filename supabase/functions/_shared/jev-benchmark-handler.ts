import { validateOptions, validateSource, sourceFingerprint, newBenchmarkState, runJevBenchmark, compareBenchmark, type BenchmarkSource, type BenchmarkState, type CostRates } from './jev-benchmark.ts'
import { createJevClient,type JevDecision } from './jev.ts'
import type { EligibleJevSource } from './jev-benchmark-read.ts'
import { benchmarkType,type BenchmarkType } from './jev-benchmark-type.ts'
import { compareThemes,themePayload,parseThemes,type ThemeDecision } from './jev-themes.ts'
import { compareService,servicePayload,parseService,type Phase2Reference } from './jev-service.ts'

type Row = Record<string,unknown>
export interface BenchmarkRepository {
  // Source is deliberately read-only: no capability to mutate production data.
  readSource:(id:string)=>Promise<BenchmarkSource|null>
  authorize:(organizationId:string)=>Promise<void>
  insertBenchmark:(row:Row)=>Promise<void>
  updateBenchmark:(id:string,row:Row)=>Promise<void>
  readBenchmark:(id:string)=>Promise<Row|null>
  listEligible?:()=>Promise<EligibleJevSource[]>
  readLatest?:(sourceId:string,type?:BenchmarkType)=>Promise<Row|null>
}
export interface HandlerDependencies {
  authenticate:(request:Request)=>Promise<BenchmarkRepository>
  env:(name:string)=>string|undefined
  waitUntil:(work:Promise<void>)=>void
  log?:(event:string,fields:Row)=>void
}
const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, GET, OPTIONS'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers})
const uuid=(value:unknown):value is string=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const errorCode=(error:unknown)=>error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)?error.message:'JEV_BENCHMARK_FAILED'
function configuredRate(value:string|undefined,fallback:number) {
  const rate=value===undefined?fallback:Number(value)
  if(!Number.isFinite(rate) || rate<0 || value==='')throw new Error('INVALID_COST_RATE')
  return rate
}
export function benchmarkHandler(deps:HandlerDependencies) {
  return async(request:Request)=>{
    if(request.method==='OPTIONS')return new Response('ok',{headers})
    if(!['GET','POST'].includes(request.method))return json({error:'METHOD_NOT_ALLOWED'},405)
    try {
      const repo=await deps.authenticate(request)
      if(request.method==='GET') {
        const params=new URL(request.url).searchParams
        if(params.get('eligible')==='1') {
          if(!repo.listEligible)throw new Error('JEV_READ_UNAVAILABLE')
          return json({establishments:await repo.listEligible()})
        }
        const sourceId=params.get('source_generation_id')
        if(sourceId!==null) {
          if(!uuid(sourceId))return json({error:'SOURCE_GENERATION_ID_REQUIRED'},400)
          if(!repo.readLatest)throw new Error('JEV_READ_UNAVAILABLE')
          const row=await repo.readLatest(sourceId,benchmarkType(params.get('benchmark_type')))
          if(row)await repo.authorize(row.organization_id as string)
          return json({benchmark:row})
        }
        const id=params.get('benchmark_id')
        if(!uuid(id))return json({error:'BENCHMARK_ID_REQUIRED'},400)
        const row=await repo.readBenchmark(id)
        if(!row)return json({error:'BENCHMARK_NOT_FOUND'},404)
        await repo.authorize(row.organization_id as string)
        return json({benchmark_id:id,...row})
      }
      // Missing key stops BEFORE parsing/loading/creating a run, and before any Jev request.
      const apiKey=deps.env('TYPESAFE_API_KEY')
      createJevClient(apiKey)
      let body:Row
      try {body=await request.json()}catch{throw new Error('INVALID_BODY')}
      if(!body || typeof body!=='object' || Array.isArray(body))throw new Error('INVALID_BODY')
      if(!uuid(body.source_generation_id))throw new Error('SOURCE_GENERATION_ID_REQUIRED')
      const benchmark_type=benchmarkType(body.benchmark_type)
      const options=validateOptions(body,deps.env('JEV_MODEL')??'jev-latest',Number(deps.env('JEV_BENCHMARK_CONCURRENCY')??8))
      const source=await repo.readSource(body.source_generation_id)
      if(!source)return json({error:'SOURCE_NOT_FOUND'},404)
      await repo.authorize(source.organization_id)
      validateSource(source)
      if(benchmark_type==='themes_phase2') {
        const phase1=await repo.readLatest?.(source.generation_id,'axes_phase1')
        if(phase1?.status!=='completed')throw new Error('SOURCE_PHASE1_REQUIRED')
      }
      let phase2Reference:Phase2Reference|null=null
      if(benchmark_type==='themes_phase2b_service') {
        const phase2=await repo.readLatest?.(source.generation_id,'themes_phase2')
        if(phase2?.status!=='completed')throw new Error('SOURCE_PHASE2_REQUIRED')
        if(phase2.source_generation_id!==source.generation_id)throw new Error('SOURCE_PHASE2_MISMATCH')
        phase2Reference=phase2 as unknown as Phase2Reference
      }
      const rates:CostRates={jev_input:configuredRate(deps.env('JEV_INPUT_USD_PER_MILLION'),.042),sol_input:configuredRate(deps.env('SOL_INPUT_USD_PER_MILLION'),2),sol_output:configuredRate(deps.env('SOL_OUTPUT_USD_PER_MILLION'),10)}
      const id=crypto.randomUUID(), fingerprint=await sourceFingerprint(source), state=newBenchmarkState<JevDecision|ThemeDecision>(source,options)
      const scope={benchmark_id:id,source_generation_id:source.generation_id,benchmark_type}
      const log=(event:string,fields:Row={})=>deps.log?.(event,{...scope,...fields})
      const started=Date.now()
      const patch=()=>{
        const comparison=benchmark_type==='themes_phase2b_service'?compareService(source,state as BenchmarkState<ThemeDecision>,options,rates,phase2Reference):benchmark_type==='themes_phase2'?compareThemes(source,state as BenchmarkState<ThemeDecision>,options,rates):compareBenchmark(source,state as BenchmarkState,options,rates)
        return {decisions:state.decisions,served_models:state.served_models,request_count:state.request_count,retry_count:state.retry_count,jev_input_tokens:state.jev_input_tokens,jev_output_tokens:state.jev_output_tokens,jev_elapsed_ms:state.jev_elapsed_ms,estimated_jev_cost_usd:comparison.jev.estimated_jev_cost_usd,comparison}
      }
      const textual=source.snapshot.reviews.filter(r=>r.original_text?.trim()).length
      await repo.insertBenchmark({id,benchmark_type,organization_id:source.organization_id,establishment_id:source.establishment_id,source_generation_id:source.generation_id,source_analysis_version:6,source_fingerprint:fingerprint,requested_model:options.model,status:'running',repeat_count:options.repeat_count,concurrency:options.concurrency,reviews_total:source.snapshot.reviews.length,reviews_with_text:textual,reviews_without_text:source.snapshot.reviews.length-textual,rate_used:{jev_input:rates.jev_input,sol_input:rates.sol_input,sol_output:rates.sol_output,label:'ESTIMATION AU TARIF CONFIGURÉ'},sol_baseline_input_tokens:source.input_tokens,sol_baseline_output_tokens:source.output_tokens,estimated_sol_baseline_cost_usd:(source.input_tokens*rates.sol_input+source.output_tokens*rates.sol_output)/1_000_000,sol_baseline_elapsed_ms:Date.parse(source.completed_at)-Date.parse(source.started_at),...patch()})
      // Only a manually authenticated POST starts work. No cron or scheduler registration.
      const work=async()=>{
        log('JEV_BENCHMARK_STARTED',{model:options.model,repeat_count:options.repeat_count,concurrency:options.concurrency})
        try {
          await runJevBenchmark<JevDecision|ThemeDecision>(source,options,apiKey,state,{log,...(benchmark_type==='themes_phase2b_service'?{evaluate:(client:ReturnType<typeof createJevClient>,model:string,alias:string,text:string)=>client.evaluatePayload(servicePayload(model,alias,text),parseService)}:benchmark_type==='themes_phase2'?{evaluate:(client:ReturnType<typeof createJevClient>,model:string,alias:string,text:string)=>client.evaluatePayload(themePayload(model,alias,text),parseThemes)}:{}),checkpoint:async()=>{
            state.jev_elapsed_ms=Date.now()-started
            await repo.updateBenchmark(id,patch())
            // Bound execution to leave time to save partial results within Edge limits.
            if(state.jev_elapsed_ms>90_000)throw new Error('JEV_BENCHMARK_TIME_BUDGET')
          }})
          state.jev_elapsed_ms=Date.now()-started
          const failed=state.errors.length>0
          await repo.updateBenchmark(id,{...patch(),status:failed?'failed':'completed',error_code:failed?'JEV_PARTIAL_FAILURE':null,completed_at:new Date().toISOString()})
          log(failed?'JEV_BENCHMARK_FAILED':'JEV_BENCHMARK_COMPLETED',{duration_ms:state.jev_elapsed_ms,model:state.served_models.join(','),request_count:state.request_count,retry_count:state.retry_count})
        } catch(error) {
          state.jev_elapsed_ms=Date.now()-started
          const code=errorCode(error)
          try {await repo.updateBenchmark(id,{...patch(),status:'failed',error_code:code,completed_at:new Date().toISOString()})}catch{log('JEV_BENCHMARK_FAILED',{error_code:'JEV_PERSIST_FAILED',duration_ms:state.jev_elapsed_ms,model:options.model})}
          log('JEV_BENCHMARK_FAILED',{error_code:code,duration_ms:state.jev_elapsed_ms,model:options.model})
        }
      }
      deps.waitUntil(work())
      return json({benchmark_id:id,benchmark_type,status:'running',source_generation_id:source.generation_id,requested_model:options.model,repeat_count:options.repeat_count,concurrency:options.concurrency,status_url:`?benchmark_id=${id}`,note:'Read the persisted summary with authenticated GET; do not re-POST to poll.'},202)
    }catch(error) {
      const code=errorCode(error)
      const status=code==='UNAUTHORIZED'?401:code==='FORBIDDEN'?403:code==='JEV_NOT_CONFIGURED'?503:code==='BENCHMARK_ALREADY_RUNNING'?409:code.startsWith('INVALID_') || code==='SOURCE_GENERATION_ID_REQUIRED' || code.startsWith('SOURCE_')?400:500
      return json({error:code},status)
    }
  }
}
