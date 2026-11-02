// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
let db:PGlite;
const org='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222',root='33333333-3333-4333-8333-333333333333',parent='44444444-4444-4444-8444-444444444444';
const oldKey='a'.repeat(64),oldHash='b'.repeat(64),key='c'.repeat(64),hash='d'.repeat(64);
const trace=(id:string|null=null)=>({version:'recommendation-diagnostic-v2',attempt_id:id,origin:'pending',stage:'reservation',server_version:10,validator_version:'recommendation-criteria-validator-v2',contract_version:'recommendation-criteria-coverage-v2',cache_version:'recommendation-ai-open-criteria-safety-v7'});
type Attempt={id:string|null;owned:boolean;state:string};
beforeAll(async()=>{db=new PGlite();await db.waitReady;await db.exec(`create schema private;create schema auth;create role anon;create role authenticated;create role service_role bypassrls;
 create table public.organizations(id uuid primary key);create table auth.users(id uuid primary key);create table public.organization_members(organization_id uuid,user_id uuid,role text);
 grant select on public.organization_members to service_role;insert into public.organizations values('${org}');insert into auth.users values('${user}');insert into public.organization_members values('${org}','${user}','admin');`);
 for(const name of ['20261030042203_private_recommendation_ai_comparison','20261101051021_recommendation_private_diagnostics_v2','20261101061759_recommendation_single_diagnostic_trial','20261101130715_recommendation_corrected_diagnostic_trial'])await db.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'));
},60000);
beforeEach(async()=>{await db.exec('reset role;delete from private.recommendation_ai_diagnostics;delete from private.recommendation_corrected_diagnostic_trials;delete from private.recommendation_diagnostic_trials;delete from private.recommendation_ai_attempts');
 for(const [id,k]of [[root,oldKey],[parent,'e'.repeat(64)]])await db.query(`insert into private.recommendation_ai_attempts(id,organization_id,user_id,cache_key,request_sha256,state,error_code,metrics,completed_at) values($1,$2,$3,$4,$5,'invalid_output','IRRELEVANT_CAUTION',$6,clock_timestamp())`,[id,org,user,k,oldHash,JSON.stringify({output_tokens:746,provider_request_id:'offline-native-receipt',configuration_version:'recommendation-ai-caution-safety-v6'})]);
 await db.query(`insert into private.recommendation_diagnostic_trials(parent_attempt_id,organization_id,user_id,parent_row_md5,consumed_at,child_attempt_id) select id,organization_id,user_id,md5(to_jsonb(a)::text),clock_timestamp(),$2 from private.recommendation_ai_attempts a where id=$1`,[root,parent]);
});
afterAll(()=>db.close());
const arm=async(id=parent)=>{await db.exec('set role service_role');return (await db.query<{id:string}>('select public.authorize_corrected_recommendation_diagnostic_v1($1) id',[id])).rows[0].id;};
const reserve=async(k=key,h=hash,lk=oldKey,lh=oldHash,t=trace(),uid=user)=>(db.query<{a:Attempt}>('select public.reserve_corrected_recommendation_diagnostic_v1($1,$2,$3,$4,$5,$6,$7) a',[org,uid,k,h,lk,lh,JSON.stringify(t)]).then(r=>r.rows[0].a));
const snapshot=async()=>(await db.query(`select id,md5(to_jsonb(a)::text) hash from private.recommendation_ai_attempts a where id in($1,$2) order by id`,[root,parent])).rows;
const oldGrant=async()=>(await db.query('select * from private.recommendation_diagnostic_trials')).rows;
const grant=async()=>(await db.query<{child_attempt_id:string|null;consumed_at:string|null}>('select child_attempt_id,consumed_at from private.recommendation_corrected_diagnostic_trials')).rows[0];
const finish=async(id:string,t:unknown=trace(id))=>db.query<{ok:boolean}>('select public.finish_corrected_recommendation_diagnostic_v1($1,$2,$3,$4,$5,$6) ok',[id,'invalid_output',null,JSON.stringify({input_tokens:100,output_tokens:20,provider_request_id:'simulated'}),'IRRELEVANT_CAUTION',JSON.stringify(t)]);
it('authorizes once without creating an attempt or changing either historical receipt/grant',async()=>{
 const before=await snapshot(),old=await oldGrant(),id=await arm();expect(await arm()).toBe(id);expect(await grant()).toEqual({child_attempt_id:null,consumed_at:null});expect(await snapshot()).toEqual(before);expect(await oldGrant()).toEqual(old);
 expect((await db.query('select count(*) n from private.recommendation_ai_attempts')).rows[0]).toEqual({n:2});
});
it.each(['unknown','dispatched','http_error','obsolete'])('does not authorize a parent in %s',async state=>{
 await db.query('update private.recommendation_ai_attempts set state=$1 where id=$2',[state,parent]);await expect(arm()).rejects.toThrow('DIAGNOSTIC_PARENT_NOT_DEFINITIVELY_REJECTED');
});
it('requires native proof and unchanged original root identity',async()=>{
 await db.query(`update private.recommendation_ai_attempts set metrics=metrics-'provider_request_id' where id=$1`,[parent]);await expect(arm()).rejects.toThrow('DIAGNOSTIC_PARENT_NOT_DEFINITIVELY_REJECTED');
});
it('cannot silently accept changed text, filters, access, data or protocol',async()=>{
 await arm();await expect(reserve(key,hash,'f'.repeat(64))).rejects.toThrow('DIAGNOSTIC_REQUEST_CHANGED');await expect(reserve(key,hash,oldKey,'f'.repeat(64))).rejects.toThrow('DIAGNOSTIC_REQUEST_CHANGED');
 await expect(reserve(key,hash,oldKey,oldHash,{...trace(),validator_version:'recommendation-criteria-validator-v1'})).rejects.toThrow('DIAGNOSTIC_RUNTIME_INCOMPATIBLE');
 await expect(reserve(key,hash,oldKey,oldHash,{...trace(),server_version:9})).rejects.toThrow('DIAGNOSTIC_RUNTIME_INCOMPATIBLE');expect((await grant()).child_attempt_id).toBeNull();
 await expect(reserve(key,hash,oldKey,oldHash,{...trace(),contract_version:'recommendation-criteria-coverage-v3',cache_version:'recommendation-ai-open-criteria-safety-v8'})).rejects.toThrow('DIAGNOSTIC_RUNTIME_INCOMPATIBLE');expect((await grant()).child_attempt_id).toBeNull();
});
it('commits one new child and initial diagnostic before sending; double click joins it',async()=>{
 const before=await snapshot(),old=await oldGrant();await arm();const first=await reserve();expect(first.owned).toBe(true);expect(await reserve()).toMatchObject({id:first.id,owned:false,state:'dispatched'});
 expect((await db.query('select attempt_id,trace from private.recommendation_ai_diagnostics')).rows[0]).toMatchObject({attempt_id:first.id,trace:{stage:'diagnostic_reserved',contract_version:'recommendation-criteria-coverage-v2',validator_version:'recommendation-criteria-validator-v2'}});
 expect(await snapshot()).toEqual(before);expect(await oldGrant()).toEqual(old);
});
it('keeps an unknown result consumed; expiry and authorization again never reset it',async()=>{
 const id=await arm(),child=await reserve();await db.exec('reset role');await db.query(`update private.recommendation_ai_attempts set created_at=clock_timestamp()-interval '3 minutes' where id=$1`,[child.id]);
 expect(await arm()).toBe(id);expect(await reserve()).toMatchObject({id:child.id,owned:false,state:'unknown'});await expect(reserve('f'.repeat(64))).rejects.toThrow('DIAGNOSTIC_REQUEST_CHANGED');
 await expect(reserve('f'.repeat(64),'f'.repeat(64),'f'.repeat(64),'f'.repeat(64))).rejects.toThrow('DIAGNOSTIC_REQUEST_CHANGED');
});
it('rejects expiry without consuming, rearming or an ordinary paid fallback',async()=>{
 const id=await arm();await db.exec('reset role');await db.exec(`update private.recommendation_corrected_diagnostic_trials set authorized_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day'`);expect(await arm()).toBe(id);
 await expect(reserve()).rejects.toThrow('DIAGNOSTIC_AUTHORIZATION_EXPIRED');expect((await grant()).child_attempt_id).toBeNull();
});
it('keeps existing organization concurrency and does not create a second V7 attempt',async()=>{
 await arm();const active=(await db.query<{a:Attempt}>('select public.reserve_recommendation_ai_v1($1,$2,$3,$4) a',[org,user,'f'.repeat(64),hash])).rows[0].a;expect(await reserve()).toMatchObject({id:null,owned:false});expect((await grant()).child_attempt_id).toBeNull();
 await db.query('select public.finish_recommendation_ai_v1($1,$2,$3,$4,$5)',[active.id,'http_error',null,null,'SIMULATED']);
 await db.query('select public.reserve_recommendation_ai_v1($1,$2,$3,$4)',[org,user,key,hash]);await expect(reserve()).rejects.toThrow('DIAGNOSTIC_COMPATIBLE_ATTEMPT_ALREADY_EXISTS');
});
it('rolls back a failed initial diagnostic and stores a final diagnostic atomically',async()=>{
 await arm();await expect(reserve(key,hash,oldKey,oldHash,{...trace(),bad_key:'PRIVATE_TEXT'} as ReturnType<typeof trace>)).rejects.toThrow('INVALID_DIAGNOSTIC');expect((await grant()).child_attempt_id).toBeNull();
 const child=await reserve();await expect(finish(child.id!,{...trace(child.id!),bad_key:'PRIVATE_TEXT'})).rejects.toThrow('INVALID_DIAGNOSTIC');expect(await reserve()).toMatchObject({id:child.id,owned:false,state:'dispatched'});
 expect((await finish(child.id!)).rows[0].ok).toBe(true);expect(await reserve()).toMatchObject({id:child.id,owned:false,state:'invalid_output'});expect((await finish(child.id!)).rows[0].ok).toBe(false);
});
it('rechecks historical rows, and never exposes authorization or receipts to clients',async()=>{
 await arm();await db.exec('reset role');await db.query('update private.recommendation_ai_attempts set error_code=$1 where id=$2',['CHANGED',root]);await expect(reserve()).rejects.toThrow('DIAGNOSTIC_PARENT_CHANGED');
 for(const role of ['anon','authenticated']){
  expect((await db.query<{v:boolean}>("select has_table_privilege($1,'private.recommendation_corrected_diagnostic_trials','SELECT') v",[role])).rows[0].v).toBe(false);
  for(const sig of ['public.authorize_corrected_recommendation_diagnostic_v1(uuid)','public.reserve_corrected_recommendation_diagnostic_v1(uuid,uuid,text,text,text,text,jsonb)','public.finish_corrected_recommendation_diagnostic_v1(uuid,text,jsonb,jsonb,text,jsonb)'])expect((await db.query<{v:boolean}>('select has_function_privilege($1,$2,\'EXECUTE\') v',[role,sig])).rows[0].v).toBe(false);
 }
 await expect(reserve(key,hash,oldKey,oldHash,trace(),'55555555-5555-4555-8555-555555555555')).rejects.toThrow('FORBIDDEN');
});
it('leaves the ordinary path unchanged without any new authorization',async()=>{
 const original=(await db.query('select * from private.recommendation_ai_attempts')).rows;expect(await reserve(oldKey,oldHash)).toMatchObject({id:parent,owned:false,state:'invalid_output'});expect((await db.query('select * from private.recommendation_ai_attempts')).rows).toEqual(original);
});
