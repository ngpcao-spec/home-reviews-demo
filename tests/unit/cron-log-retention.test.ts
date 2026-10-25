// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
let db:PGlite;
const migration=(suffix:string)=>readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith(suffix)),'utf8');
const install=()=>db.exec(migration('_schedule_cron_log_retention.sql'));
beforeAll(async()=>{
 db=new PGlite();await db.waitReady;
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema private;create schema cron;
 create table cron.job_run_details(runid bigint primary key,jobid bigint,status text,start_time timestamptz,end_time timestamptz);
 create table cron.job(jobid bigint generated always as identity primary key,jobname text unique,schedule text,command text,username text default current_user,database text default current_database(),active boolean default true);
 create function cron.schedule(text,text,text) returns bigint language plpgsql as $$declare v bigint;begin insert into cron.job(jobname,schedule,command)values($1,$2,$3)on conflict(jobname)do update set schedule=excluded.schedule,command=excluded.command returning jobid into v;return v;end$$;
 create table public.fixture_protected_report(id int primary key,body text);insert into public.fixture_protected_report values(1,'unchanged');
 insert into cron.job(jobname,schedule,command,active)values('existing-active','* * * * *','select 1',true),('existing-inactive','* * * * *','select 2',false);`);
 await db.exec(migration('_bounded_cron_log_retention.sql'));
 await db.exec(migration('_bound_cron_retention_lookup.sql'));
 await db.exec(migration('_optimize_sparse_cron_log_scan.sql'));
},30000);
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));afterAll(()=>db.close());
const purge=async(batch=10000)=>(await db.query('select private.purge_cron_job_run_details($1) r',[batch])).rows[0].r as {deleted:number;eligible_remaining:number;old_unfinished_preserved:number;unfinished_preserved:number};
it('expires completed successes at 7 days and failures at 30 days using their end, not their start',async()=>{
 await db.exec(`insert into cron.job_run_details values
 (1,1,'succeeded',now()-interval '9 days',now()-interval '8 days'),(2,1,'succeeded',now()-interval '10 days',now()-interval '6 days'),
 (3,1,'failed',now()-interval '40 days',now()-interval '31 days'),(4,1,'failed',now()-interval '40 days',now()-interval '29 days');`);
 expect((await purge()).deleted).toBe(2);expect((await db.query('select runid::int id from cron.job_run_details order by runid')).rows).toEqual([{id:2},{id:4}]);expect((await purge()).deleted).toBe(0);
});
it('enforces independent 95000/5000 caps, stable ties and bounded batches while preserving the newest ends',async()=>{
 await db.exec(`insert into cron.job_run_details select i,1,'succeeded',now()-interval '2 hours',now()-interval '1 hour' from generate_series(1,105007)i;
 insert into cron.job_run_details select 200000+i,1,'failed',now()-interval '2 hours',now()-interval '1 hour' from generate_series(1,5002)i;`);
 const a=await purge(10000);expect(a.deleted).toBe(10000);expect(a.eligible_remaining).toBe(9);
 expect((await purge(4)).deleted).toBe(4);expect((await purge()).deleted).toBe(5);expect((await purge()).deleted).toBe(0);
 expect((await db.query("select status,count(*)::int n,min(runid)::int first from cron.job_run_details group by status order by status")).rows).toEqual([{status:'failed',n:5000,first:200003},{status:'succeeded',n:95000,first:10008}]);
},30000);
it('preserves all unfinished and unknown statuses, even very old or with missing timestamps',async()=>{
 await db.exec(`insert into cron.job_run_details values(1,1,'running',now()-interval '40 days',null),(2,1,'succeeded',now()-interval '40 days',null),(3,1,'failed',now()-interval '40 days',null),(4,1,'unknown',now()-interval '40 days',now()-interval '40 days'),(5,1,null,null,null);`);
 const a=await purge();expect(a.deleted).toBe(0);expect(a.unfinished_preserved).toBe(5);expect(a.old_unfinished_preserved).toBe(4);expect((await db.query('select count(*)::int n from cron.job_run_details')).rows[0].n).toBe(5);
});
it.each([0,-1,10001,null])('rejects an unbounded/invalid batch %s',async size=>{await expect(db.query('select private.purge_cron_job_run_details($1)',[size])).rejects.toThrow('CRON_LOG_BATCH_OUT_OF_RANGE');});
it('installs exactly one hourly job, leaves existing jobs and application rows unchanged, and preserves its schedule on replay',async()=>{
 const before=(await db.query("select to_jsonb(j) j from cron.job j order by jobid")).rows;
 await install();const first=(await db.query("select to_jsonb(j) j from cron.job j where jobname='home-reviews-cron-log-retention-v1'")).rows[0].j;
 await install();expect((await db.query("select to_jsonb(j) j from cron.job j where jobname='home-reviews-cron-log-retention-v1'")).rows[0].j).toEqual(first);
 expect((first as {schedule:string}).schedule).toMatch(/^\d{2} \* \* \* \*$/);
 expect((await db.query("select to_jsonb(j) j from cron.job j where jobname<>'home-reviews-cron-log-retention-v1' order by jobid")).rows).toEqual(before);
 await purge();expect((await db.query('select * from public.fixture_protected_report')).rows).toEqual([{id:1,body:'unchanged'}]);
});
it('refuses a same-name job with a different command rather than overwriting it',async()=>{
 await db.exec("insert into cron.job(jobname,schedule,command) values('home-reviews-cron-log-retention-v1','00 * * * *','select 99')");await expect(install()).rejects.toThrow('CRON_LOG_RETENTION_JOB_CONFLICT');
});
it.each(['anon','authenticated','service_role'])('does not expose maintenance to %s',async role=>{
 await db.exec('grant usage on schema private to '+role+';set local role '+role);await expect(purge()).rejects.toThrow('permission denied');
});
it('keeps the function invoker-only and deletes solely cron history, with concurrency and lock bounds',async()=>{
 const sql=migration('_bounded_cron_log_retention.sql');expect(sql).toContain('security invoker');expect(sql).toContain('pg_try_advisory_xact_lock');expect(sql).toContain('skip locked');expect(sql).toContain("lock_timeout='2s'");expect([...sql.matchAll(/delete from (\S+)/g)].map(m=>m[1])).toEqual(['cron.job_run_details']);
 const d=(await db.query("select pg_get_functiondef('private.purge_cron_job_run_details(integer)'::regprocedure) d")).rows[0].d as string;
 expect(d).toContain('targets as materialized');expect(d).toContain('d.ctid=e.row_tid');expect(d).toContain('order by runid');expect(d).toContain('from log_rows');
});
