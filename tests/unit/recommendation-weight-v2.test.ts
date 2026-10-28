// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {recommendationDatabase} from '../fixtures/recommendation-sheet-database';
import {recommendationPublication as publication} from '../fixtures/recommendation-publication';
let db:PGlite;
const org='10000000-0000-4000-8000-000000000001',est='20000000-0000-4000-8000-000000000001',user='30000000-0000-4000-8000-000000000001';
const migration=readFileSync('supabase/migrations/20261028121845_recommendation_negative_weight_4.sql','utf8');
const upgrade=()=>db.exec(migration.replace(/^begin;\s*/,'').replace(/commit;\s*$/,''));
beforeAll(async()=>{db=await recommendationDatabase();await db.exec(`insert into public.organizations values('${org}');
 insert into public.establishments values('${est}','${org}','Fixture','cid','place','Address','Maps');
 insert into public.organization_members values('${org}','${user}','owner');`);},60000);
beforeEach(async()=>{vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN')}));await db.exec('begin');});
afterEach(async()=>{await db.exec('rollback');expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});afterAll(()=>db.close());
type Pub=Awaited<ReturnType<typeof publication>>;
const calc=async(p:Pub,version=2)=>(await db.query<{c:{version:string;negative_weight:number;global_score:number|null;comparable:boolean;categories:Record<string,{score:number|null;positive:number;negative:number;base_average:number|null;score_numerator:number;score_denominator:number}>}}>('select private.recommendation_calculation_v'+version+'($1) c',[JSON.stringify(p)])).rows[0].c;
async function publish(p:Pub){await db.query(`insert into public.current_report_publications select * from jsonb_populate_record(null::public.current_report_publications,$1)
 on conflict(establishment_id,language) do update set report_id=excluded.report_id,document=excluded.document,source_bindings=excluded.source_bindings,scope=excluded.scope,generated_at=excluded.generated_at`,[JSON.stringify({...p,updated_at:p.generated_at})]);}

it('without negatives preserves V1 scores; four positives exactly compensate one exclusive negative',async()=>{
 await upgrade();for(const positive of [0,1,60]){const p=await publication(150,{positive,rating:4.8});expect((await calc(p)).global_score).toBe((await calc(p,1)).global_score);}
 const c=await calc(await publication(150,{positive:4,negative:1,rating:4.8}));expect(c.global_score).toBe(4.8);expect(c).toMatchObject({version:'internal-recommendation-v2',negative_weight:-4});
 expect((await calc(await publication(150,{positive:60,negative:15,rating:4.8}))).global_score).toBe(4.8);
 expect((await calc(await publication(150,{positive:60,negative:15,rating:4.8}),1)).global_score).toBe(5);
});
it('clamps at 0 and 6 and uses the actual corpus size, including textless reviews',async()=>{
 await upgrade();expect((await calc(await publication(10,{negative:10,rating:1}))).global_score).toBe(0);
 expect((await calc(await publication(10,{positive:10}))).global_score).toBe(6);
 expect((await calc(await publication(10,{positive:4,negative:1,texts:5,rating:4}))).global_score).toBe(4);
 expect((await calc(await publication(10,{negative:1,texts:5,rating:4}))).global_score).toBe(3.6);
 expect((await calc(await publication(20,{rating:4.2,texts:0}))).global_score).toBe(4.2);
 expect((await calc(await publication(0))).global_score).toBeNull();
});
it('mixed and unmentioned contribute zero and inclusive mixed counters never become exclusive negatives',async()=>{
 await upgrade();const c=await calc(await publication(10,{positive:1,negative:1,mixed:5,rating:4}));
 expect(c.categories.quality).toMatchObject({positive:1,negative:1,score:3.7});
 expect((await calc(await publication(10,{mixed:10,rating:4}))).global_score).toBe(4);
});
it('does not invent a missing category or comparable global; the global uses all three available unrounded categories',async()=>{
 await upgrade();const missing=await calc(await publication(10,{positive:10,details:{Service:4,Atmosphere:5}}));
 expect(missing.categories.quality.score).toBeNull();expect(missing.global_score).toBeNull();expect(missing.comparable).toBe(false);
 const c=await calc(await publication(5,{positive:4,negative:1,details:{Food:5,Service:4,Atmosphere:3.5}}));
 expect(c.categories.quality.score).toBe(5);expect(c.categories.service.score).toBe(4);expect(c.categories.ambiance.score).toBe(3.5);
 expect(c.global_score).toBeCloseTo(12.5/3,14);
 const fractional=await calc(await publication(3,{positive:1,rating:4}));expect(fractional.categories.quality).toMatchObject({score_numerator:39,score_denominator:9});
 expect(fractional.global_score).toBeCloseTo(4+1/3,14);
});
it('retains duplicate/corpus guards and never substitutes the global star rating',async()=>{
 await upgrade();const p=await publication(3,{positive:2});p.source_bindings[2].id=p.source_bindings[0].id;expect((await calc(p)).global_score).toBeNull();
 const other=await publication(3);other.scope.review_count=2;expect((await calc(other)).global_score).toBeNull();
});
it('backfills only scores/version from the own durable report, preserving stale state, references, metadata, sections and all publications',async()=>{
 const p=await publication(150,{positive:60,negative:15,rating:4.8});await publish(p);
 await db.exec("update public.restaurant_recommendation_sheets set stale=true,stale_reason='PREEXISTING_STALE';");
 const before=(await db.query('select to_jsonb(s) s from public.restaurant_recommendation_sheets s')).rows[0].s as Record<string,unknown>;
 const pubBefore=(await db.query('select to_jsonb(p) p from public.current_report_publications p')).rows;
 await db.exec(`insert into public.reviews(id,organization_id,establishment_id,rating,review_detailed_rating) values(gen_random_uuid(),'${org}','${est}',1,'{"Food":1}');`);
 await upgrade();const after=(await db.query('select to_jsonb(s) s from public.restaurant_recommendation_sheets s')).rows[0].s as Record<string,unknown>;
 expect(after).toMatchObject({calculation_version:'internal-recommendation-v2',quality_score:4.8,service_score:4.8,ambiance_score:4.8,global_score:4.8,stale:true,stale_reason:'PREEXISTING_STALE'});
 for(const key of ['report_id','source_run_id','report_generated_at','corpus','metadata','report_sections'])expect(after[key]).toEqual(before[key]);
 expect((await db.query('select to_jsonb(p) p from public.current_report_publications p')).rows).toEqual(pubBefore);
});
it('new/replacement publications use V2; stale-only updates keep scores and failed generations cannot replace the sheet',async()=>{
 await upgrade();const p=await publication(10,{negative:1,rating:4});await publish(p);
 const first=(await db.query('select * from public.restaurant_recommendation_sheets')).rows[0];expect(first).toMatchObject({calculation_version:'internal-recommendation-v2',quality_score:'3.6000000000000000'});
 await db.exec("update public.current_report_publications set stale=true,stale_reason='CORPUS_CHANGED';");
 const stale=(await db.query('select * from public.restaurant_recommendation_sheets')).rows[0];expect(stale.calculation).toEqual(first.calculation);expect(stale.calculated_at).toEqual(first.calculated_at);expect(stale.stale).toBe(true);
 await db.exec("insert into public.analysis_parallel_reports values(gen_random_uuid(),'"+est+"','vi','invalid_output');");expect((await db.query('select report_id from public.restaurant_recommendation_sheets')).rows[0].report_id).toBe(p.report_id);
 const next=await publication(5,{positive:5});next.report_id='40000000-0000-4000-8000-000000000002';next.document.id=next.report_id;await publish(next);
 expect((await db.query('select count(*)::int n,min(report_id::text) id,min(calculation_version) v from public.restaurant_recommendation_sheets')).rows[0]).toEqual({n:1,id:next.report_id,v:'internal-recommendation-v2'});
});
it('refuses a mismatched report backfill atomically instead of using another corpus',async()=>{
 await publish(await publication(10));await db.exec("update public.restaurant_recommendation_sheets set report_id=gen_random_uuid();savepoint migration_attempt;");
 await expect(upgrade()).rejects.toThrow('RECOMMENDATION_SHEET_FROZEN_REPORT_MISMATCH');await db.exec('rollback to savepoint migration_attempt');
 expect((await db.query('select calculation_version from public.restaurant_recommendation_sheets')).rows[0].calculation_version).toBe('internal-recommendation-v1');
});
it('keeps organization access and private functions restricted; a restaurant without a report has no invented sheet',async()=>{
 await upgrade();expect((await db.query('select count(*)::int n from public.restaurant_recommendation_sheets')).rows[0].n).toBe(0);await publish(await publication(5));
 await db.exec(`set local role authenticated;select set_config('test.user_id','${user}',true)`);expect((await db.query('select count(*)::int n from public.restaurant_recommendation_sheets')).rows[0].n).toBe(1);
 await db.exec("select set_config('test.user_id','30000000-0000-4000-8000-000000000002',true)");expect((await db.query('select count(*)::int n from public.restaurant_recommendation_sheets')).rows[0].n).toBe(0);await db.exec('reset role');
 expect((await db.query("select has_function_privilege('authenticated','private.recommendation_calculation_v2(jsonb)','EXECUTE') f,has_table_privilege('authenticated','public.restaurant_recommendation_sheets','UPDATE') u")).rows[0]).toEqual({f:false,u:false});
});
