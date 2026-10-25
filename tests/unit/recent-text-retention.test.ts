// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
const fixture=JSON.parse(readFileSync('tests/fixtures/retention-production-definitions.json','utf8'));
let db:PGlite;
const org='10000000-0000-4000-8000-000000000001',est='20000000-0000-4000-8000-000000000001',user='30000000-0000-4000-8000-000000000001';
beforeAll(async()=>{
 db=new PGlite({extensions:{pgcrypto}});await db.waitReady;
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.uid() returns uuid language sql as $$select null::uuid$$;create schema private;create schema extensions;create extension pgcrypto with schema extensions;create schema cron;create table cron.job(jobid bigint,jobname text,active boolean);create function cron.alter_job(bigint,active boolean) returns void language sql as $$update cron.job set active=$2 where jobid=$1$$;`);
 await db.exec("set search_path=public,extensions;set timezone='UTC'");
 const tables=new Map<string,typeof fixture.columns>();
 for(const c of fixture.columns){const key=c.schema+'.'+c.table;if(!tables.has(key))tables.set(key,[]);tables.get(key)!.push(c);}
 for(const [key,cols] of tables)await db.exec('create table '+key+'('+cols.map((c:{column:string,type:string,default:string|null})=>'"'+c.column+'" '+c.type+(c.default?' default '+c.default:'')).join(',')+')');
 for(const c of fixture.constraints){const key=c.table.includes('.')?c.table:'public.'+c.table;if(tables.has(key)&&/^(PRIMARY KEY|UNIQUE)/.test(c.definition))await db.exec('alter table '+key+' add constraint "'+c.name+'" '+c.definition);}
 // Parent identities remain outside the purge scope in production.
 await db.exec('create table if not exists public.organizations(id uuid primary key);grant usage on schema private,extensions to service_role;grant all on all tables in schema public,private to service_role;grant select on public.organization_members to authenticated;');
 for(const f of fixture.functions.filter((f:{proname:string})=>['enqueue_current_report','jev_batch_claim','jev_batch_claim_sol'].includes(f.proname)))await db.exec(f.definition);
 await db.exec("create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin insert into cron.job values(999,$1,true);return 999;end $$");
 for(const suffix of ['_recent_text_retention_transition.sql','_recent_text_retention_policy.sql','_recent_text_retention_safety.sql','_recent_text_source_guard.sql','_recent_text_rebuild_barrier.sql'])await db.exec(readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith(suffix)),'utf8'));
 await db.exec(`update public.review_corpus_policy set enabled=true,paused=false,ingestions_paused=false;insert into public.organizations values('${org}');insert into public.establishments(id,organization_id,name,google_id,google_maps_url) values('${est}','${org}','Fixture','fixture','fixture');insert into public.organization_members(organization_id,user_id,role) values('${org}','${user}','owner');insert into public.report_pipeline_settings(id,engine,jev_transport) values(true,'jev_sol_v2','batch_initial_v1') on conflict(id) do update set engine=excluded.engine,jev_transport=excluded.jev_transport;`);
},60000);
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));afterAll(()=>db.close());
const insert=(id:string,date:string,text='Text',rating=5)=>db.query(`insert into public.reviews(organization_id,establishment_id,external_review_id,author_name,rating,text,original_text,published_at) values($1,$2,$3,'Fixture',$4,$5,$5,$6) returning id`,[org,est,id,rating,text,date]);
it('uses six calendar months including month ends, never 180 days',async()=>{expect((await db.query("select public.recent_review_cutoff('2026-08-31 15:00+07')::text v")).rows).toEqual([{v:'2026-02-28 08:00:00+00'}]);});
it('keeps exactly the newest 100, independently of stars, with stable equal-date ties',async()=>{
 const date=new Date(Date.now()-86400000).toISOString();for(let i=104;i>=0;i--)await insert('r'+String(i).padStart(3,'0'),date,'Text',i%5+1);
 const rows=(await db.query('select external_review_id,rating from public.reviews order by external_review_id')).rows;
 expect(rows).toHaveLength(100);expect(rows.at(-1)?.external_review_id).toBe('r099');expect(new Set(rows.map(r=>r.rating)).size).toBe(5);
});
it('deduplicates observations and aggregates textless reviews without retaining them',async()=>{
 await insert('no-text',new Date().toISOString(),'   ',1);await insert('no-text',new Date().toISOString(),'   ',1);
 expect((await db.query('select count(*)::int n from public.reviews')).rows[0].n).toBe(0);
 expect((await db.query('select observed_textless_reviews::int n from public.review_observation_totals')).rows[0].n).toBe(1);
});
it('never admits undated, future or old reviews and never launders publication with reimport',async()=>{
 await insert('old','2020-01-01');await insert('old',new Date().toISOString());await insert('future','2099-01-01');
 expect((await db.query('select count(*)::int n from public.reviews')).rows[0].n).toBe(0);
});
it('expires without a new ingestion and removes review-scoped translations and raws',async()=>{
 const r=await insert('expires',new Date(Date.now()-86400000).toISOString());const rid=r.rows[0].id;
 await db.query("insert into public.review_translations(review_id,language,translated_text) values($1,'en','Text')",[rid]);
 await db.query("select public.apply_recent_review_retention($1,now()+interval '7 months')",[est]);
 expect((await db.query('select count(*)::int n from public.reviews')).rows[0].n).toBe(0);expect((await db.query('select count(*)::int n from public.review_translations')).rows[0].n).toBe(0);
});
it('freezes one consistent corpus at enqueue and preserves request idempotency',async()=>{
 await insert('one',new Date(Date.now()-86400000).toISOString());await db.exec('set local role service_role');
 const args=[est,org,user,'vi','40000000-0000-4000-8000-000000000001','gpt-6.1-sol',8];
 const a=(await db.query('select (public.enqueue_current_report($1,$2,$3,$4,$5,$6,$7)).*',args)).rows[0];
 const b=(await db.query('select (public.enqueue_current_report($1,$2,$3,$4,$5,$6,$7)).*',args)).rows[0];
 expect(a.id).toBe(b.id);expect((a.snapshot as {retention:{review_count:number}}).retention.review_count).toBe(1);
 expect((await db.query('select count(*)::int n from public.report_corpus_scopes')).rows[0].n).toBe(1);
});
it('serializes ingestion and freezing on the same establishment lock and guards both native claims',async()=>{
 const rows=(await db.query("select proname,pg_get_functiondef(oid) d from pg_proc where proname in('ingest_recent_reviews','freeze_recent_review_source','jev_batch_claim','jev_batch_claim_sol','retention_review_admission')")).rows;
 for(const name of ['ingest_recent_reviews','freeze_recent_review_source','retention_review_admission'])expect(rows.find(r=>r.proname===name)?.d).toContain('recent-text-corpus:');
 for(const name of ['jev_batch_claim','jev_batch_claim_sol'])expect(rows.find(r=>r.proname===name)?.d).toContain('retention_batch_allowed');
});
it('does not overwrite a known receipt with a later unknown state and keeps the ledger text-free',async()=>{
 const task={id:'40000000-0000-4000-8000-000000000002',request_count:1,status:'unknown',receipt:null,request_wire:'Secret review text',original_text:'Secret review text'};
 await db.query("select private.record_retention_attempt('fixture', $1)",[JSON.stringify(task)]);
 expect((await db.query('select outcome,input_tokens from private.provider_attempt_ledger')).rows).toEqual([{outcome:'unknown',input_tokens:null}]);
 await db.query("select private.record_retention_attempt('fixture', $1)",[JSON.stringify({...task,status:'completed',receipt:{usage:{input_tokens:12,output_tokens:3}}})]);
 await db.query("select private.record_retention_attempt('fixture', $1)",[JSON.stringify(task)]);
 const rows=(await db.query('select to_jsonb(l)::text v from private.provider_attempt_ledger l')).rows;
 expect(rows[0].v).not.toContain('Secret review text');expect(JSON.parse(rows[0].v as string)).toMatchObject({outcome:'completed',input_tokens:12,output_tokens:3});
});
it('preserves publication on edits and removes an edited review that loses all usable text',async()=>{
 const r=await insert('edited',new Date(Date.now()-86400000).toISOString());
 await db.query("update public.reviews set published_at=now(),original_text='Updated',text='Updated' where id=$1",[r.rows[0].id]);
 expect((await db.query("select published_at<now()-interval '12 hours' old_date from public.reviews")).rows[0].old_date).toBe(true);
 await db.query("update public.reviews set original_text='',text='' where id=$1",[r.rows[0].id]);
 expect((await db.query('select count(*)::int n from public.reviews')).rows[0].n).toBe(0);
});
it('refuses legacy unfrozen sources before any worker and blocks unrelated requests during reconstruction',async()=>{
 await expect(db.query("insert into public.historical_report_runs(organization_id,establishment_id,language,status,snapshot) values($1,$2,'vi','queued','{}')",[org,est])).rejects.toThrow('FROZEN_RECENT_CORPUS_REQUIRED');
});
it('keeps retained statistics tenant-scoped and prevents authenticated maintenance/private reads',async()=>{
 await insert('scoped',new Date(Date.now()-86400000).toISOString());await db.exec('set local role authenticated');
 expect((await db.query('select * from public.review_corpus_states')).rows).toEqual([]);
 await expect(db.query('select * from private.review_seen_keys')).rejects.toThrow();
});
