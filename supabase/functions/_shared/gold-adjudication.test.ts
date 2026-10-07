// @vitest-environment node
import {it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {syntheticAdjudicationBundle,syntheticAdjudication,fakeAdjudicationId} from '../../../tests/fixtures/gold-adjudication'
import {selectAdjudicationItems,validateAdjudicationBundle,compareAdjudication,type AdjudicationLabel} from './gold-adjudication-core'
import {adjudicationHandler,adjudicationProjection,type AdjudicationRepository} from './gold-adjudication-api'
it('requires completed frozen Gold and never changes originals when selecting 12 unique English conflicting reviews deterministically',async()=>{
  const b=await syntheticAdjudicationBundle(),before=JSON.stringify(b);await validateAdjudicationBundle(b)
  const a=await selectAdjudicationItems(b),c=await selectAdjudicationItems({...b,goldReviews:[...b.goldReviews].reverse(),goldLabels:[...b.goldLabels].reverse()})
  expect(a).toEqual(c);expect(a.items).toHaveLength(12);expect(new Set(a.items.map(i=>i.review_id)).size).toBe(12);expect(a.items.every(i=>i.themes.length>=1&&i.themes.length<=3)).toBe(true)
  expect(a.selection.quota_achieved.attentiveness).toBeGreaterThanOrEqual(3);expect(a.selection.quota_achieved.professionalism).toBeGreaterThanOrEqual(3);expect(a.selection.quota_achieved.atmosphere).toBeGreaterThanOrEqual(2)
  expect(JSON.stringify(a.items)).not.toMatch(/analysis_text":|rating|original_text|gold_choice/);expect(JSON.stringify(b)).toBe(before)
  b.gold.status='draft';await expect(validateAdjudicationBundle(b)).rejects.toThrow('ADJUDICATION_GOLD_REQUIRED')
})
it('keeps top-three theme priority and deterministic ranked fill when a diversity pool is unavailable',async()=>{
  const b=await syntheticAdjudicationBundle();b.goldLabels.filter(l=>l.theme_key==='atmosphere').forEach(l=>l.choice='absent')
  const result=await selectAdjudicationItems(b);expect(result.items).toHaveLength(12);expect(result.selection.quota_achieved.atmosphere).toBe(0)
  for(const item of result.items)expect(item.themes.slice(0,2)).toEqual(['attentiveness','professionalism'])
})
it('computes targeted exact agreement, uncertain exclusion and raw Gold mismatch without modifying Gold',async()=>{
  const b=await syntheticAdjudicationBundle(),items=(await selectAdjudicationItems(b)).items,before=JSON.stringify(b)
  const labels:AdjudicationLabel[]=items.flatMap(i=>i.themes.map(theme_key=>({review_id:i.review_id,theme_key,choice:'absent'})))
  labels[0].choice='uncertain';const c=compareAdjudication(b,items,labels)
  expect(c.review_count).toBe(12);expect(c.human_uncertain).toBe(1);expect(c.comparable_labels).toBe(labels.length-1);expect(c.human_matches_gold+c.human_disagrees_with_gold).toBe(c.comparable_labels)
  expect(c.human_matches_sol_only+c.human_matches_jev_only+c.human_matches_both+c.human_matches_neither).toBe(c.comparable_labels)
  expect(c.gold_human_agreement_percent).toBe(c.human_matches_gold/c.comparable_labels*100);expect(c.cases[0].comparable).toBe(false);expect(JSON.stringify(b)).toBe(before)
  expect(()=>compareAdjudication(b,items,labels.slice(1))).toThrow('ADJUDICATION_INCOMPLETE')
})
async function harness(){const b=await syntheticAdjudicationBundle(),a=await syntheticAdjudication(b),items=(await selectAdjudicationItems(b)).items,labels:AdjudicationLabel[]=[];const repo:AdjudicationRepository={user:'human',loadBundle:vi.fn(async()=>b),get:vi.fn(async()=>a),items:vi.fn(async()=>items),labels:vi.fn(async()=>labels),create:vi.fn(async()=>fakeAdjudicationId),write:vi.fn(async()=>{})};return {b,a,items,labels,repo,handler:adjudicationHandler(async()=>repo)}}
const post=(action:string,payload:object={})=>new Request('https://fixture.test',{method:'POST',body:JSON.stringify({adjudication_id:fakeAdjudicationId,revision:0,action,...payload})})
it('draft API reveals only English, requested themes and human choices; GET never selects or creates',async()=>{
  const h=await harness(),response=await h.handler(new Request('https://fixture.test?view=annotation')),data=await response.json()
  expect(response.status).toBe(200);expect(data.items).toHaveLength(12);expect(data.items.every((i:{choices:object})=>Object.keys(i.choices).length===0)).toBe(true)
  expect(JSON.stringify(data)).not.toMatch(/"comparison"|"gold"|"sol"|"jev"|probabilities|rating|original_language|original_text|selection_metadata|score/)
  expect(h.repo.create).not.toHaveBeenCalled();expect(h.repo.write).not.toHaveBeenCalled()
})
it('explicit autosave requires a chosen theme/choice, permits uncertain, blocks missing defaults and stale edits',async()=>{
  const h=await harness(),item=h.items[0];expect((await h.handler(post('save_choice',{review_id:item.review_id,theme_key:item.themes[0]}))).status).toBe(400)
  expect((await h.handler(post('save_choice',{review_id:item.review_id,theme_key:item.themes[0],choice:'uncertain'}))).status).toBe(200)
  expect(h.repo.write).toHaveBeenCalledExactlyOnceWith(fakeAdjudicationId,0,'save_choice',{review_id:item.review_id,theme_key:item.themes[0],choice:'uncertain'})
  expect((await h.handler(post('save_choice',{revision:1}))).status).toBe(409)
})
it('verifies item text hashes before autosaving and never writes against a changed item',async()=>{const h=await harness(),item=h.items[0];item.analysis_text_sha256='0'.repeat(64);expect((await h.handler(post('save_choice',{review_id:item.review_id,theme_key:item.themes[0],choice:'positive'}))).status).toBe(400);expect(h.repo.write).not.toHaveBeenCalled()})
it('requires 12 fully answered reviews and explicit final confirmation; completed answers become immutable and are revealed only then',async()=>{
  const h=await harness();expect((await h.handler(post('finalize',{confirm:true}))).status).toBe(400);expect(h.repo.write).not.toHaveBeenCalled()
  h.labels.push(...h.items.flatMap(i=>i.themes.map(theme_key=>({review_id:i.review_id,theme_key,choice:'absent' as const}))))
  expect((await h.handler(post('finalize',{confirm:true,comparison:{forged:true}}))).status).toBe(200);const payload=vi.mocked(h.repo.write).mock.calls[0][3];expect(payload.comparison).toHaveProperty('gold_human_agreement_percent');expect(payload.comparison).not.toHaveProperty('forged')
  h.a.status='completed';h.a.comparison=compareAdjudication(h.b,h.items,h.labels);expect((await h.handler(post('save_choice'))).status).toBe(409)
  expect(adjudicationProjection(h.a,h.items,h.labels,h.b,true).comparison).toHaveProperty('cases.0.gold')
})
it('creation is manual, idempotent and only writes new experiment tables; cross-tenant access is rejected',async()=>{
  const h=await harness();await h.handler(post('create'));expect(h.repo.create).not.toHaveBeenCalled();vi.mocked(h.repo.get).mockResolvedValueOnce(null);await h.handler(post('create'));expect(h.repo.create).toHaveBeenCalledTimes(1)
  h.a.organization_id='other';expect((await h.handler(new Request('https://fixture.test'))).status).toBe(403)
  const forbidden=adjudicationHandler(async()=>{throw new Error('FORBIDDEN')});expect((await forbidden(new Request('https://fixture.test'))).status).toBe(403)
})
it('DDL/source code has no source mutation, old Gold writes, provider requests or cron',()=>{
  for(const name of ['gold-adjudication-core.ts','gold-adjudication-api.ts'])expect(readFileSync(new URL(name,import.meta.url),'utf8')).not.toMatch(/fetch\(|api\.openai|api\.typesafe|apify|structuredCall|consultantNarrative/)
  const sql=readFileSync(new URL('../../migrations/20261007053103_gold_final_adjudication.sql',import.meta.url),'utf8')
  expect(sql).not.toMatch(/(update|insert into|delete from|alter table) public\.(analysis_gold_sets\b|analysis_gold_labels\b|reviews\b|historical_report_runs\b|jev_benchmark_runs\b|review_translations\b)/)
  expect(sql).not.toMatch(/cron\.|create_human_gold_set|write_human_gold_set/);expect(sql).toContain('ADJUDICATION_IMMUTABLE');expect(sql).toContain('ADJUDICATION_REVISION_CHANGED');expect(sql).toContain('for update')
})
