import { afterEach,describe,expect,it,vi } from 'vitest'
import { historicalNarrativeVersion,processHistoricalRun,type HistoricalJob } from './historical-report-worker.ts'
import { historicalRetry } from './historical-report-policy.ts'
const ai=vi.hoisted(()=>({extract:vi.fn(),narrative:vi.fn()}))
vi.mock('./consultant-report.ts',async original=>({...await original<object>(),extractConsultantBatch:ai.extract,consultantNarrative:ai.narrative}))
afterEach(()=>{vi.clearAllMocks();vi.unstubAllGlobals()})
function harness(){
  const reviews=Array.from({length:80},(_,i)=>({id:'r'+i,rating:5,original_text:'Good food',review_context:null}))
  let run={id:'run',generation_id:'kept-generation',establishment_id:'place',organization_id:'org',language:'vi',status:'running',cursor:3,
    model:'gpt-5.6-terra',ai_calls:3,input_tokens:300,output_tokens:600,attempt_count:1,rejected_findings_count:0,token_usage_complete:true,
    snapshot:{reviews,base:{analysis_version:3,organization_id:'org',establishment_id:'place',preferred_language:'vi'}},
    findings:Array.from({length:168},(_,i)=>({review_id:'r'+(i%60),theme_key:['food_quality','consistency','professionalism'][Math.floor(i/60)],sentiment:'positive',evidence:'Good food'})),
    classifications:[],created_at:new Date().toISOString(),last_error:null} as HistoricalJob
  let publication:unknown={generation_id:'previous-report'}
  let publishFailure=false
  const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>{
    if(args.p_cursor!==run.cursor)return {data:false,error:null}
    if(name==='checkpoint_historical_report_run'){run={...run,...args.p_values as object};return {data:true,error:null}}
    if(publishFailure)return {data:null,error:{code:'08006'}}
    publication=args.p_report;run={...run,status:'completed'};return {data:true,error:null}
  })
  const query={select(){return this},eq(){return this},maybeSingle:async()=>({data:publication,error:null}),single:async()=>({data:{name:'Private restaurant'},error:null})}
  const database={from:()=>query,rpc}
  ai.extract.mockImplementation(async(batch,usage)=>{
    await usage({input_tokens:100,output_tokens:200})
    return {findings:[],classifications:batch.map((r:{id:string})=>({review_id:r.id,sentiment:'positive',basis:'rating',evidence:''})),rejectedCount:0,classificationFallbackCount:0}
  })
  ai.narrative.mockImplementation(async(metrics,_language,usage)=>{
    await usage({input_tokens:10,output_tokens:20})
    return {report:{total:metrics.total,positive:metrics.positive,negative:metrics.negative,conclusion:'Synthèse'},usage:{input_tokens:10,output_tokens:20}}
  })
  return {get run(){return run},get publication(){return publication},rpc,
    failPublish(value:boolean){publishFailure=value},
    patch(patch:Partial<HistoricalJob>){run={...run,...patch}},
    // Each call simulates an independent cron invocation with a fresh database snapshot.
    async tick(){return processHistoricalRun(database as never,structuredClone(run),'worker')}
  }
}
describe('durable worker without any frontend process',()=>{
  it.each([3,4] as const)('keeps narrative version %i across worker restarts',async version=>{
    const h=harness()
    h.patch({snapshot:{...h.run.snapshot,analysis_version:version,base:{...h.run.snapshot.base,analysis_version:version}}})
    await h.tick();await h.tick()
    expect(ai.narrative.mock.calls[0][4]).toBe(version)
    expect(h.publication).toMatchObject({analysis_version:version})
  })
  it('treats an old unsnapshotted run as V3; never upgrades an existing generation',()=>{
    const h=harness()
    expect(historicalNarrativeVersion({...h.run,snapshot:{}})).toBe(3)
    expect(historicalNarrativeVersion(h.run)).toBe(3)
    expect(()=>historicalNarrativeVersion({...h.run,snapshot:{...h.run.snapshot,analysis_version:4}})).toThrow('REPORT_VERSION_CHANGED')
  })
  it.each(['gpt-5.6-terra','gpt-6.1-sol'])('pins %s through retry, recovered lease and publication despite environment changes',async(model)=>{
    vi.stubGlobal('Deno',{env:{get:()=>model==='gpt-6.1-sol'?'gpt-5.6-terra':'gpt-6.1-sol'}})
    const h=harness()
    h.patch({model})
    ai.extract.mockRejectedValueOnce(new Error('OPENAI_HTTP_429'))
    await h.tick()
    expect(h.run.cursor).toBe(3)
    h.patch({status:'running',last_error:'REPORT_LEASE_RECOVERED',attempt_count:2})
    await h.tick()
    await h.tick()
    expect(ai.extract.mock.calls.map(call=>call[2])).toEqual([model,model])
    expect(ai.narrative.mock.calls[0][3]).toBe(model)
    expect(h.publication).toMatchObject({ai_model:model})
    expect(h.run.model).toBe(model)
  })
  it('adopts cursor 3 / 168 findings, then finalizes without replaying earlier batches',async()=>{
    const h=harness(),original=structuredClone(h.run.findings)
    expect(await h.tick()).toMatchObject({status:'running',cursor:4,generation_id:'kept-generation'})
    expect(ai.extract.mock.calls[0][0][0].id).toBe('r60')
    expect(h.run.findings).toEqual(original)
    // A second independent invocation publishes; no client loop is present.
    await h.tick()
    expect(h.run.status).toBe('completed')
    expect(ai.extract).toHaveBeenCalledTimes(1)
    expect(ai.narrative).toHaveBeenCalledTimes(1)
    expect(h.publication).toMatchObject({generation_id:'kept-generation',consultant_report:{total:80,positive:80,negative:0}})
    expect(h.run.findings.slice(0,168)).toEqual(original)
  })
  it('429 schedules retry while preserving checkpoints, then resumes the exact batch',async()=>{
    const h=harness(),original=structuredClone(h.run.findings)
    ai.extract.mockRejectedValueOnce(new Error('OPENAI_HTTP_429'))
    expect(await h.tick()).toMatchObject({status:'retry'})
    expect(h.run.cursor).toBe(3);expect(h.run.findings).toEqual(original)
    expect(h.rpc.mock.calls.at(-1)?.[1].p_values).toMatchObject({status:'retry',locked_by:null,lease_until:null,next_retry_at:expect.any(String)})
    h.patch({status:'running',attempt_count:2})
    await h.tick()
    expect(h.run.cursor).toBe(4)
    expect(ai.extract.mock.calls.map(call=>call[0][0].id)).toEqual(['r60','r60'])
    expect(h.run.attempt_count).toBe(0)
  })
  it('failed publication retains prior report and retries saved narrative without AI',async()=>{
    const h=harness()
    h.patch({cursor:4,findings:[{review_id:'r0',theme_key:'food_quality',sentiment:'positive',evidence:'Good food'}]})
    ai.narrative.mockImplementation(async(_metrics,_language,usage)=>{await usage({input_tokens:10,output_tokens:20});return {report:{conclusion:'Synthèse'},usage:{input_tokens:10,output_tokens:20}}})
    h.failPublish(true)
    expect(await h.tick()).toMatchObject({status:'retry'})
    expect(h.publication).toEqual({generation_id:'previous-report'})
    expect(h.run.snapshot.publication).toBeDefined()
    h.failPublish(false);h.patch({status:'running',attempt_count:2})
    await h.tick()
    expect(h.run.status).toBe('completed')
    expect(ai.narrative).toHaveBeenCalledTimes(1)
  })
  it.each([1,2,3,4])('transient failure attempt %i uses bounded backoff',attempt=>{
    expect(historicalRetry(new Error('OPENAI_HTTP_503'),attempt)).toMatchObject({status:'retry',delay:[60,180,600,1800][attempt-1]})
  })
  it('exhausted retries and invalid batch structures become definitive failures',()=>{
    expect(historicalRetry(new Error('OPENAI_HTTP_429'),5).status).toBe('failed')
    expect(historicalRetry(new Error('REPORT_INVALID_FINDINGS'),1).status).toBe('failed')
    expect(historicalRetry(new DOMException('timeout','TimeoutError'),1).status).toBe('retry')
  })
})
