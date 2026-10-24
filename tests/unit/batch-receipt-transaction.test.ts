// @vitest-environment node
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,beforeEach,afterAll,afterEach,it,expect,vi} from 'vitest';
const task='00000000-0000-4000-8000-000000000001',run='00000000-0000-4000-8000-000000000002';
const receipt={request_sha256:'wire-sha',raw_response_text:'native response',usage:{input_tokens:17,output_tokens:9},duration_ms:390,http_status:200,served_model:'jev-1.13.0'};
let db:PGlite,network:ReturnType<typeof vi.spyOn>,oldReceiptRolledBack=false;
async function seed(){
 await db.query("insert into public.analysis_jev_batch_runs values($1,$1,true,'running',now()+interval '1 day',now())",[run]);
 await db.query("insert into public.analysis_jev_batch_tasks(id,run_id,status,worker,request_count,request_sha256) values($1,$2,'reserved','worker',1,'wire-sha')",[task,run]);
}
async function sha(){return (await db.query<{sha:string}>('select public.jls_restaurant_hash($1::jsonb) sha',[JSON.stringify(receipt)])).rows[0].sha;}
async function receive(worker='worker',hash?:string){
 return (await db.query<{saved:boolean}>('select public.jev_batch_receive($1::uuid,$2,$3::jsonb,$4) saved',[task,worker,JSON.stringify(receipt),hash??await sha()])).rows[0].saved;
}
beforeAll(async()=>{
 network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN'));
 db=new PGlite();await db.waitReady;
 await db.exec(`
 create role service_role;create role anon;create role authenticated;
 create table public.analysis_jev_batch_runs(id uuid primary key,current_source_run_id uuid,armed boolean,status text,expires_at timestamptz,created_at timestamptz);
 create table public.analysis_jev_batch_tasks(id uuid primary key,run_id uuid,status text,worker text,request_count int,request_sha256 text,
 receipt jsonb,receipt_sha256 text,error_code text,lease_until timestamptz,input_tokens bigint,output_tokens bigint,duration_ms double precision,served_model text,provider_request_id text);
 create function public.jls_restaurant_hash(p jsonb) returns text language sql immutable as 'select md5(p::text)';
 create function public.jev_batch_refresh_usage(p uuid) returns void language plpgsql as $$begin return;end$$;
 create function public.jev_batch_wake(p uuid) returns bigint language plpgsql as $$begin raise exception 'SIMULATED_CONTINUATION_TIMEOUT' using errcode='57014';end$$;
 grant usage on schema public to service_role,anon,authenticated;
 grant all on all tables in schema public to service_role;
 `);
 const original=readFileSync('supabase/migrations/20261024080230_current_jev_batch_transport.sql','utf8')
  .match(/create or replace function public\.jev_batch_receive\([\s\S]*?end \$\$;/)![0];
 await db.exec(original);await db.exec('set role service_role');await seed();
 await expect(receive()).rejects.toThrow('SIMULATED_CONTINUATION_TIMEOUT');
 oldReceiptRolledBack=(await db.query<{receipt:unknown}>('select receipt from public.analysis_jev_batch_tasks')).rows[0].receipt===null;
 await db.exec('reset role;truncate public.analysis_jev_batch_tasks,public.analysis_jev_batch_runs');
 await db.exec(readFileSync('supabase/migrations/20261024142948_commit_batch_receipt_before_continuation.sql','utf8'));
},30000);
beforeEach(async()=>{await db.exec('begin;set local role service_role');await seed();});
afterEach(async()=>{await db.exec('rollback');await db.exec('reset role');await db.exec('truncate public.analysis_jev_batch_tasks,public.analysis_jev_batch_runs');expect(network).not.toHaveBeenCalled();});
afterAll(async()=>{await db.close();network.mockRestore();});
it('reproduces old receipt rollback and commits the new receipt before a continuation timeout',async()=>{
 expect(oldReceiptRolledBack).toBe(true);const hash=await sha();expect(await receive()).toBe(true);
 await db.exec('commit;begin;set local role service_role;savepoint continuation');
 await expect(db.query('select public.jev_batch_continue_received($1::uuid,$2)',[task,hash])).rejects.toThrow('SIMULATED_CONTINUATION_TIMEOUT');
 await db.exec('rollback to savepoint continuation');
 expect((await db.query('select status,request_count,receipt,input_tokens,output_tokens from public.analysis_jev_batch_tasks')).rows)
  .toEqual([{status:'received',request_count:1,receipt,input_tokens:17,output_tokens:9}]);
});
it('retains exact idempotence and never overwrites an existing receipt',async()=>{
 expect(await receive()).toBe(true);expect(await receive()).toBe(true);
 const changed={...receipt,duration_ms:391},hash=(await db.query<{sha:string}>('select public.jls_restaurant_hash($1::jsonb) sha',[JSON.stringify(changed)])).rows[0].sha;
 expect((await db.query('select public.jev_batch_receive($1::uuid,$2,$3::jsonb,$4) saved',[task,'worker',JSON.stringify(changed),hash])).rows).toEqual([{saved:false}]);
 expect((await db.query('select request_count,receipt from public.analysis_jev_batch_tasks')).rows).toEqual([{request_count:1,receipt}]);
});
it('rejects a different worker and permits a late original receipt without resending an unknown attempt',async()=>{
 expect(await receive('other-worker')).toBe(false);
 await db.exec("update public.analysis_jev_batch_tasks set status='unknown'");
 expect(await receive()).toBe(true);
 expect((await db.query('select status,request_count from public.analysis_jev_batch_tasks')).rows).toEqual([{status:'received',request_count:1}]);
});
it('does not continue a missing or differently bound receipt',async()=>{
 expect((await db.query('select public.jev_batch_continue_received($1::uuid,$2) allowed',[task,await sha()])).rows).toEqual([{allowed:false}]);
 expect(await receive()).toBe(true);
 expect((await db.query('select public.jev_batch_continue_received($1::uuid,$2) allowed',[task,'wrong-sha'])).rows).toEqual([{allowed:false}]);
});
it('keeps the continuation RPC private to the service role',async()=>{
 const rows=(await db.query("select has_function_privilege('anon','public.jev_batch_continue_received(uuid,text)','execute') anon,has_function_privilege('authenticated','public.jev_batch_continue_received(uuid,text)','execute') authenticated")).rows;
 expect(rows).toEqual([{anon:false,authenticated:false}]);
});

