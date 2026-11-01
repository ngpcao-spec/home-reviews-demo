// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
let db:PGlite;
const org='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222',parent='33333333-3333-4333-8333-333333333333';
const key='a'.repeat(64),hash='b'.repeat(64);
const trace=(id:string|null=null)=>({version:'recommendation-diagnostic-v2',attempt_id:id,origin:'pending',stage:'reservation',server_version:8,validator_version:'recommendation-criteria-validator-v1',contract_version:'recommendation-criteria-coverage-v1',cache_version:'recommendation-ai-caution-safety-v6'});
type Attempt={id:string|null;owned:boolean;state:string};
beforeAll(async()=>{db=new PGlite();await db.waitReady;await db.exec(`create schema private;create schema auth;create role anon;create role authenticated;create role service_role bypassrls;
 create table public.organizations(id uuid primary key);create table auth.users(id uuid primary key);create table public.organization_members(organization_id uuid,user_id uuid,role text);
 grant select on public.organization_members to service_role;insert into public.organizations values('${org}');insert into auth.users values('${user}');insert into public.organization_members values('${org}','${user}','admin');`);
 for(const name of ['20261030042203_private_recommendation_ai_comparison','20261101051021_recommendation_private_diagnostics_v2','20261101061759_recommendation_single_diagnostic_trial'])await db.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'));
},60000);
beforeEach(async()=>{await db.exec(`reset role;delete from private.recommendation_ai_diagnostics;delete from private.recommendation_diagnostic_trials;delete from private.recommendation_ai_attempts;`);
 await db.query(`insert into private.recommendation_ai_attempts(id,organization_id,user_id,cache_key,request_sha256,state,error_code,metrics,completed_at) values($1,$2,$3,$4,$5,'invalid_output','INVALID_REFERENCE',$6,clock_timestamp())`,[parent,org,user,key,hash,JSON.stringify({model:'gpt-6.1-sol',output_tokens:709,provider_request_id:'saved-receipt',configuration_version:'recommendation-ai-caution-safety-v6'})]);
});
afterAll(()=>db.close());
const arm=async()=>{await db.exec('set role service_role');return (await db.query<{id:string}>('select public.authorize_recommendation_diagnostic_trial_v1($1) id',[parent])).rows[0].id;};
const reserve=async(k=key,h=hash,t=trace())=>(await db.query<{a:Attempt}>('select public.reserve_recommendation_with_diagnostic_v1($1,$2,$3,$4,$5) a',[org,user,k,h,JSON.stringify(t)])).rows[0].a;
const receipt=async()=>(await db.query('select to_jsonb(a) value from private.recommendation_ai_attempts a where id=$1',[parent])).rows[0];
const grant=async()=>(await db.query<{child_attempt_id:string|null;consumed_at:string|null}>('select child_attempt_id,consumed_at from private.recommendation_diagnostic_trials')).rows[0];
const finish=async(id:string,t:unknown)=>db.query<{ok:boolean}>('select public.finish_recommendation_with_diagnostic_v1($1,$2,$3,$4,$5,$6) ok',[id,'invalid_output',null,JSON.stringify({input_tokens:123,output_tokens:12}),'INVALID_REFERENCE',JSON.stringify(t)]);

