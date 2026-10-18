import {it,expect,vi,beforeAll,afterAll} from 'vitest';
import frozen from '../fixtures/jev-boundaries-targeted9.json';
import criteria from '../../docs/jev-boundaries-targeted9-criteria-20261018.json';
import {prepareTargetedJev,verifyTargetedJev,parseTargetedJevResult,type TargetCriteria} from '../../supabase/functions/_shared/jev-boundaries-targeted-protocol';
import {auditEconomyPayload} from '../../supabase/functions/_shared/jev-audit-boundaries-v22';
import {THEME_KEYS} from '../../supabase/functions/_shared/jev-themes';
import {createJevClient} from '../../supabase/functions/_shared/jev';
import {hybridHash} from '../../supabase/functions/_shared/jev-hybrid-evidence';
let net:ReturnType<typeof vi.spyOn>;
beforeAll(()=>{net=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('PROVIDER_NETWORK_FORBIDDEN'));});
afterAll(()=>{expect(net).not.toHaveBeenCalled();net.mockRestore();});
const prepare=()=>prepareTargetedJev(structuredClone(frozen.source),structuredClone(criteria) as TargetCriteria,structuredClone(frozen.baseline));
const synthetic=()=>({model:'jev-1.13.0',usage:{input_tokens:123,output_tokens:0},answers:Object.fromEntries(THEME_KEYS.map(k=>[k,{type:'choice',choice:'absent',probabilities:{absent:1,positive:0,negative:0,both:0}}]))});
it('seals 9 unique sources, 225 criteria, exactly 25 questions and one future request per review',async()=>{
 const p=await prepare();expect(await verifyTargetedJev(p)).toBe(true);expect(new Set(p.body.reviews.map(r=>r.id)).size).toBe(9);
 expect(p.body.criteria.cases.reduce((n,r)=>n+Object.keys(r.themes).length,0)).toBe(225);
 expect(p.body.policy).toMatchObject({max_jev_calls:9,max_calls_per_review:1,client_max_attempts:1,repeat_count:1,automatic_retry:false,max_luna_calls:0,max_sol_calls:0,max_apify_calls:0});
 expect(p.body.spending_authorization).toBeNull();expect(p.body.run_id).toBeNull();
 for(const r of p.body.reviews){const payload=auditEconomyPayload(r.request_state.review_alias,r.analysis_text!);
  expect(Object.keys(payload.questions)).toHaveLength(25);expect(Object.keys(payload.state)).toEqual(['review_alias','analysis_text']);
  expect(JSON.stringify(payload)).not.toMatch(/criteria_sha256|expected_choice|original_text|review_detailed_rating|baseline_sha256/);
  expect(await hybridHash(payload)).toBe(r.request_sha256);
 }
});
it('preserves the exact Good service source and all three textual witnesses',async()=>{
 const p=await prepare();expect(p.body.reviews.find(r=>r.id==='b11e77a1-6249-4ca8-b279-33832681d957')!.analysis_text).toBe('Good service');
 expect(p.body.reviews.filter(r=>r.role==='witness')).toHaveLength(3);expect(p.body.criteria.cases.some(r=>Object.values(r.themes).some(x=>x.manual_review_only))).toBe(true);
 expect(p.body.criteria.human_gold).toBe(false);expect(p.body.evaluation_scope).toContain('not_independent');
});
it.each(['text','source_tenant','criteria_theme','criteria_count','baseline'])('refuses changed %s before freezing',async kind=>{
 const f=structuredClone(frozen),c=structuredClone(criteria) as TargetCriteria;
 if(kind==='text')f.source.reviews[0].analysis_text+='changed';
 if(kind==='source_tenant')f.source.reviews[0].organization_id='other';
 if(kind==='criteria_theme')delete (c.cases[0].themes as Partial<typeof c.cases[0]['themes']>).cooking;
 if(kind==='criteria_count')c.cases[0].review_id=c.cases[1].review_id;
 if(kind==='baseline')f.baseline[0].analysis_text_sha256='0'.repeat(64);
 await expect(prepareTargetedJev(f.source,c,f.baseline)).rejects.toThrow();
});
it.each(['request_template','criteria','source','policy'])('refuses an altered sealed %s',async kind=>{
 const p=await prepare();if(kind==='request_template')p.body.request_template.model='other';
 if(kind==='criteria')p.body.criteria.cases[0].ambiguities+='changed';
 if(kind==='source')p.body.reviews[0].original_text+='changed';if(kind==='policy')p.body.policy={...p.body.policy,max_jev_calls:99};
 await expect(verifyTargetedJev(p)).rejects.toThrow('TARGETED_PROTOCOL_CHANGED');
});
it('simulated output plumbing preserves all 25 native distributions and flags served-model drift without a quality score',async()=>{
 const p=await prepare(),raw=synthetic(),r=await parseTargetedJevResult(p,p.body.reviews[0].id,raw);
 expect(Object.keys(r.native.themes)).toHaveLength(25);expect(Object.keys(r.theme_results)).toHaveLength(25);
 expect(r).not.toHaveProperty('accuracy');expect(r).not.toHaveProperty('gold');
 raw.model='jev-new-version';expect((await parseTargetedJevResult(p,p.body.reviews[0].id,raw)).model_differs_from_historical_baseline).toBe(true);
});
it('rejects a response missing a non-targeted theme',async()=>{
 const p=await prepare(),raw=synthetic();delete (raw.answers as Partial<typeof raw.answers>).noise;
 await expect(parseTargetedJevResult(p,p.body.reviews[0].id,raw)).rejects.toThrow('TARGETED_ALL_25_REQUIRED');
});
it.each(['429','500','network','invalid_json'])('existing client: one simulated attempt, never a retry after %s',async kind=>{
 let calls=0;const client=createJevClient('SYNTHETIC_ONLY',{maxAttempts:1,fetcher:async()=>{calls++;
  if(kind==='network')throw TypeError('synthetic lost response');if(kind==='invalid_json')return new Response('invalid');return new Response('{}',{status:Number(kind)});},sleep:()=>{throw Error('RETRY_FORBIDDEN');}});
 await expect(client.evaluatePayload(auditEconomyPayload('r','Synthetic English.'),x=>x)).rejects.toThrow();expect(calls).toBe(1);
});
