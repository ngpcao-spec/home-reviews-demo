// @vitest-environment node
import {readFileSync} from 'node:fs';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {recommendationDatabase} from '../fixtures/recommendation-sheet-database';
import {recommendationPublication} from '../fixtures/recommendation-publication';
let db:PGlite;
const org='10000000-0000-4000-8000-000000000001',est='20000000-0000-4000-8000-000000000001';
const file='supabase/migrations/20261028133850_google_maps_price_provenance.sql';
const upgrade=()=>db.exec(readFileSync(file,'utf8').replace(/^begin;\s*/,'').replace(/commit;\s*$/,''));
beforeAll(async()=>{
 db=await recommendationDatabase();
 await db.exec(`create table public.establishment_snapshots(id uuid primary key default gen_random_uuid(),establishment_id uuid,organization_id uuid,captured_at timestamptz,provider text,raw_place_payload jsonb);
 insert into public.organizations values('${org}');insert into public.establishments values('${est}','${org}','Fixture','cid','place','Address','Map');
 insert into public.review_corpus_policy values(true,false,gen_random_uuid());`);
 await db.exec(readFileSync('supabase/migrations/20261028121845_recommendation_negative_weight_4.sql','utf8'));
},60000);
beforeEach(async()=>{vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN')}));await db.exec('begin')});
afterEach(async()=>{await db.exec('rollback');expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals()});afterAll(()=>db.close());
async function publish(){const p=await recommendationPublication(3,{positive:1});p.source_bindings[0].review_context={price_per_person:'100-200 N ₫'};p.source_bindings[1].review_context={price_per_person:'Trên 1.000.000 ₫'};
 await db.query('insert into public.current_report_publications select * from jsonb_populate_record(null::public.current_report_publications,$1)',[JSON.stringify({...p,updated_at:p.generated_at})]);return p;}
async function budget(bindings:unknown[]=[]){return (await db.query<{b:Record<string,unknown>}>('select private.recommendation_google_budget_v1($1,$2,$3,$4) b',[est,org,JSON.stringify(bindings),'2026-10-26T00:00:00Z'])).rows[0].b as {establishment_price:Record<string,unknown>;customer_spend_per_person:Record<string,unknown>};}
it('backfills only budgets, preserving every score, stale state, report reference and publication',async()=>{
 await publish();await db.exec("update public.restaurant_recommendation_sheets set stale=true,stale_reason='PREEXISTING_STALE';");
 const before=(await db.query("select to_jsonb(s)-'metadata'-'updated_at' s from public.restaurant_recommendation_sheets s")).rows;
 const pub=(await db.query('select to_jsonb(p) p from public.current_report_publications p')).rows;
 await upgrade();expect((await db.query("select to_jsonb(s)-'metadata'-'updated_at' s from public.restaurant_recommendation_sheets s")).rows).toEqual(before);
 expect((await db.query('select to_jsonb(p) p from public.current_report_publications p')).rows).toEqual(pub);
 const m=(await db.query<{m:{establishment_price:Record<string,unknown>;customer_spend_per_person:{ranges:{value:string;review_count:number}[]}}}>("select metadata->'budget' m from public.restaurant_recommendation_sheets")).rows[0].m;
 expect(m.establishment_price.missing_reason).toBe('NO_IDENTITY_MATCHED_OBSERVATION');expect(m.customer_spend_per_person.ranges.map(x=>x.value)).toContain('100-200 N ₫');
});
it('future snapshots retain only explicit Google price and identity fields, with no review content',async()=>{
 await upgrade();await db.exec('create trigger prices_sanitize before insert or update on public.establishment_snapshots for each row execute function private.retention_sanitize_snapshot()');
 const payload={cid:'cid',placeId:'place',price:'₫₫',priceLevel:2,priceRange:'100-200 N ₫',scrapedAt:'2026-10-26',text:'Removed',reviewContext:{'Giá mỗi người':'500-600 N ₫'},author:'Removed',description:'Removed'};
 await db.query('insert into public.establishment_snapshots(establishment_id,organization_id,captured_at,provider,raw_place_payload) values($1,$2,$3,$4,$5)',[est,org,'2026-10-26','apify',JSON.stringify(payload)]);
 const saved=(await db.query<{p:Record<string,unknown>}>('select raw_place_payload p from public.establishment_snapshots')).rows[0].p;
 expect(saved).toEqual({cid:'cid',placeId:'place',price:'₫₫',priceLevel:2,priceRange:'100-200 N ₫',scrapedAt:'2026-10-26'});
 expect((await budget()).establishment_price).toMatchObject({price_level:2,price_range:'100-200 N ₫',source_table:'establishment_snapshots',status:'provided'});
 const nested=(await db.query<{v:unknown}>('select private.google_price_fields_v1($1) v',[JSON.stringify({cid:'cid',priceRange:{minimum:100000,maximum:200000,currency:'VND',text:'Removed',reviews:['Removed']}})])).rows[0].v;
 expect(nested).toEqual({cid:'cid',priceRange:{minimum:100000,maximum:200000,currency:'VND'}});
});
it('uses the last real known price with its date, refuses identity contradictions and does not infer from client spending',async()=>{
 await upgrade();
 for(const [date,payload] of [['2026-10-20T00:00:00Z',{cid:'cid',price:'€€'}],['2026-10-21T00:00:00Z',{cid:'cid',price:null}],['2026-10-22T00:00:00Z',{cid:'other',placeId:'place',price:'$$$$'}]] as const)
  await db.query('insert into public.establishment_snapshots(establishment_id,organization_id,captured_at,provider,raw_place_payload) values($1,$2,$3,$4,$5)',[est,org,date,'apify',JSON.stringify(payload)]);
 const b=await budget([{id:'a',published_at:'2026-10-26',review_context:{price_per_person:'100-200 N ₫'}}]);expect(b.establishment_price.price).toBe('€€');expect(new Date(String(b.establishment_price.observed_at)).toISOString()).toBe('2026-10-20T00:00:00.000Z');
 await db.exec('delete from public.establishment_snapshots');expect((await budget()).establishment_price.status).toBe('not_provided');
});
it('distinguishes a returned null price from an absent field, preserving future field-name provenance',async()=>{
 await upgrade();
 const insert=async(raw:unknown)=>db.query('insert into public.establishment_snapshots(establishment_id,organization_id,captured_at,provider,raw_place_payload) values($1,$2,$3,$4,$5)',[est,org,'2026-10-26','apify',JSON.stringify(raw)]);
 await insert({cid:'cid',price:null});expect((await budget()).establishment_price).toMatchObject({status:'not_provided',source_fields:['price'],missing_reason:'PROVIDER_PRICE_NULL_OR_EMPTY'});
 await db.exec('delete from public.establishment_snapshots');await insert({cid:'cid'});expect((await budget()).establishment_price.missing_reason).toBe('PRICE_FIELDS_ABSENT');
 const raw={'Giá mỗi người':'100-200 N ₫'};
 expect((await db.query<{v:unknown}>('select private.recommendation_spend_context_v1($1) v',[JSON.stringify(raw)])).rows[0].v).toEqual({price_per_person:'100-200 N ₫',price_per_person_source_key:'Giá mỗi người'});
});
it('counts one client per frozen review, keeps provenance/dates and flags conflicting aliases and incomplete context',async()=>{
 await upgrade();const x={id:'a',published_at:'2026-10-20',review_context:{'Prix par personne':'10–20 €','Giá mỗi người':'10–20 €'}};
 const b=await budget([x,x,{id:'b',published_at:'2026-10-21'}]);expect(b.customer_spend_per_person).toMatchObject({status:'frozen_context_incomplete',guaranteed_tariff:false,observed_at:'2026-10-26T00:00:00Z',ranges:[{value:'10–20 €',review_count:1}]});
 expect((await budget([{...x,review_context:{'Prix par personne':'10–20 €','Giá mỗi người':'100-200 N ₫'}}])).customer_spend_per_person).toMatchObject({conflicting_reviews:1,ranges:[]});
});
it('refreshes only the existing sheet budget after a snapshot, keeping stale scores and the own frozen spending',async()=>{
 await publish();await db.exec("update public.restaurant_recommendation_sheets set stale=true,stale_reason='PREEXISTING_STALE';");await upgrade();
 const before=(await db.query("select to_jsonb(s)-'metadata'-'updated_at' s from public.restaurant_recommendation_sheets s")).rows;
 await db.query('insert into public.establishment_snapshots(establishment_id,organization_id,captured_at,provider,raw_place_payload) values($1,$2,$3,$4,$5)',[est,org,'2026-10-28T00:00:00Z','apify',JSON.stringify({cid:'cid',price:'₫₫'})]);
 expect((await db.query("select metadata#>>'{budget,establishment_price,price}' p from public.restaurant_recommendation_sheets")).rows[0].p).toBe('₫₫');
 expect((await db.query("select to_jsonb(s)-'metadata'-'updated_at' s from public.restaurant_recommendation_sheets s")).rows).toEqual(before);
});
it('allows the actual service-role ingestion trigger without granting private helper execution',async()=>{
 await publish();await upgrade();
 await db.exec('create trigger prices_sanitize before insert or update on public.establishment_snapshots for each row execute function private.retention_sanitize_snapshot();grant insert,select on public.establishment_snapshots to service_role;grant select on public.review_corpus_policy to service_role;set local role service_role');
 await db.query('insert into public.establishment_snapshots(establishment_id,organization_id,captured_at,provider,raw_place_payload) values($1,$2,$3,$4,$5)',[est,org,'2026-10-28T00:00:00Z','apify',JSON.stringify({cid:'cid',price:'₫₫',text:'Removed'})]);
 await db.exec('reset role');
 expect((await db.query("select metadata#>>'{budget,establishment_price,price}' p from public.restaurant_recommendation_sheets")).rows[0].p).toBe('₫₫');
 expect((await db.query("select has_function_privilege('service_role','private.google_price_fields_v1(jsonb)','EXECUTE') f")).rows[0].f).toBe(false);
});
it('preserves frozen spending on future publications without current-review contamination; functions remain private',async()=>{
 await upgrade();await db.exec(`insert into public.reviews(id,organization_id,establishment_id,review_context) values(gen_random_uuid(),'${org}','${est}','{"price_per_person":"900-1000 N ₫"}');`);await publish();
 const saved=(await db.query<{v:string}>("select metadata#>>'{budget,customer_spend_per_person,ranges,0,value}' v from public.restaurant_recommendation_sheets")).rows[0].v;
 expect(saved).not.toBe('900-1000 N ₫');
 expect((await db.query("select has_function_privilege('authenticated','private.recommendation_google_budget_v1(uuid,uuid,jsonb,text)','EXECUTE') a,has_function_privilege('service_role','private.recommendation_google_budget_v1(uuid,uuid,jsonb,text)','EXECUTE') s")).rows[0]).toEqual({a:false,s:false});
});