it('arms idempotently without dispatching, resetting the parent, or changing the ordinary RPCs',async()=>{
 const before=await receipt(),rpcBefore=(await db.query(`select md5(pg_get_functiondef('public.reserve_recommendation_ai_v1(uuid,uuid,text,text)'::regprocedure)) h`)).rows;
 const id=await arm();expect(await arm()).toBe(id);expect(await grant()).toEqual({child_attempt_id:null,consumed_at:null});expect(await receipt()).toEqual(before);
 expect((await db.query('select count(*) n from private.recommendation_ai_attempts')).rows[0]).toEqual({n:1});
 expect((await db.query(`select md5(pg_get_functiondef('public.reserve_recommendation_ai_v1(uuid,uuid,text,text)'::regprocedure)) h`)).rows).toEqual(rpcBefore);
});
it.each(['unknown','dispatched','http_error','obsolete'])('cannot authorize a parent in state %s',async state=>{
 await db.query('update private.recommendation_ai_attempts set state=$1 where id=$2',[state,parent]);await expect(arm()).rejects.toThrow('DIAGNOSTIC_PARENT_NOT_DEFINITIVELY_REJECTED');
});
it('requires a completed provider receipt rather than assuming rejection proves receipt',async()=>{
 await db.query('update private.recommendation_ai_attempts set completed_at=null where id=$1',[parent]);await expect(arm()).rejects.toThrow('DIAGNOSTIC_PARENT_NOT_DEFINITIVELY_REJECTED');
});
it('reserves exactly one linked child with a durable diagnostic before any dispatch',async()=>{
 const before=await receipt();await arm();const first=await reserve(),second=await reserve();expect(first.owned).toBe(true);expect(first.id).not.toBe(parent);expect(second).toMatchObject({id:first.id,owned:false,state:'dispatched'});
 expect(await grant()).toMatchObject({child_attempt_id:first.id});expect(await receipt()).toEqual(before);
 expect((await db.query('select request_sha256 from private.recommendation_ai_attempts where id=$1',[first.id])).rows[0]).toEqual({request_sha256:hash});
 expect((await db.query('select attempt_id,trace from private.recommendation_ai_diagnostics')).rows[0]).toMatchObject({attempt_id:first.id,trace:{stage:'diagnostic_reserved',origin:'pending',attempt_id:first.id}});
});
it('blocks changed text/data/access hashes and incompatible diagnostics without consuming the grant',async()=>{
 await arm();await expect(reserve('c'.repeat(64))).rejects.toThrow('DIAGNOSTIC_REQUEST_CHANGED');await expect(reserve(key,'c'.repeat(64))).rejects.toThrow('DIAGNOSTIC_REQUEST_CHANGED');
 await expect(reserve(key,hash,{...trace(),server_version:7})).rejects.toThrow('DIAGNOSTIC_RUNTIME_INCOMPATIBLE');expect((await grant()).child_attempt_id).toBeNull();expect((await reserve()).owned).toBe(true);
});
it('expires without rearming or silently substituting another paid attempt',async()=>{
 const id=await arm();await db.exec('reset role');await db.exec(`update private.recommendation_diagnostic_trials set authorized_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day'`);
 expect(await arm()).toBe(id);await expect(reserve()).rejects.toThrow('DIAGNOSTIC_AUTHORIZATION_EXPIRED');expect((await grant()).child_attempt_id).toBeNull();
});
it('rechecks immutable historical proof before reserving a child',async()=>{
 await arm();await db.exec('reset role');await db.query('update private.recommendation_ai_attempts set error_code=$1 where id=$2',['CHANGED',parent]);await expect(reserve()).rejects.toThrow('DIAGNOSTIC_PARENT_CHANGED');
});
it('preserves organization concurrency and resumes the same consumed child without a resend',async()=>{
 await arm();const active=(await db.query<{a:Attempt}>('select public.reserve_recommendation_ai_v1($1,$2,$3,$4) a',[org,user,'c'.repeat(64),hash])).rows[0].a;
 expect(await reserve()).toMatchObject({owned:false,id:null});expect((await grant()).child_attempt_id).toBeNull();
 await db.query('select public.finish_recommendation_ai_v1($1,$2,$3,$4,$5)',[active.id,'http_error',null,null,'SIMULATED']);const child=await reserve();
 await db.exec('reset role');await db.query(`update private.recommendation_ai_attempts set created_at=clock_timestamp()-interval '3 minutes' where id=$1`,[child.id]);
 expect(await reserve()).toMatchObject({id:child.id,owned:false,state:'unknown'});await arm();expect(await reserve()).toMatchObject({id:child.id,owned:false,state:'unknown'});
});
it('commits the exact final diagnostic and accounting together, preserving the parent',async()=>{
 const before=await receipt();await arm();const child=await reserve(),t={...trace(child.id!),origin:'fallback',stage:'decision_validation',failure:{code:'INVALID_REFERENCE',field:'reason_refs',reference_index:1,rule:'reference_not_in_candidate'}};
 expect((await finish(child.id!,t)).rows[0].ok).toBe(true);expect((await finish(child.id!,t)).rows[0].ok).toBe(false);
 expect((await db.query(`select trace from private.recommendation_ai_diagnostics where trace->>'stage'='decision_validation'`)).rows[0]).toEqual({trace:t});
 expect(await reserve()).toMatchObject({id:child.id,owned:false,state:'invalid_output'});expect(await receipt()).toEqual(before);
 await db.query('update private.recommendation_ai_attempts set metrics=$1 where id=$2',[JSON.stringify({output_tokens:12,provider_request_id:'saved-child',configuration_version:'recommendation-ai-caution-safety-v6'}),child.id]);
 await expect(db.query('select public.authorize_recommendation_diagnostic_trial_v1($1)',[child.id])).rejects.toThrow('DIAGNOSTIC_REPLAY_CANNOT_BE_PARENT');
});
it('leaves a consumed reservation when final diagnostic persistence cannot commit',async()=>{
 await arm();const child=await reserve();await expect(finish(child.id!,{...trace(child.id!),'not_allowed':'PRIVATE_TEXT'})).rejects.toThrow('INVALID_DIAGNOSTIC');
 expect(await reserve()).toMatchObject({id:child.id,owned:false,state:'dispatched'});expect((await db.query('select metrics from private.recommendation_ai_attempts where id=$1',[child.id])).rows[0]).toEqual({metrics:null});
});
it('keeps all authorization and diagnostic replay operations server-only',async()=>{
 for(const role of ['anon','authenticated']){
  expect((await db.query<{v:boolean}>("select has_table_privilege($1,'private.recommendation_diagnostic_trials','SELECT') v",[role])).rows[0].v).toBe(false);
  for(const sig of ['public.authorize_recommendation_diagnostic_trial_v1(uuid)','public.reserve_recommendation_with_diagnostic_v1(uuid,uuid,text,text,jsonb)','public.finish_recommendation_with_diagnostic_v1(uuid,text,jsonb,jsonb,text,jsonb)'])expect((await db.query<{v:boolean}>("select has_function_privilege($1,$2,'EXECUTE') v",[role,sig])).rows[0].v).toBe(false);
 }
 await arm();await expect(db.query('select public.reserve_recommendation_with_diagnostic_v1($1,$2,$3,$4,$5)',[org,'44444444-4444-4444-8444-444444444444',key,hash,JSON.stringify(trace())])).rejects.toThrow('FORBIDDEN');
});
it('leaves ordinary reservations unchanged when no exceptional grant exists',async()=>{
 const r=await reserve();expect(r).toMatchObject({id:parent,owned:false,state:'invalid_output'});expect((await db.query('select count(*) n from private.recommendation_ai_diagnostics')).rows[0]).toEqual({n:0});
});
