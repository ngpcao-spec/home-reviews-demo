// @vitest-environment node
import {describe,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {syntheticGold,syntheticLabels,fakeGoldId} from '../../../tests/fixtures/human-gold'
import {goldHandler,goldFingerprints,blindGoldProjection,type GoldRepository} from './gold-api'
import {GOLD_KEYS} from './gold-taxonomy'
async function harness(){const f=await syntheticGold();Object.assign(f.set,await goldFingerprints(f.source,f.benchmark));const repo:GoldRepository={user:'user',loadSources:vi.fn(async()=>({source:f.source,benchmark:f.benchmark})),getSet:vi.fn(async()=>f.set),reviews:vi.fn(async()=>f.rows),labels:vi.fn(async()=>f.labels),create:vi.fn(async()=>fakeGoldId),write:vi.fn(async()=>{})};return {f,repo,handler:goldHandler(async()=>repo)}}
const post=(action:string,payload:object={})=>new Request('https://fixture.test',{method:'POST',body:JSON.stringify({gold_set_id:fakeGoldId,revision:0,action,...payload})})
describe('Gold API blind, transactional and immutable',()=>{
  it('GET is read only and draft projection has English text/own labels only; never predictions, stars, originals, probabilities or buckets',async()=>{
    const {handler,repo}=await harness(),response=await handler(new Request('https://fixture.test?gold_set_id='+fakeGoldId+'&view=annotation')),data=await response.json()
    expect(response.status).toBe(200);expect(data.reviews).toHaveLength(40);expect(data.reviews[0]).toMatchObject({analysis_text:expect.stringContaining('English review'),choices:null})
    expect(JSON.stringify(data)).not.toMatch(/selection_bucket|control|diagnostic"|rating|original_text|original_language|probabilities|findings|comparison/)
    expect(repo.create).not.toHaveBeenCalled();expect(repo.write).not.toHaveBeenCalled()
  })
  it('explicit review confirmation stores 25 human choices with absent defaults in one RPC',async()=>{
    const {handler,repo,f}=await harness();const response=await handler(post('confirm_review',{review_id:f.rows[0].review_id,choices:{friendly_staff:'positive',attentiveness:'uncertain',professionalism:'both',wait_time:'negative'}}))
    expect(response.status).toBe(200);const payload=vi.mocked(repo.write).mock.calls[0][3];expect(Object.keys(payload.choices as object)).toHaveLength(25);expect(payload.choices).toMatchObject({food_quality:'absent',attentiveness:'uncertain',friendly_staff:'positive'})
  })
  it('completed Gold cannot be edited and only then exposes comparison',async()=>{
    const {handler,repo,f}=await harness();f.set.status='completed';f.set.comparison={verdict:'inconclusive'} as typeof f.set.comparison
    expect((await handler(post('confirm_review',{review_id:f.rows[0].review_id,choices:{}}))).status).toBe(409);expect(repo.write).not.toHaveBeenCalled()
    const data=blindGoldProjection(f.set,f.rows,f.labels,f.source,true);expect(data.reviews).toEqual([]);expect(data.comparison?.verdict).toBe('inconclusive')
  })
  it('server creates deterministically only on explicit POST, reuses existing sets and excludes translations with a server replacement',async()=>{
    const {handler,repo,f}=await harness();await handler(post('create'));expect(repo.create).not.toHaveBeenCalled()
    await handler(post('exclude_review',{review_id:f.rows[0].review_id}));expect(repo.write).toHaveBeenCalledWith(fakeGoldId,0,'exclude_review',expect.objectContaining({replacement:expect.objectContaining({position:1})}))
    vi.mocked(repo.getSet).mockResolvedValueOnce(null);await handler(post('create'));expect(repo.create).toHaveBeenCalledTimes(1);const rows=vi.mocked(repo.create).mock.calls[0][0].p_reviews as unknown[];expect(rows).toHaveLength(40)
  })
  it('stale revision, missing finalization confirmation and modified source are rejected before writes',async()=>{
    const {handler,repo,f}=await harness();expect((await handler(post('confirm_review',{revision:9,choices:{},review_id:f.rows[0].review_id}))).status).toBe(409)
    expect((await handler(post('finalize'))).status).toBe(400);f.set.source_fingerprint='modified';expect((await handler(new Request('https://fixture.test'))).status).toBe(409);expect(repo.write).not.toHaveBeenCalled()
  })
  it('finalization uses server labels/persisted sources, never a supplied model result',async()=>{
    const {handler,repo,f}=await harness();f.rows.forEach(r=>r.confirmed_at='now');f.labels.push(...syntheticLabels(f.rows.map(r=>r.review_id)))
    expect(f.labels).toHaveLength(40*GOLD_KEYS.length);expect((await handler(post('finalize',{confirm:true,comparison:{forged:true}}))).status).toBe(200)
    const payload=vi.mocked(repo.write).mock.calls[0][3];expect(payload.comparison).toHaveProperty('bootstrap.resamples',2000);expect(payload.comparison).not.toHaveProperty('forged')
  })
  it('authorization failures do not read sources or leak tenant data',async()=>{const handler=goldHandler(async()=>{throw new Error('FORBIDDEN')});expect((await handler(new Request('https://fixture.test'))).status).toBe(403)})
  it('rejects an incorrectly scoped Gold row before exposing its text or labels',async()=>{const {handler,f}=await harness();f.set.organization_id='other-tenant';const response=await handler(new Request('https://fixture.test?view=annotation'));expect(response.status).toBe(403);expect(await response.json()).toEqual({error:'FORBIDDEN'})})
  it('DDL writes only owned experiment tables, denies direct blind-data reads and has DB locks/immutability/revision protections',()=>{
    const sql=readFileSync(new URL('../../migrations/20261006120105_human_gold_sets.sql',import.meta.url),'utf8')
    expect(sql).not.toMatch(/(update|insert into|delete from|alter table) public\.(reviews|historical_report_runs|jev_benchmark_runs|review_translations|historical_establishment_reports)/)
    expect(sql).toContain('GOLD_IMMUTABLE');expect(sql).toContain('for update');expect(sql).toContain('GOLD_REVISION_CHANGED');expect(sql).toContain('pg_advisory_xact_lock');expect(sql).toContain('from public,anon,authenticated')
  })
})
