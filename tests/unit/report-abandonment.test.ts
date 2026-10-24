// @vitest-environment node
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,beforeEach,afterAll,afterEach,it,expect,vi} from 'vitest';
const org='00000000-0000-4000-8000-000000000001',est='00000000-0000-4000-8000-000000000002',actor='00000000-0000-4000-8000-000000000003';
const request='00000000-0000-4000-8000-000000000004',next='00000000-0000-4000-8000-000000000005',source='00000000-0000-4000-8000-000000000006',report='00000000-0000-4000-8000-000000000007',batch='00000000-0000-4000-8000-000000000008';
let db:PGlite,network:ReturnType<typeof vi.spyOn>;
async function abandon(user=actor,ack=true){return (await db.query<{result:{abandoned:boolean;provider_calls:number}}>('select public.abandon_current_report_request($1::uuid,$2::uuid,$3) result',[request,user,ack])).rows[0].result;}
async function enqueue(id=next){return (await db.query<{id:string;snapshot:unknown;ai_calls?:number}>("select * from public.enqueue_current_report($1::uuid,$2::uuid,$3::uuid,'vi',$4::uuid,'gpt-6.1-sol',7)",[est,org,actor,id])).rows[0];}
async function unchanged(){return (await db.query('select to_jsonb(t) row from public.analysis_jev_batch_tasks t order by status')).rows;}
async function rejected(fn:()=>Promise<unknown>,message:string){await db.exec('savepoint rejection');await expect(fn()).rejects.toThrow(message);await db.exec('rollback to savepoint rejection');}
beforeAll(async()=>{
 network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NO_NETWORK_ALLOWED'));db=new PGlite();await db.waitReady;
 await db.exec(readFileSync('tests/fixtures/current-batch-queue-before.sql','utf8'));
 await db.exec(`
 create schema auth;create table auth.users(id uuid primary key);create table public.organizations(id uuid primary key);
 alter role service_role bypassrls;
 alter default privileges in schema public grant all on tables to service_role;
 alter table public.analysis_jev_batch_runs add column armed boolean default false;
 alter table public.analysis_parallel_reports add column state text default 'blocked';
 alter table public.analysis_jev_batch_tasks add column lease_until timestamptz;
 grant all on public.organizations,auth.users to service_role;grant usage on schema auth to service_role;
 `);
 await db.exec(readFileSync('supabase/migrations/20261024130430_wake_current_batch_initial_queue.sql','utf8'));
 const migration=readdirSync('supabase/migrations').find(n=>n.endsWith('_abandon_failed_current_report.sql'))!;
 await db.exec(readFileSync('supabase/migrations/'+migration,'utf8'));
 const privilegeMigration=readdirSync('supabase/migrations').find(n=>n.endsWith('_restrict_report_abandonment_service_privileges.sql'))!;
 await db.exec(readFileSync('supabase/migrations/'+privilegeMigration,'utf8'));
},30000);
beforeEach(async()=>{
 await db.exec('begin;set local role service_role');
 await db.query('insert into public.organizations values($1)',[org]);await db.query('insert into auth.users values($1)',[actor]);
 await db.query('insert into public.establishments values($1,$2,true)',[est,org]);await db.query("insert into public.organization_members values($1,$2,'owner')",[org,actor]);
 await db.exec("insert into public.report_pipeline_settings values(true,'jev_sol_v2','batch_initial_v1')");
 await db.query("insert into public.historical_report_runs(id,organization_id,establishment_id,language,requested_by,status,snapshot,model) values($1,$2,$3,'vi',$4,'failed',$5::jsonb,'gpt-6.1-sol')",[source,org,est,actor,JSON.stringify({reviews:[{saved_source:'unchanged'}],classifications:[{saved_result:'unused'}]})]);
 await db.query("insert into public.report_generation_requests(id,organization_id,establishment_id,authority_user_id,language,engine,source_run_id,comparison_id,jev_transport) values($1,$2,$3,$4,'vi','jev_sol_v2',$5,$6,'batch_initial_v1')",[request,org,est,actor,source,report]);
 await db.exec('delete from public.test_dispatch');
 await db.query("insert into public.analysis_parallel_reports values($1,null,$2,$3,'vi','blocked')",[report,org,est]);
 await db.query("insert into public.analysis_jev_batch_runs values($1,$2,$3,'blocked',false)",[batch,report,source]);
 await db.query("insert into public.analysis_jev_batch_tasks values($1,'unknown',1,null,null),($1,'completed',1,'{\"native\":\"saved\"}',null)",[batch]);
});
afterEach(async()=>{await db.exec('rollback');expect(network).not.toHaveBeenCalled();});afterAll(async()=>{await db.close();network.mockRestore();});
it('keeps the existing unknown-outcome guard until an explicit acknowledged abandonment',async()=>{
 await rejected(()=>enqueue(),'REPORT_PREVIOUS_OUTCOME_UNCERTAIN');
 await rejected(()=>abandon(actor,false),'REPORT_RESTART_ACK_REQUIRED');
 expect((await db.query('select * from public.report_generation_abandonments')).rows).toEqual([]);
});
it('abandons idempotently without deleting a paid attempt, resetting unknown outcomes, or scheduling work',async()=>{
 const before=await unchanged();expect(await abandon()).toMatchObject({abandoned:true,provider_calls:0});await abandon();
 expect(await unchanged()).toEqual(before);
 expect((await db.query('select count(*)::int n from public.report_generation_abandonments')).rows).toEqual([{n:1}]);
 expect((await db.query('select * from public.test_dispatch')).rows).toEqual([]);
 expect((await db.query('select status,snapshot from public.historical_report_runs')).rows).toEqual([{status:'failed',snapshot:{reviews:[{saved_source:'unchanged'}],classifications:[{saved_result:'unused'}]}}]);
});
it('a later explicit new request starts from an empty fresh snapshot and retains intent idempotency',async()=>{
 await abandon();const old=await unchanged(),fresh=await enqueue(),duplicate=await enqueue();
 expect(fresh.id).not.toBe(source);expect(duplicate.id).toBe(fresh.id);
 expect(fresh.snapshot).not.toHaveProperty('reviews');expect(fresh.snapshot).not.toHaveProperty('classifications');
 expect(await unchanged()).toEqual(old);
 expect((await db.query('select count(*)::int n from public.test_dispatch')).rows).toEqual([{n:1}]);
 await rejected(()=>enqueue(request),'REPORT_REQUEST_ABANDONED_NEW_ID_REQUIRED');
});
it.each(['running','completed'])('refuses abandonment of a %s source',async status=>{
 await db.query('update public.historical_report_runs set status=$1',[status]);
 await rejected(()=>abandon(),'REPORT_ABANDON_NOT_ALLOWED');
});
it('refuses active batch work and completed reports',async()=>{
 await db.exec("update public.analysis_jev_batch_runs set armed=true,status='running'");
 await rejected(()=>abandon(),'REPORT_ABANDON_NOT_ALLOWED');
 await db.exec("update public.analysis_jev_batch_runs set armed=false,status='blocked';update public.analysis_parallel_reports set state='completed'");
 await rejected(()=>abandon(),'REPORT_ABANDON_NOT_ALLOWED');
});
it('refuses a user outside the organization and retains an immutable service-only audit',async()=>{
 await rejected(()=>abandon(next),'FORBIDDEN');await abandon();
 await rejected(()=>db.exec("update public.report_generation_abandonments set reason='restart_from_zero'"),'permission denied');
 await db.exec('reset role');
 await rejected(()=>db.exec("update public.report_generation_abandonments set reason='restart_from_zero'"),'REPORT_ABANDONMENT_IMMUTABLE');
 await db.exec('set local role service_role');
 expect((await db.query("select has_table_privilege('authenticated','public.report_generation_abandonments','SELECT') read,has_function_privilege('authenticated','public.abandon_current_report_request(uuid,uuid,boolean)','execute') call")).rows).toEqual([{read:false,call:false}]);
});
it('acknowledging one failed request does not bypass another unacknowledged unknown attempt',async()=>{
 await abandon();
 await db.exec("insert into public.historical_report_runs(id,organization_id,establishment_id,language,status) select '10000000-0000-4000-8000-000000000006',organization_id,establishment_id,language,'failed' from public.historical_report_runs");
 await db.exec("insert into public.analysis_parallel_reports select '10000000-0000-4000-8000-000000000007',run_id,organization_id,establishment_id,language,state from public.analysis_parallel_reports");
 await db.exec("insert into public.analysis_jev_batch_runs values('10000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000006','blocked',false)");
 await db.exec("insert into public.analysis_jev_batch_tasks values('10000000-0000-4000-8000-000000000008','unknown',1,null,null)");
 await rejected(()=>enqueue(),'REPORT_PREVIOUS_OUTCOME_UNCERTAIN');
});

