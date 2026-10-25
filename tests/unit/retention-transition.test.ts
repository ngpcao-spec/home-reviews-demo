// @vitest-environment node
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
let db:PGlite;
beforeAll(async()=>{
 db=new PGlite();await db.waitReady;
 const sql=readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith('_recent_text_retention_transition.sql')),'utf8');
 const names=[...sql.match(/foreach t in array array\[([\s\S]*?)\] loop/)![1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema private;create schema cron;create table cron.job(jobid bigint,jobname text,active boolean);insert into cron.job values(1,'worker',true);create function cron.alter_job(bigint,active boolean) returns void language sql as $$update cron.job set active=$2 where jobid=$1$$;`);
 for(const name of names)await db.exec('create table '+name+'(id uuid default gen_random_uuid());grant all on '+name+' to service_role');
 await db.exec(sql);
},30000);
beforeEach(()=>db.exec('begin'));
afterEach(()=>db.exec('rollback'));
afterAll(()=>db.close());
it('pauses existing cron workers without deleting their configuration',async()=>{
 expect((await db.query('select active from cron.job')).rows).toEqual([{active:false}]);
 expect((await db.query('select was_active from private.retention_cron_restore')).rows).toEqual([{was_active:true}]);
});
it.each(['public.reviews','public.report_generation_requests','public.analysis_jev_batch_tasks'])('blocks writes into %s during transition',async name=>{
 await db.exec('set local role service_role');await expect(db.exec('insert into '+name+' default values')).rejects.toThrow('RETENTION_TRANSITION_ACTIVE');
});
it('does not let the server role bypass the barrier with a user setting',async()=>{
 await db.exec("set local role service_role;select set_config('home.retention_maintenance','on',true)");
 await expect(db.exec('insert into public.reviews default values')).rejects.toThrow('RETENTION_TRANSITION_ACTIVE');
});
it('allows explicitly scoped administrator maintenance',async()=>{
 await db.exec("select set_config('home.retention_maintenance','on',true);insert into public.reviews default values");
 expect((await db.query('select count(*)::int n from public.reviews')).rows).toEqual([{n:1}]);
});
it('keeps retired pipelines blocked after activation while allowing current writes',async()=>{
 await db.exec("update public.review_corpus_policy set paused=false,enabled=true,retired_relations=array['public.analysis_jev_pilot_jobs'];set local role service_role;insert into public.reviews default values");
 await expect(db.exec('insert into public.analysis_jev_pilot_jobs default values')).rejects.toThrow('REPORT_PIPELINE_RETIRED');
});
