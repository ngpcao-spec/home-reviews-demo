// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
let db:PGlite,parent:string;
const org='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222',root='33333333-3333-4333-8333-333333333333',prior='44444444-4444-4444-8444-444444444444';
const legacyKey='a'.repeat(64),legacyHash='b'.repeat(64),oldKey='c'.repeat(64),oldHash='d'.repeat(64),key='e'.repeat(64),hash='f'.repeat(64);
const trace=(modern=true,id:string|null=null)=>({version:'recommendation-diagnostic-v2',attempt_id:id,origin:'pending',stage:'reservation',server_version:12,validator_version:'recommendation-criteria-validator-v2',contract_version:`recommendation-criteria-coverage-v${modern?3:2}`,cache_version:`recommendation-ai-open-criteria-safety-v${modern?8:7}`});
type Attempt={id:string;owned:boolean;state:string};
const reserve=(k=key,h=hash,lk=legacyKey,lh=legacyHash,t=trace())=>db.query<{a:Attempt}>('select public.reserve_corrected_recommendation_diagnostic_v1($1,$2,$3,$4,$5,$6,$7) a',[org,user,k,h,lk,lh,JSON.stringify(t)]).then(r=>r.rows[0].a);
const finish=(id:string,state='invalid_output',error='INVALID_REFERENCE')=>db.query('select public.finish_corrected_recommendation_diagnostic_v1($1,$2,$3,$4,$5,$6)',[id,state,null,JSON.stringify({configuration_version:'recommendation-ai-open-criteria-safety-v7',output_tokens:422,provider_request_id:'offline-native-receipt'}),error,JSON.stringify(trace(false,id))]);
const arm=()=>db.query<{id:string}>('select public.authorize_reference_recommendation_diagnostic_v1($1) id',[parent]).then(r=>r.rows[0].id);
const grants=()=>db.query('select * from private.recommendation_corrected_diagnostic_trials order by authorized_at').then(r=>r.rows);
const newGrant=()=>db.query<{id:string;expires_at:string;authorized_at:string;child_attempt_id:string|null;consumed_at:string|null}>('select * from private.recommendation_corrected_diagnostic_trials where parent_attempt_id=$1',[parent]).then(r=>r.rows[0]);
const history=()=>db.query('select id,md5(to_jsonb(a)::text) hash from private.recommendation_ai_attempts a order by id').then(r=>r.rows);
beforeAll(async()=>{db=new PGlite();await db.waitReady;await db.exec(`create schema private;create schema auth;create role anon;create role authenticated;create role service_role bypassrls;
 create table public.organizations(id uuid primary key);create table auth.users(id uuid primary key);create table public.organization_members(organization_id uuid,user_id uuid,role text);
 grant select on public.organization_members to service_role;insert into public.organizations values('${org}');insert into auth.users values('${user}');insert into public.organization_members values('${org}','${user}','admin');`);
 for(const name of ['20261030042203_private_recommendation_ai_comparison','20261101051021_recommendation_private_diagnostics_v2','20261101061759_recommendation_single_diagnostic_trial','20261101130715_recommendation_corrected_diagnostic_trial','20261102043631_recommendation_reference_diagnostic_trial'])await db.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'));
},60000);
beforeEach(async()=>{await db.exec(`reset role;delete from private.recommendation_ai_diagnostics;delete from private.recommendation_corrected_diagnostic_trials;delete from private.recommendation_diagnostic_trials;delete from private.recommendation_ai_attempts;delete from public.organization_members;insert into public.organization_members values('${org}','${user}','admin')`);
 for(const [id,k]of [[root,legacyKey],[prior,'0'.repeat(64)]])await db.query(`insert into private.recommendation_ai_attempts(id,organization_id,user_id,cache_key,request_sha256,state,error_code,metrics,completed_at) values($1,$2,$3,$4,$5,'invalid_output','IRRELEVANT_CAUTION',$6,clock_timestamp())`,[id,org,user,k,legacyHash,JSON.stringify({output_tokens:100,provider_request_id:'offline-root',configuration_version:'recommendation-ai-caution-safety-v6'})]);
 await db.query(`insert into private.recommendation_diagnostic_trials(parent_attempt_id,organization_id,user_id,parent_row_md5,consumed_at,child_attempt_id) select id,organization_id,user_id,md5(to_jsonb(a)::text),clock_timestamp(),$2 from private.recommendation_ai_attempts a where id=$1`,[root,prior]);
 await db.exec('set role service_role');await db.query('select public.authorize_corrected_recommendation_diagnostic_v1($1)',[prior]);parent=(await reserve(oldKey,oldHash,legacyKey,legacyHash,trace(false))).id;await finish(parent);
 // Advance the synthetic calendar coherently: the consumed V7 grant predates V8.
 await db.exec("reset role;update private.recommendation_corrected_diagnostic_trials set authorized_at=clock_timestamp()-interval '3 days',expires_at=clock_timestamp()-interval '2 days';set role service_role");
});
afterAll(()=>db.close());
it('arms a distinct V3/V8 grant once, without attempts, old-row edits or expiry extension',async()=>{
 const old=await grants(),before=await history(),id=await arm(),g=await newGrant();expect(await arm()).toBe(id);expect(await newGrant()).toEqual(g);
 expect(g).toMatchObject({child_attempt_id:null,consumed_at:null,target_contract:'recommendation-criteria-coverage-v3',target_cache:'recommendation-ai-open-criteria-safety-v8',legacy_cache_key:legacyKey,legacy_request_sha256:legacyHash});
 expect(new Date(g.expires_at).getTime()-new Date(g.authorized_at).getTime()).toBeGreaterThanOrEqual(86400000);expect(new Date(g.expires_at).getTime()-new Date(g.authorized_at).getTime()).toBeLessThan(86401000);
 expect((await grants())[0]).toEqual(old[0]);expect(await history()).toEqual(before);
});
it.each(['unknown','dispatched','http_error','succeeded'])('refuses a %s parent without any new authorization',async state=>{
 await db.query("update private.recommendation_ai_attempts set state=$1,selection=case when $1='succeeded' then '[]'::jsonb else null end where id=$2",[state,parent]);await expect(arm()).rejects.toThrow('DIAGNOSTIC_PARENT_NOT_DEFINITIVELY_REJECTED');expect(await newGrant()).toBeUndefined();
});
it('requires the exact rejected error, native receipt, tokens, completion and V7 version',async()=>{
 for(const sql of ["error_code='IRRELEVANT_CAUTION'","metrics=metrics-'provider_request_id'","metrics=jsonb_set(metrics,'{output_tokens}','0')","completed_at=null","metrics=jsonb_set(metrics,'{configuration_version}','\"recommendation-ai-open-criteria-safety-v8\"')"]){
  await db.exec('begin');await db.query(`update private.recommendation_ai_attempts set ${sql} where id=$1`,[parent]);await expect(arm()).rejects.toThrow('DIAGNOSTIC_PARENT_NOT_DEFINITIVELY_REJECTED');await db.exec('rollback');
 }
});
it('requires unchanged proven ancestry and refuses missing or changed links',async()=>{
 for(const sql of [`update private.recommendation_ai_attempts set error_code='CHANGED' where id='${root}'`,`update private.recommendation_ai_attempts set error_code='CHANGED' where id='${prior}'`,`update private.recommendation_corrected_diagnostic_trials set request_sha256='${hash}'`]){
  await db.exec('begin');await db.exec(sql);await expect(arm()).rejects.toThrow(/DIAGNOSTIC_PARENT_(?:CHANGED|LINK_UNPROVEN)/);await db.exec('rollback');
 }
});
it('pins runtime, request, filters, catalogue and access identity before consuming',async()=>{
 await arm();await expect(reserve(key,hash,hash)).rejects.toThrow('DIAGNOSTIC_REQUEST_CHANGED');await expect(reserve(key,hash,legacyKey,hash)).rejects.toThrow('DIAGNOSTIC_REQUEST_CHANGED');
 await expect(reserve(key,hash,legacyKey,legacyHash,trace(false))).rejects.toThrow('DIAGNOSTIC_RUNTIME_INCOMPATIBLE');expect((await newGrant()).consumed_at).toBeNull();
 await expect(reserve(key,hash,legacyKey,legacyHash,{...trace(),validator_version:'recommendation-criteria-validator-v3',cache_version:'recommendation-ai-open-criteria-safety-v9'})).rejects.toThrow('DIAGNOSTIC_RUNTIME_INCOMPATIBLE');expect((await newGrant()).consumed_at).toBeNull();
});
it('consumes one child with diagnostic atomically; double click joins and unknown never resends',async()=>{
 await arm();const child=await reserve();expect(child.owned).toBe(true);expect(await reserve()).toMatchObject({id:child.id,owned:false,state:'dispatched'});
 expect((await db.query('select trace from private.recommendation_ai_diagnostics where attempt_id=$1',[child.id])).rows[0]).toMatchObject({trace:{contract_version:'recommendation-criteria-coverage-v3',cache_version:'recommendation-ai-open-criteria-safety-v8'}});
 await db.query("update private.recommendation_ai_attempts set created_at=clock_timestamp()-interval '3 minutes' where id=$1",[child.id]);const before=await newGrant();await arm();expect(await newGrant()).toEqual(before);expect(await reserve()).toMatchObject({id:child.id,owned:false,state:'unknown'});
 await expect(reserve(hash)).rejects.toThrow('DIAGNOSTIC_REQUEST_CHANGED');
});
it('expiry does not fall through to a normal paid attempt or reset on reauthorization',async()=>{
 const id=await arm();await db.exec('reset role');await db.query("update private.recommendation_corrected_diagnostic_trials set authorized_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' where id=$1",[id]);await db.exec('set role service_role');const before=await newGrant();expect(await arm()).toBe(id);expect(await newGrant()).toEqual(before);await expect(reserve()).rejects.toThrow('DIAGNOSTIC_AUTHORIZATION_EXPIRED');
});
it('rejects incoherent protocol tuples and cannot authorize a V8 replay chain',async()=>{
 await arm();await expect(db.query("update private.recommendation_corrected_diagnostic_trials set target_cache='recommendation-ai-open-criteria-safety-v7' where parent_attempt_id=$1",[parent])).rejects.toThrow('recommendation_diagnostic_protocol_pair');
 const child=await reserve();await db.query('select public.finish_corrected_recommendation_diagnostic_v1($1,$2,$3,$4,$5,$6)',[child.id,'invalid_output',null,JSON.stringify({configuration_version:'recommendation-ai-open-criteria-safety-v8',output_tokens:20,provider_request_id:'offline-v8'}),'INVALID_REFERENCE',JSON.stringify(trace(true,child.id))]);
 await expect(db.query('select public.authorize_reference_recommendation_diagnostic_v1($1)',[child.id])).rejects.toThrow('DIAGNOSTIC_PARENT_NOT_DEFINITIVELY_REJECTED');
});
it('rolls back diagnostic failure before HTTP and preserves concurrency',async()=>{
 await arm();await expect(reserve(key,hash,legacyKey,legacyHash,{...trace(),private_text:'not allowed'} as ReturnType<typeof trace>)).rejects.toThrow('INVALID_DIAGNOSTIC');expect((await newGrant()).consumed_at).toBeNull();
 await db.query('select public.reserve_recommendation_ai_v1($1,$2,$3,$4)',[org,user,'1'.repeat(64),hash]);expect(await reserve()).toMatchObject({id:null,owned:false});expect((await newGrant()).consumed_at).toBeNull();
});
it('does not expose arming to clients or weaken organization authorization',async()=>{
 for(const role of ['anon','authenticated'])expect((await db.query<{v:boolean}>("select has_function_privilege($1,'public.authorize_reference_recommendation_diagnostic_v1(uuid)','EXECUTE') v",[role])).rows[0].v).toBe(false);
 await db.exec('reset role');await db.exec('delete from public.organization_members');await db.exec('set role service_role');await expect(arm()).rejects.toThrow('FORBIDDEN');
});
