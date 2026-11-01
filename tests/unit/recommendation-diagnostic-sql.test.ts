// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,afterEach,it,expect} from 'vitest';
let db:PGlite;
const org='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',user='33333333-3333-4333-8333-333333333333',attempt='44444444-4444-4444-8444-444444444444';
beforeAll(async()=>{db=new PGlite();await db.waitReady;await db.exec(`create schema private;create schema auth;create role anon;create role authenticated;create role service_role bypassrls;
 create table public.organizations(id uuid primary key);create table auth.users(id uuid primary key);create table public.organization_members(organization_id uuid,user_id uuid,role text);
 insert into public.organizations values('${org}'),('${other}');insert into auth.users values('${user}');insert into public.organization_members values('${org}','${user}','admin'),('${other}','${user}','manager');grant select on public.organization_members to service_role;`);
 await db.exec(readFileSync('supabase/migrations/20261030042203_private_recommendation_ai_comparison.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261101051021_recommendation_private_diagnostics_v2.sql','utf8'));
 await db.query(`insert into private.recommendation_ai_attempts(id,organization_id,user_id,cache_key,request_sha256,state,metrics,error_code) values($1,$2,$3,$4,$5,'invalid_output','{"input_tokens":123}','INVALID_REFERENCE')`,[attempt,org,user,'a'.repeat(64),'b'.repeat(64)]);
},60000);
afterEach(()=>db.exec('reset role'));afterAll(()=>db.close());
const trace=(id:string|null=attempt)=>({version:'recommendation-diagnostic-v2',attempt_id:id,origin:'fallback',candidate_ids:[],selected_candidate_ids:[],failure:null});
const record=(organization=org,id:string|null=attempt,value:unknown=trace(id))=>db.query('select public.record_recommendation_diagnostic_v1($1,$2,$3,$4) id',[organization,user,id,JSON.stringify(value)]);
it('keeps diagnostics and both RPCs server-only with RLS and invoker security',async()=>{
 for(const role of ['anon','authenticated'])for(const sig of ['public.record_recommendation_diagnostic_v1(uuid,uuid,uuid,jsonb)','public.prune_recommendation_diagnostics_v1(uuid,integer)'])expect((await db.query<{v:boolean}>('select has_function_privilege($1,$2,\'EXECUTE\') v',[role,sig])).rows[0].v).toBe(false);
 for(const role of ['anon','authenticated'])expect((await db.query<{v:boolean}>('select has_table_privilege($1,\'private.recommendation_ai_diagnostics\',\'SELECT\') v',[role])).rows[0].v).toBe(false);
 expect((await db.query<{v:boolean}>(`select relrowsecurity v from pg_class where oid='private.recommendation_ai_diagnostics'::regclass`)).rows[0].v).toBe(true);
 expect((await db.query<{v:boolean}>(`select bool_or(prosecdef) v from pg_proc where proname in('record_recommendation_diagnostic_v1','prune_recommendation_diagnostics_v1')`)).rows[0].v).toBe(false);
});
it('writes a separate cache/fallback observation without changing the consumed historical receipt',async()=>{
 const before=(await db.query('select to_jsonb(a) value from private.recommendation_ai_attempts a')).rows;
 await db.exec('set role service_role');await record();await record(org,attempt,{...trace(),origin:'cache'});await db.exec('reset role');
 expect((await db.query('select to_jsonb(a) value from private.recommendation_ai_attempts a')).rows).toEqual(before);
 expect((await db.query<{n:number}>('select count(*)::int n from private.recommendation_ai_diagnostics')).rows[0].n).toBe(2);
 await db.exec('set role service_role');await expect(record(other)).rejects.toThrow('FOREIGN_ATTEMPT');
});
it('bounds the sidecar to the latest 100 per organization and preserves another organization',async()=>{
 await db.exec('set role service_role');await record(other,null,trace(null));for(let i=0;i<105;i++)await record();await db.exec('reset role');
 expect((await db.query<{n:number}>('select count(*)::int n from private.recommendation_ai_diagnostics where organization_id=$1',[org])).rows[0].n).toBe(100);
 expect((await db.query<{n:number}>('select count(*)::int n from private.recommendation_ai_diagnostics where organization_id=$1',[other])).rows[0].n).toBe(1);
});
it('purges expired traces on access, preserving receipts, unknown outcomes and other organizations',async()=>{
 await db.exec(`update private.recommendation_ai_diagnostics set created_at=created_at-interval '8 days',expires_at=expires_at-interval '8 days' where organization_id='${org}'`);
 await db.exec('set role service_role');expect((await db.query<{n:number}>('select public.prune_recommendation_diagnostics_v1($1) n',[org])).rows[0].n).toBe(100);await db.exec('reset role');
 expect((await db.query<{n:number}>('select count(*)::int n from private.recommendation_ai_attempts')).rows[0].n).toBe(1);
 expect((await db.query<{n:number}>('select count(*)::int n from private.recommendation_ai_diagnostics where organization_id=$1',[other])).rows[0].n).toBe(1);
});
it('rejects extra content fields, oversized diagnostics and foreign membership',async()=>{
 await db.exec('set role service_role');await expect(record(org,attempt,{...trace(),user_text:'DO_NOT_STORE'})).rejects.toThrow('INVALID_DIAGNOSTIC');
 await expect(record(org,attempt,{...trace(),stage:'x'.repeat(17000)})).rejects.toThrow('INVALID_DIAGNOSTIC');
 await expect(db.query('select public.record_recommendation_diagnostic_v1($1,$2,$3,$4)',[org,'55555555-5555-4555-8555-555555555555',attempt,JSON.stringify(trace())])).rejects.toThrow('FORBIDDEN');
});
