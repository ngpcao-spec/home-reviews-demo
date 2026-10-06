// @vitest-environment node
import { describe,it,expect,vi } from 'vitest'
import { eligibleJevSources,preferredJevRun } from './jev-benchmark-read.ts'
import { benchmarkHandler,type BenchmarkRepository } from './jev-benchmark-handler.ts'
const generation='1629f8d2-80da-42a7-92c7-af18ff04da32'
describe('Jev read-only discovery',()=>{
  it('selects latest completed V6 per establishment including current Shabu, without returning texts',()=>{
    const shabu={generation_id:generation,organization_id:'org',establishment_id:'shabu',completed_at:'2026-10-05T01:32:16Z',snapshot:{analysis_version:6,reviews:Array.from({length:100},()=>({original_text:'PRIVATE REVIEW'}))},establishments:{name:'Shabu Ssam BBQ Restaurant'}}
    const result=eligibleJevSources([shabu,{...shabu,generation_id:'older',completed_at:'2026-10-01T00:00:00Z'},{...shabu,generation_id:'v5',snapshot:{...shabu.snapshot,analysis_version:5}},{...shabu,establishment_id:'deleted',establishments:null}])
    expect(result).toMatchObject([{establishment_id:'shabu',organization_id:'org',name:'Shabu Ssam BBQ Restaurant',source_generation_id:generation,reviews_total:100,completed_at:shabu.completed_at}])
    expect(result[0].snapshots?.map(s=>s.source_generation_id)).toEqual([generation,'older'])
    expect(JSON.stringify(result)).not.toContain('PRIVATE REVIEW')
  })
  it('prioritizes running, then completed, then latest failed',()=>{
    const rows=[{status:'failed',created_at:'2026-10-06',id:'fail'},{status:'completed',created_at:'2026-10-05',id:'done'},{status:'running',created_at:'2026-10-01',id:'run'}]
    expect(preferredJevRun(rows)?.id).toBe('run');expect(preferredJevRun(rows.slice(0,2))?.id).toBe('done');expect(preferredJevRun([])).toBeNull()
  })
  it('keeps latest Shabu as default and exposes the exact older 100-review reference dynamically',()=>{
    const row={organization_id:'org',establishment_id:'shabu',establishments:{name:'Shabu Ssam BBQ Restaurant'}}
    const result=eligibleJevSources([{...row,generation_id:generation,completed_at:'2026-10-05T01:32:16Z',snapshot:{analysis_version:6,reviews:Array(100).fill(null)}},{...row,generation_id:'382c46aa-2505-44de-8693-71ab1fa92d11',completed_at:'2026-10-05T06:46:18Z',snapshot:{analysis_version:6,reviews:Array(101).fill(null)}}])
    expect(result).toHaveLength(1);expect(result[0].reviews_total).toBe(101)
    expect(result[0].snapshots?.[1]).toMatchObject({source_generation_id:generation,reviews_total:100})
  })
  function harness() {
    const repo:BenchmarkRepository={authorize:vi.fn(async()=>{}),readSource:vi.fn(),readBenchmark:vi.fn(),insertBenchmark:vi.fn(),updateBenchmark:vi.fn(),listEligible:vi.fn(async()=>[]),readLatest:vi.fn(async()=>null)}
    const env=vi.fn(),waitUntil=vi.fn()
    return {repo,env,waitUntil,handler:benchmarkHandler({authenticate:async()=>repo,env,waitUntil})}
  }
  it('eligible GET needs no API secret and cannot create a benchmark',async()=>{
    const h=harness(),response=await h.handler(new Request('https://test/?eligible=1'))
    expect(response.status).toBe(200);expect(h.repo.listEligible).toHaveBeenCalledOnce();expect(h.env).not.toHaveBeenCalled();expect(h.waitUntil).not.toHaveBeenCalled();expect(h.repo.insertBenchmark).not.toHaveBeenCalled()
  })
  it('latest GET returns an authorized run or null, never starts work',async()=>{
    const h=harness();vi.mocked(h.repo.readLatest!).mockResolvedValue({id:'test',organization_id:'org',status:'running'})
    const r=await h.handler(new Request('https://test/?source_generation_id='+generation))
    expect(await r.json()).toEqual({benchmark:{id:'test',organization_id:'org',status:'running'}});expect(h.repo.authorize).toHaveBeenCalledWith('org');expect(h.waitUntil).not.toHaveBeenCalled();expect(h.repo.insertBenchmark).not.toHaveBeenCalled()
  })
  it('unauthorized discovery fails closed and malformed source ID is rejected',async()=>{
    const h=harness();vi.mocked(h.repo.listEligible!).mockRejectedValue(new Error('FORBIDDEN'))
    expect((await h.handler(new Request('https://test/?eligible=1'))).status).toBe(403)
    expect((await h.handler(new Request('https://test/?source_generation_id=bad'))).status).toBe(400)
  })
})
