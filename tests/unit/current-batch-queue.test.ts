// @vitest-environment node
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';

const org='00000000-0000-4000-8000-000000000001',est='00000000-0000-4000-8000-000000000002';
const actor='00000000-0000-4000-8000-000000000003',intent='00000000-0000-4000-8000-000000000004';
const other='00000000-0000-4000-8000-000000000005',worker='00000000-0000-4000-8000-000000000006';
const report='00000000-0000-4000-8000-000000000007',batch='00000000-0000-4000-8000-000000000008';
let db:PGlite,network:ReturnType<typeof vi.spyOn>,before:{proname:string;definition:string}[],beforeWakeCount:number;
const migration=readdirSync('supabase/migrations').find(n=>n.endsWith('_wake_current_batch_initial_queue.sql'))!;
async function seed(){
 await db.exec('begin;set local role service_role');
 await db.query('insert into public.establishments values($1,$2,true)',[est,org]);
 await db.query("insert into public.organization_members values($1,$2,'owner')",[org,actor]);
 await db.exec("insert into public.report_pipeline_settings values(true,'jev_sol_v2','batch_initial_v1')");
}
async function enqueue(request=intent){
 const r=await db.query<{id:string;status:string;snapshot:unknown;attempt_count:number}>(
  "select id,status,snapshot,attempt_count from public.enqueue_current_report($1::uuid,$2::uuid,$3::uuid,'vi',$4::uuid,'gpt-6.1-sol',7)",[est,org,actor,request]);
 return r.rows[0];
}
async function countWakes(){return (await db.query<{n:number}>('select count(*)::int n from public.test_dispatch')).rows[0].n;}
async function definitions(){return (await db.query<{proname:string;definition:string}>(
 "select proname,pg_get_functiondef(oid) as definition from pg_proc where proname in('enqueue_current_report','claim_historical_report_jobs') order by proname")).rows;}
async function claim(w=worker){return (await db.query<{id:string}>('select id from public.claim_historical_report_jobs($1::uuid,2)',[w])).rows;}

beforeAll(async()=>{
 network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN'));
 db=new PGlite();await db.waitReady;
 await db.exec(readFileSync('tests/fixtures/current-batch-queue-before.sql','utf8'));
 before=await definitions();
 // Reproduce the observed missing initial wake with the saved production code.
 await seed();await enqueue();beforeWakeCount=await countWakes();await db.exec('rollback');
 await db.exec(readFileSync('supabase/migrations/'+migration,'utf8'));
},30000);
beforeEach(async()=>{await seed();});
afterEach(async()=>{await db.exec('rollback');expect(network).not.toHaveBeenCalled();});
afterAll(async()=>{await db.close();network.mockRestore();});

