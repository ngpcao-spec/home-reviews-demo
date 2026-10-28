// @vitest-environment node
import {readFileSync} from 'node:fs';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {recommendationDatabase} from '../fixtures/recommendation-sheet-database';
import {recommendationPublication} from '../fixtures/recommendation-publication';
import {placePriceInput,placePriceObservation} from '../../supabase/functions/_shared/google-place-price';
let db:PGlite;
const org='10000000-0000-4000-8000-000000000001',est='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002';
const identity={google_id:'123',place_id:'place',google_maps_url:'https://www.google.com/maps?cid=123',language:'vi' as const};
const observation=(price:string|null='100-200 N ₫')=>placePriceObservation([{cid:'123',placeId:'place',language:'vi',price,scrapedAt:'2026-10-28T14:51:44.560Z',reviews:[]}],identity);
const json=(x:unknown)=>JSON.stringify(x);
async function query<T>(sql:string,args:unknown[]=[]){return (await db.query<{v:T}>(sql,args)).rows[0]?.v;}
const enqueue=()=>query<string>('select public.enqueue_google_place_price($1) v',[est]);
const claim=(worker='worker')=>query<Record<string,unknown>|null>('select public.claim_google_place_price_job($1) v',[worker]);
const action=(id:unknown,a:string,data:unknown={},worker='worker')=>query<boolean>('select public.advance_google_place_price_job($1,$2,$3,$4) v',[id,worker,a,json(data)]);
const budget=()=>query<Record<string,unknown>>("select metadata#>'{budget,establishment_price}' v from public.restaurant_recommendation_sheets where establishment_id=$1",[est]);
beforeAll(async()=>{
 db=await recommendationDatabase();
 await db.exec(`alter table public.establishments add column active boolean default true,add column initialized_at timestamptz default now(),add column collection_language text default 'vi';
 alter table public.review_corpus_policy add column ingestions_paused boolean default false;
 create table public.initial_import_jobs(id uuid primary key default gen_random_uuid(),status text,establishment_id uuid,request_kind text default 'initial');
 create table public.establishment_snapshots(id uuid primary key default gen_random_uuid(),establishment_id uuid,organization_id uuid,captured_at timestamptz,provider text,raw_place_payload jsonb);
 create table public.review_sync_provider_slots(slot_number smallint primary key,locked_by text,lease_until timestamptz);insert into public.review_sync_provider_slots values(1,null,null);
 create function public.claim_review_provider_slot(p_worker_token text,p_lease_seconds int) returns smallint language plpgsql as $$begin
  if exists(select 1 from public.review_sync_provider_slots where locked_by is not null and lease_until>clock_timestamp()) then return null;end if;
  update public.review_sync_provider_slots set locked_by=p_worker_token,lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds);return 1;end$$;
 create function public.release_review_provider_slot(p_slot_number smallint,p_worker_token text,p_cooldown_ms int) returns boolean language plpgsql as $$begin
  update public.review_sync_provider_slots set locked_by=null,lease_until=null where slot_number=p_slot_number and locked_by=p_worker_token;return found;end$$;
 create schema cron;create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
 create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);insert into vault.decrypted_secrets values('home_reviews_scheduler_token','test-only');
 create schema net;create table net.wakes(n bigint generated always as identity);
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language plpgsql as $$declare n bigint;begin insert into net.wakes default values returning wakes.n into n;return n;end$$;
 insert into public.organizations values('${org}');
 insert into public.establishments(id,organization_id,name,google_id,place_id,address,google_maps_url) values('${est}','${org}','Fixture','123','place','Address','https://www.google.com/maps?cid=123'),('${other}','${org}','Other','456','other','Address','https://www.google.com/maps?cid=456');
 insert into public.review_corpus_policy(enabled,paused,epoch) values(true,false,gen_random_uuid());`);
 await db.exec(readFileSync('supabase/migrations/20261028121845_recommendation_negative_weight_4.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261028133850_google_maps_price_provenance.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261028151639_google_place_price_jobs.sql','utf8'));
},60000);
beforeEach(async()=>{vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN')}));await db.exec('begin;update private.google_place_price_config set enabled=true;');});
afterEach(async()=>{await db.exec('rollback');expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});afterAll(()=>db.close());
async function publish(){const p=await recommendationPublication(3,{positive:1});await db.query('insert into public.current_report_publications select * from jsonb_populate_record(null::public.current_report_publications,$1)',[json({...p,updated_at:p.generated_at})]);}
async function started(){const id=await enqueue();const j=await claim();expect(j?.id).toBe(id);expect(await action(id,'reserve',{input:placePriceInput(identity)})).toBe(true);return id;}
async function bind(id:unknown){expect(await action(id,'run',{id:'run',dataset_id:'data',status:'SUCCEEDED',receipt:{usageTotalUsd:0.005}})).toBe(true);}
it('enqueues after durable initial completion only; failure or reload cannot gate reviews or trigger price collection',async()=>{
 await db.exec(`insert into public.initial_import_jobs(status,establishment_id) values('running','${est}');`);
 expect(await query('select count(*)::int v from private.google_place_price_jobs')).toBe(0);
 await db.exec("update public.initial_import_jobs set status='completed'");expect(await query('select count(*)::int v from private.google_place_price_jobs')).toBe(1);
 expect(await enqueue()).toBe(await enqueue());expect(await query('select count(*)::int v from private.google_place_price_jobs')).toBe(1);
 expect(await query('select count(*)::int v from net.wakes')).toBe(1);
 await db.exec(`insert into public.initial_import_jobs(status,establishment_id,request_kind) values('running','${other}','reload');update public.initial_import_jobs set status='completed';`);
 expect(await query('select count(*)::int v from private.google_place_price_jobs')).toBe(1);
});
it('serializes claims, shares the provider slots and consumes a single start even across duplicate invocations',async()=>{
 const id=await started();expect(await claim('duplicate')).toBeNull();expect(await action(id,'reserve',{input:placePriceInput(identity)})).toBe(false);
 await db.exec('savepoint invalid');await expect(action(id,'finish',{observation:observation()})).rejects.toThrow('PLACE_PRICE_SUCCESS_REQUIRED');await db.exec('rollback to invalid');
});
it('an expired unbound start becomes unknown forever, never a new collection',async()=>{
 const id=await started();await db.exec("update private.google_place_price_jobs set lease_until=clock_timestamp()-interval '1 second'");
 expect(await claim()).toBeNull();expect(await query('select status v from private.google_place_price_jobs where id=$1',[id])).toBe('unknown');expect(await enqueue()).toBe(id);
 await db.exec("update private.google_place_price_jobs set start_attempted_at=clock_timestamp()-interval '1 hour'");expect(await claim()).toBeNull();
 expect(await query('select attempts v from private.google_place_price_jobs where id=$1',[id])).toBe(1);
});
it('a known run survives interruption and can save its response without another reservation or replacement',async()=>{
 await publish();const id=await started();await bind(id);await db.exec("update private.google_place_price_jobs set lease_until=clock_timestamp()-interval '1 second'");
 expect((await claim('resumed'))?.run_id).toBe('run');expect(await action(id,'reserve',{input:placePriceInput(identity)},'resumed')).toBe(false);
 expect(await action(id,'finish',{observation:observation(),receipt:{usageTotalUsd:0.005}},'resumed')).toBe(true);
 expect(await action(id,'finish',{observation:observation(null)},'resumed')).toBe(false);expect((await budget())?.price).toBe('100-200 N ₫');
});
it('null means not provided, failure means failed, and neither erases or re-dates an older known value',async()=>{
 await publish();await db.query('insert into public.establishment_snapshots(establishment_id,organization_id,captured_at,provider,raw_place_payload) values($1,$2,$3,$4,$5)',[est,org,'2026-10-20','apify',json({cid:'123',price:'₫₫',scrapedAt:'2026-10-20'})]);
 const old=await budget(),id=await started();await bind(id);await action(id,'finish',{observation:observation(null),receipt:{status:'SUCCEEDED'}});
 expect(await budget()).toMatchObject({price:'₫₫',observed_at:old?.observed_at,collection_status:'not_provided'});expect(await claim()).toBeNull();
});
it('a failed collection leaves the completed import available, is not automatically retried and honors a busy shared provider slot',async()=>{
 await db.exec(`insert into public.initial_import_jobs(status,establishment_id) values('running','${est}');update public.initial_import_jobs set status='completed';
 update public.review_sync_provider_slots set locked_by='reviews-worker',lease_until=clock_timestamp()+interval '1 minute';`);
 expect(await claim()).toBeNull();await db.exec('update public.review_sync_provider_slots set locked_by=null,lease_until=null');
 const j=await claim();await action(j?.id,'reserve',{input:placePriceInput(identity)});await action(j?.id,'fail',{code:'PLACE_PRICE_PROVIDER_FAILED'});
 expect(await query('select status v from private.google_place_price_jobs')).toBe('failed');expect(await claim()).toBeNull();
 expect(await query('select status v from public.initial_import_jobs')).toBe('completed');
});
it('a pending known run retains its concurrency place during a short defer and a deleted establishment cannot be republished',async()=>{
 const id=await started();await bind(id);await action(id,'defer');await query('select public.enqueue_google_place_price($1) v',[other]);
 expect(await claim()).toBeNull();await db.exec("update private.google_place_price_jobs set available_at=clock_timestamp()-interval '1 second'");
 expect((await claim('resume'))?.id).toBe(id);
 await db.query('delete from public.establishments where id=$1',[est]);expect(await action(id,'finish',{observation:observation()},'resume')).toBe(false);
 expect(await query('select count(*)::int v from public.establishments where id=$1',[est])).toBe(0);
});
it('refuses mismatched Google IDs and keeps all scores, reports, stale states, reviews and other restaurants intact',async()=>{
 await publish();await db.exec("update public.restaurant_recommendation_sheets set stale=true,stale_reason='EXISTING';");
 const before=await query("select jsonb_build_object('s',(select jsonb_agg(to_jsonb(s)-'metadata') from public.restaurant_recommendation_sheets s),'p',(select jsonb_agg(to_jsonb(p)) from public.current_report_publications p),'r',(select jsonb_agg(to_jsonb(r)) from public.reviews r),'e',(select jsonb_agg(to_jsonb(e) order by id) from public.establishments e)) v");
 const id=await started();await bind(id);const bad=observation();bad.raw.cid='other';
 await db.exec('savepoint invalid');await expect(action(id,'finish',{observation:bad})).rejects.toThrow('PLACE_PRICE_IDENTITY_MISMATCH');await db.exec('rollback to invalid');
 await action(id,'fail',{code:'PLACE_PRICE_IDENTITY_MISMATCH'});expect((await budget())?.collection_status).toBe('identity_mismatch');
 const after=await query("select jsonb_build_object('s',(select jsonb_agg(to_jsonb(s)-'metadata') from public.restaurant_recommendation_sheets s),'p',(select jsonb_agg(to_jsonb(p)) from public.current_report_publications p),'r',(select jsonb_agg(to_jsonb(r)) from public.reviews r),'e',(select jsonb_agg(to_jsonb(e) order by id) from public.establishments e)) v");expect(after).toEqual(before);
});
it('reuses an existing paid observation without enqueue/wake/provider call and serves it to future publications',async()=>{
 const ob={...observation(),unit:'per_person',unit_evidence:{source:'google_maps_ui',label:'100 000–200 000 ₫ / person'}};
 const args=[est,'prior-run','prior-data',json(ob),json({status:'SUCCEEDED',input:{maxReviews:0}})];
 const sql='select public.reuse_google_place_price($1,$2,$3,$4,$5) v';const id=await query(sql,args);expect(await query(sql,args)).toBe(id);
 expect(await query('select count(*)::int v from net.wakes')).toBe(0);expect(await claim()).toBeNull();await publish();
 expect(await budget()).toMatchObject({source:'google_maps_place_details',price:'100-200 N ₫',unit:'per_person',observed_at:'2026-10-28T14:51:44.560Z',guaranteed_tariff:false});
});
it('clients cannot enqueue, claim, record reuse or access the private queue',async()=>{
 for(const role of ['anon','authenticated'])for(const fn of ['enqueue_google_place_price(uuid)','claim_google_place_price_job(text)','advance_google_place_price_job(uuid,text,text,jsonb)','reuse_google_place_price(uuid,text,text,jsonb,jsonb)'])
  expect(await query('select has_function_privilege($1,$2,\'execute\') v',[role,'public.'+fn])).toBe(false);
 expect(await query("select has_table_privilege('authenticated','private.google_place_price_jobs','select') v")).toBe(false);
});
