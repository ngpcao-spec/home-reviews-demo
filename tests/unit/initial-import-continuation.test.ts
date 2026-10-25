// @vitest-environment node
import {PGlite} from '@electric-sql/pglite'
import {readFileSync,readdirSync} from 'node:fs'
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest'
const fixture=JSON.parse(readFileSync('tests/fixtures/initial-import-functions.json','utf8'))
let db:PGlite
const org='10000000-0000-4000-8000-000000000001',user='20000000-0000-4000-8000-000000000001'
const migration=readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith('_initial_import_immediate_continuation.sql')),'utf8')
beforeAll(async()=>{
 db=new PGlite();await db.waitReady
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema private;create schema auth;create schema net;create schema vault;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.organizations(id uuid primary key,monitoring_interval_hours integer default 12);
 create table public.organization_members(organization_id uuid,user_id uuid,role text);
 create table public.establishments(id uuid primary key,organization_id uuid,google_id text,initial_import_job_id uuid,active boolean,initialized_at timestamptz,last_review_id text,last_review_at timestamptz,reporting_started_at timestamptz,last_sync_at timestamptz,next_sync_at timestamptz,sync_status text,sync_error text,last_sync_status text,last_sync_error text,updated_at timestamptz);
 create function public.review_sync_spread_offset(uuid,integer) returns interval language sql as $$select interval '0 seconds'$$;
 create function private.is_org_member(p uuid) returns boolean language sql security definer as $$select exists(select 1 from public.organization_members where organization_id=p and user_id=auth.uid())$$;
 create table public.review_corpus_policy(id boolean,enabled boolean default true,paused boolean default false,ingestions_paused boolean default false,retired_relations text[] default '{}');insert into public.review_corpus_policy(id) values(true);
 create table public.review_sync_runtime_config(singleton boolean,provider_slot_count integer);insert into public.review_sync_runtime_config values(true,5);
 create table private.fake_net_calls(id bigint generated always as identity,url text,body jsonb);
 create table vault.decrypted_secrets(name text,decrypted_secret text);insert into vault.decrypted_secrets values('home_reviews_scheduler_token','SYNTHETIC');
 create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 1000) returns bigint language plpgsql as $$declare rid bigint;begin insert into private.fake_net_calls(url,body) values(url,body) returning id into rid;return rid;end$$;`)
 await db.exec('create table public.initial_import_jobs('+fixture.columns.map((c:{name:string;type:string;default:string|null})=>'"'+c.name+'" '+c.type+(c.default?' default '+c.default:'')).join(',')+',primary key(id))')
 await db.exec("create unique index import_one_active on public.initial_import_jobs(organization_id,expected_google_id) where status in('queued','running','retry');alter table public.initial_import_jobs add foreign key(establishment_id) references public.establishments(id)")
 for(const f of fixture.functions)await db.exec(f.definition+';')
 await db.exec(`insert into public.organizations(id) values('${org}');insert into public.organization_members values('${org}','${user}','owner');
 insert into public.initial_import_jobs(organization_id,user_id,query,expected_google_id,status) values('${org}','${user}','legacy','legacy','completed');
 grant usage on schema private,auth to authenticated,service_role;grant all on all tables in schema public to service_role;
 alter table public.initial_import_jobs enable row level security;grant select on public.initial_import_jobs to authenticated;
 create policy read_own on public.initial_import_jobs for select to authenticated using(user_id=auth.uid());`)
 await db.exec(migration)
},30000)
beforeEach(()=>db.exec('begin'))
afterEach(()=>db.exec('rollback'))
afterAll(()=>db.close())
const enqueue=async(name=crypto.randomUUID(),resolution?:string)=>(await db.query('select (public.enqueue_initial_import_job($1,$2,$3,$3,\'vi\',$4)).*',[org,user,name,{resolutionDiagnosticId:resolution}])).rows[0]
const claim=async(worker='worker',max=2)=>(await db.query('select * from public.claim_initial_import_jobs($1,5,240,$2)',[worker,max])).rows
const mark=async(id:unknown,phase:string,worker='worker',nativeAt?:string,status?:string)=>(await db.query('select public.mark_initial_import_phase($1,$2,$3,$4,$5) ok',[id,worker,phase,nativeAt??null,status??null])).rows[0].ok
const checkpoint=async(id:unknown,run='run',dataset='dataset')=>(await db.query('select public.checkpoint_initial_import_job(p_job_id:=$1,p_worker_id:=\'worker\',p_provider_run_id:=$2,p_provider_dataset_id:=$3) ok',[id,run,dataset])).rows[0].ok
it('does not dispatch any existing import during installation, and leaves historical timestamps unknown',async()=>{
 expect((await db.query('select count(*)::int n from private.fake_net_calls')).rows[0].n).toBe(0)
 expect((await db.query('select worker_started_at,provider_start_attempted_at from public.initial_import_jobs')).rows).toEqual([{worker_started_at:null,provider_start_attempted_at:null}])
})
it('does not let an older worker without the durable start guard claim paid work',async()=>{
 await enqueue();expect((await db.query("select * from public.claim_initial_import_jobs('legacy',5,240)")).rows).toHaveLength(0)
 expect(await claim('current')).toHaveLength(1)
})
it('durably enqueues before the wake, deduplicates identical requests and records resolution correlation separately',async()=>{
 const diagnostic=crypto.randomUUID(),a=await enqueue('one',diagnostic),b=await enqueue('one')
 expect(a.id).toBe(b.id);expect(a.reviews_target).toBe(150);expect(a.resolution_diagnostic_id).toBe(diagnostic)
 expect((await db.query('select count(*)::int n from private.fake_net_calls')).rows[0].n).toBe(1)
 await db.query('select public.wake_initial_import_queue($1)',[a.id]);expect((await db.query('select count(*)::int n from private.fake_net_calls')).rows[0].n).toBe(1)
 await db.exec('savepoint rolled_back');await enqueue('rolled-back');await db.exec('rollback to savepoint rolled_back')
 expect((await db.query('select count(*)::int n from private.fake_net_calls')).rows[0].n).toBe(1)
})
it('enforces one shared concurrency budget across overlapping wakes and the cron',async()=>{
 for(let i=0;i<6;i++)await enqueue('job-'+i)
 const first=await claim('a'),second=await claim('b');expect(first).toHaveLength(2);expect(second).toHaveLength(0)
 expect(first.every(j=>j.locked_by==='a')).toBe(true)
 const definition=(await db.query("select pg_get_functiondef('public.claim_initial_import_jobs(text,integer,integer,integer)'::regprocedure) d")).rows[0].d as string
 expect(definition).toContain('pg_advisory_xact_lock');expect(definition).toContain('skip locked')
 await db.query("update public.initial_import_jobs set status='completed',locked_by=null,lease_until=null where id=$1",[first[0].id])
 expect(await claim('b')).toHaveLength(1)
})
it('immediately wakes a continuation with its saved identity, including when no browser is connected',async()=>{
 const j=await enqueue();await claim();expect(await mark(j.id,'provider_start')).toBe(true);expect(await checkpoint(j.id)).toBe(true)
 await db.query("update public.initial_import_jobs set wake_requested_at=clock_timestamp()-interval '2 seconds' where id=$1",[j.id])
 expect((await db.query("select public.continue_initial_import_job($1,'worker',0) ok",[j.id])).rows[0].ok).toBe(true)
 const next=await claim('next');expect(next).toHaveLength(1);expect(next[0].provider_run_id).toBe('run');expect(next[0].provider_dataset_id).toBe('dataset')
 expect((await db.query('select wake_count from public.initial_import_jobs where id=$1',[j.id])).rows[0].wake_count).toBe(2)
})
it('records server phases and native finish separately without creating a second start reservation',async()=>{
 const j=await enqueue();await claim();await mark(j.id,'worker_started');expect(await mark(j.id,'provider_start')).toBe(true);expect(await mark(j.id,'provider_start')).toBe(false)
 expect(await checkpoint(j.id)).toBe(true);const native='2026-10-25T10:00:11Z';await mark(j.id,'provider_finished','worker',native,'SUCCEEDED')
 for(const phase of ['retrieval_started','retrieval_completed','persistence_started','persistence_completed'])await mark(j.id,phase)
 const row=(await db.query('select * from public.initial_import_jobs where id=$1',[j.id])).rows[0]
 for(const k of ['worker_started_at','provider_start_attempted_at','provider_run_saved_at','provider_finished_observed_at','retrieval_started_at','retrieval_completed_at','persistence_started_at','persistence_completed_at'])expect(row[k]).not.toBeNull()
 expect(new Date(row.provider_finished_at as string).toISOString()).toBe('2026-10-25T10:00:11.000Z');expect(row.provider_requests).toBe(1)
 expect(await checkpoint(j.id,'other')).toBe(false)
})
it('blocks an unknown start after a lost lease and refuses automatic or manual reissue',async()=>{
 const j=await enqueue();await claim();await mark(j.id,'provider_start')
 await db.query("update public.initial_import_jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1",[j.id])
 expect(await claim('cron')).toHaveLength(0)
 const row=(await db.query('select * from public.initial_import_jobs where id=$1',[j.id])).rows[0];expect(row.status).toBe('failed');expect(row.error_code).toBe('APIFY_START_OUTCOME_UNKNOWN')
 await db.exec(`set local role authenticated;select set_config('request.jwt.claim.sub','${user}',true);savepoint denied`)
 await expect(db.query('select public.retry_initial_import_job($1)',[j.id])).rejects.toThrow('APIFY_START_OUTCOME_UNKNOWN');await db.exec('rollback to savepoint denied')
})
it('keeps a known run after read or persistence errors; retry preserves the 150 target and cannot silently reset it',async()=>{
 const j=await enqueue();await claim();await mark(j.id,'provider_start');await checkpoint(j.id)
 await db.query("select public.fail_initial_import_job($1,'worker','APIFY_TIMEOUT',false,5,60,false)",[j.id])
 await db.exec(`set local role authenticated;select set_config('request.jwt.claim.sub','${user}',true)`)
 const row=(await db.query('select * from public.retry_initial_import_job($1)',[j.id])).rows[0]
 expect(row.provider_run_id).toBe('run');expect(row.provider_dataset_id).toBe('dataset');expect(row.reviews_target).toBe(150)
})
it('requires an observed native terminal failure before manual retry can reserve a new run',async()=>{
 const j=await enqueue();await claim();await mark(j.id,'provider_start');await checkpoint(j.id);await mark(j.id,'provider_finished','worker',undefined,'FAILED')
 await db.query("select public.fail_initial_import_job($1,'worker','APIFY_RUN_FAILED',true,5,60,true)",[j.id])
 expect((await db.query('select status,provider_run_id from public.initial_import_jobs where id=$1',[j.id])).rows[0]).toEqual({status:'failed',provider_run_id:'run'})
 await db.exec(`set local role authenticated;select set_config('request.jwt.claim.sub','${user}',true)`)
 const row=(await db.query('select * from public.retry_initial_import_job($1)',[j.id])).rows[0]
 expect(row.provider_run_id).toBeNull();expect(row.provider_start_attempted_at).toBeNull();expect(row.provider_attempt_history).toEqual([expect.objectContaining({run_id:'run',status:'FAILED'})])
})
it('keeps a failed wake durable for cron recovery and does not expose scheduler credentials to callers',async()=>{
 await db.exec("create or replace function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 1000) returns bigint language plpgsql as $$begin raise exception 'secret must not be logged';end$$")
 const j=await enqueue();expect((await db.query('select wake_error,status from public.initial_import_jobs where id=$1',[j.id])).rows[0]).toEqual({wake_error:'INITIAL_IMPORT_WAKE_FAILED_CRON_RECOVERY',status:'queued'})
 expect(await claim('cron')).toHaveLength(1)
 await db.exec('set local role authenticated;savepoint denied');await expect(db.query('select public.wake_initial_import_queue($1)',[j.id])).rejects.toThrow('permission denied');await db.exec('rollback to savepoint denied')
 await expect(db.query("select public.mark_initial_import_phase($1,'worker','provider_start')",[j.id])).rejects.toThrow('permission denied')
})
it('cannot mutate a retired/deleted job or checkpoint with an expired lease',async()=>{
 expect(await mark(crypto.randomUUID(),'provider_start')).toBe(false)
 const j=await enqueue();await claim();await db.query("update public.initial_import_jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1",[j.id])
 expect(await mark(j.id,'provider_start')).toBe(false);expect(await checkpoint(j.id)).toBe(false)
})