describe('initial current batch queue, real local PostgreSQL with an inert outbox',()=>{
 it('reproduces the old cron-only enqueue and leaves enqueue/claim protections byte-for-byte unchanged',async()=>{
  expect(beforeWakeCount).toBe(0);expect(await definitions()).toEqual(before);
 });
 it('schedules the first source preparation immediately, before any snapshot or native task exists',async()=>{
  const r=await enqueue();expect(r).toMatchObject({status:'queued',attempt_count:0});
  expect(r.snapshot).not.toHaveProperty('base');expect(r.snapshot).not.toHaveProperty('reviews');
  expect(await countWakes()).toBe(1);
  expect((await db.query('select url,body,timeout_ms from public.test_dispatch')).rows).toEqual([{
   url:'https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-historical-report-jobs',body:{},timeout_ms:180000}]);
  expect((await db.query('select * from public.analysis_jev_batch_tasks')).rows).toHaveLength(0);
 });
 it('a repeated intent and a second click reuse one source and schedule no duplicate initial wake',async()=>{
  const a=await enqueue(),b=await enqueue(),c=await enqueue(other);
  expect(b.id).toBe(a.id);expect(c.id).toBe(a.id);expect(await countWakes()).toBe(1);
  expect((await db.query('select * from public.report_generation_requests')).rows).toHaveLength(1);
 });
 it('overlapping immediate and cron wakes cannot claim the same unexpired source twice',async()=>{
  const r=await enqueue();expect(await claim()).toEqual([{id:r.id}]);expect(await claim(other)).toEqual([]);
  expect((await db.query('select attempt_count from public.historical_report_runs')).rows).toEqual([{attempt_count:1}]);
  expect((await db.query('select public.wake_current_jev_preparation($1::uuid) as id',[r.id])).rows[0]).toEqual({id:null});
  expect(await countWakes()).toBe(1);
 });
 it('still immediately continues the saved snapshot, and binding its batch report prevents source reclaims',async()=>{
  const r=await enqueue();await claim();
  await db.query('update public.historical_report_runs set snapshot=$2::jsonb,locked_by=null,lease_until=null,attempt_count=0 where id=$1::uuid',
   [r.id,JSON.stringify({base:{},reviews:[]})]);
  expect((await db.query('select public.wake_current_jev_preparation($1::uuid) as id',[r.id])).rows[0]).not.toEqual({id:null});
  expect(await countWakes()).toBe(2);
  await db.query('update public.report_generation_requests set comparison_id=$1::uuid',[report]);
  expect(await claim(other)).toEqual([]);
  expect((await db.query('select public.wake_current_jev_preparation($1::uuid) as id',[r.id])).rows[0]).toEqual({id:null});
  expect(await countWakes()).toBe(2);
 });
 it('keeps the durable request available for cron recovery when initial wake scheduling fails',async()=>{
  await db.exec("select set_config('home_reviews.test_wake_failure','true',true)");
  const r=await enqueue();expect(r.status).toBe('queued');expect(await countWakes()).toBe(0);
  expect(await claim()).toEqual([{id:r.id}]);
 });
 it('a transaction rollback also cancels its queued initial wake',async()=>{
  await db.exec('savepoint before_enqueue');await enqueue();expect(await countWakes()).toBe(1);
  await db.exec('rollback to savepoint before_enqueue');
  expect(await countWakes()).toBe(0);expect((await db.query('select * from public.report_generation_requests')).rows).toEqual([]);
 });
 it('does not change the retained individual transport',async()=>{
  await db.exec("update public.report_pipeline_settings set jev_transport='individual'");
  await enqueue();expect(await countWakes()).toBe(0);
 });
 it.each([
  "status='completed'",
  "status='failed'",
  "lease_until=now()+interval '1 minute'",
  "next_retry_at=now()+interval '1 minute'",
  "created_at=now()-interval '25 hours'",
  "started_at=now(),attempt_count=1",
 ])('does not wake a source that is no longer ready: %s',async(change)=>{
  const r=await enqueue();await db.exec('delete from public.test_dispatch');
  await db.exec('update public.historical_report_runs set '+change);
  expect((await db.query('select public.wake_current_jev_preparation($1::uuid) as id',[r.id])).rows[0]).toEqual({id:null});
  expect(await countWakes()).toBe(0);
 });
 it.each(['completed','unknown'])('preserves consumed native attempts and receipts: %s',async(status)=>{
  const r=await enqueue();await db.exec("delete from public.test_dispatch;update public.historical_report_runs set status='completed'");
  await db.query('update public.report_generation_requests set comparison_id=$1::uuid',[report]);
  await db.query("insert into public.analysis_parallel_reports values($1,null,$2,$3,'vi')",[report,org,est]);
  await db.query('insert into public.analysis_jev_batch_runs values($1,$2,$3,$4)',[batch,report,r.id,status==='unknown'?'blocked':'completed']);
  await db.query('insert into public.analysis_jev_batch_tasks values($1,$2,1,$3::jsonb)',[batch,status,status==='unknown'?null:JSON.stringify({saved:true})]);
  const tasks=(await db.query('select * from public.analysis_jev_batch_tasks')).rows;
  expect((await db.query('select public.wake_current_jev_preparation($1::uuid) as id',[r.id])).rows[0]).toEqual({id:null});
  expect(await claim()).toEqual([]);
  expect((await db.query('select * from public.analysis_jev_batch_tasks')).rows).toEqual(tasks);
  expect(await countWakes()).toBe(0);
  if(status==='unknown')await expect(enqueue(other)).rejects.toThrow('REPORT_PREVIOUS_OUTCOME_UNCERTAIN');
 });
 it('does not bypass an unknown consumed Sol outcome at enqueue',async()=>{
  const r=await enqueue();await db.exec("delete from public.test_dispatch;update public.historical_report_runs set status='completed'");
  await db.query("insert into public.analysis_parallel_reports values($1,$2,$3,$4,'vi')",[report,other,org,est]);
  await db.query("insert into public.analysis_jls_sol_ready_operations values($1,1,'billing_uncertain',null)",[other]);
  await db.exec('savepoint before_rejected_enqueue');
  await expect(enqueue(other)).rejects.toThrow('REPORT_PREVIOUS_OUTCOME_UNCERTAIN');
  await db.exec('rollback to savepoint before_rejected_enqueue');
  expect(await countWakes()).toBe(0);expect((await db.query('select id from public.historical_report_runs')).rows).toEqual([{id:r.id}]);
 });
 it('retains private invoker functions and no browser privilege to dispatch',async()=>{
  expect((await db.query("select has_function_privilege('authenticated','public.wake_current_jev_preparation(uuid)','execute') as wake,has_function_privilege('anon','public.wake_new_current_batch_request()','execute') as trigger")).rows).toEqual([{wake:false,trigger:false}]);
 });
});
