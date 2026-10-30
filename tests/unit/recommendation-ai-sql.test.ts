// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,it,expect} from 'vitest';
let db:PGlite;const org='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
const migration=readFileSync('supabase/migrations/20261030042203_private_recommendation_ai_comparison.sql','utf8');
beforeAll(async()=>{db=new PGlite();await db.waitReady;await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;create role service_role bypassrls;
 create table public.organizations(id uuid primary key);create table auth.users(id uuid primary key);create table public.organization_members(organization_id uuid,user_id uuid,role text);
 grant select on public.organization_members to service_role;insert into public.organizations values('${org}');insert into auth.users values('${user}');insert into public.organization_members values('${org}','${user}','manager');`);await db.exec(migration);},60000);
afterAll(()=>db.close());
const reserve=async(key:string)=>((await db.query<{a:{id:string;owned:boolean;state:string;selection:unknown}}>('select public.reserve_recommendation_ai_v1($1,$2,$3,$4) a',[org,user,key.repeat(64),'f'.repeat(64)])).rows[0].a);
it('keeps private table/RPC inaccessible to anon and authenticated and grants only the server',async()=>{
 for(const role of ['anon','authenticated']){
  expect((await db.query<{v:boolean}>('select has_table_privilege($1,$2,$3) v',[role,'private.recommendation_ai_attempts','SELECT'])).rows[0].v).toBe(false);
  expect((await db.query<{v:boolean}>('select has_function_privilege($1,$2,$3) v',[role,'public.reserve_recommendation_ai_v1(uuid,uuid,text,text)','EXECUTE'])).rows[0].v).toBe(false);
 }
 expect((await db.query<{v:boolean}>(`select relrowsecurity v from pg_class where oid='private.recommendation_ai_attempts'::regclass`)).rows[0].v).toBe(true);
});
it('reserves atomically once, joins same or concurrent work, saves once and reuses without a new attempt',async()=>{
 await db.exec('set role service_role');const a=await reserve('a');expect(a.owned).toBe(true);expect((await reserve('a')).owned).toBe(false);
 const b=await reserve('b');expect(b).toMatchObject({owned:false,state:'dispatched'});
 const finish=()=>db.query<{v:boolean}>('select public.finish_recommendation_ai_v1($1,$2,$3,$4,$5) v',[a.id,'succeeded',JSON.stringify([{id:'fixture',reason_refs:['score_global'],caution_ref:null}]),JSON.stringify({input_tokens:12}),null]);
 expect((await finish()).rows[0].v).toBe(true);expect((await finish()).rows[0].v).toBe(false);
 expect(await reserve('a')).toMatchObject({id:a.id,owned:false,state:'succeeded'});await db.exec('reset role');
});
it('never retries an abandoned/unknown key and rejects missing organization rights',async()=>{
 const a=await reserve('c');await db.query(`update private.recommendation_ai_attempts set created_at=clock_timestamp()-interval '3 minutes' where id=$1`,[a.id]);
 expect(await reserve('c')).toMatchObject({owned:false,state:'unknown',id:a.id});
 await expect(db.query('select public.reserve_recommendation_ai_v1($1,$2,$3,$4)',[org,'33333333-3333-4333-8333-333333333333','d'.repeat(64),'f'.repeat(64)])).rejects.toThrow('FORBIDDEN');
 const names=(await db.query<{column_name:string}>(`select column_name from information_schema.columns where table_schema='private' and table_name='recommendation_ai_attempts'`)).rows.map(r=>r.column_name);
 expect(names).not.toContain('request_text');expect(names).not.toContain('raw_response');
});
