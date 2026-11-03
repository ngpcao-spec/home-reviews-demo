// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
let db:PGlite;
const org='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222',root='33333333-3333-4333-8333-333333333333',old='44444444-4444-4444-8444-444444444444',parent='55555555-5555-4555-8555-555555555555';
const legacyKey='a'.repeat(64),legacyHash='b'.repeat(64),key='c'.repeat(64),hash='d'.repeat(64);
const trace={version:'recommendation-diagnostic-v2',server_version:15,validator_version:'recommendation-structural-validator-v1',contract_version:'recommendation-direct-choice-v1',cache_version:'recommendation-ai-light-v11',origin:'pending',stage:'reservation'};
const operator=readFileSync('scripts/sql/authorize-recommendation-light-trial.sql','utf8');
const reserve=(k=key,h=hash,lk=legacyKey,lh=legacyHash,t=trace)=>db.query<{a:{id:string;owned:boolean;state:string}}>('select public.reserve_corrected_recommendation_diagnostic_v1($1,$2,$3,$4,$5,$6,$7) a',[org,user,k,h,lk,lh,JSON.stringify(t)]).then(r=>r.rows[0].a);
const grant=()=>db.query<{id:string;consumed_at:string|null;child_attempt_id:string|null;expires_at:string}>('select * from private.recommendation_corrected_diagnostic_trials where parent_attempt_id=$1',[parent]).then(r=>r.rows[0]);
const history=()=>db.query('select id,md5(to_jsonb(a)::text) hash from private.recommendation_ai_attempts a order by id').then(r=>r.rows);
async function arm(candidate=parent){
 const {rows:[p]}=await db.query<{completed_at:string;hash:string}>('select completed_at,md5(to_jsonb(a)::text) hash from private.recommendation_ai_attempts a where id=$1',[candidate]);
 await db.exec('begin');try{
  for(const [name,value]of Object.entries({'home.trial_parent':candidate,'home.trial_organization':org,'home.trial_user':user,'home.trial_completed_at':p.completed_at,'home.trial_parent_hash':p.hash}))await db.query('select set_config($1,$2,true)',[name,value]);
  await db.exec(operator);await db.exec('commit');
 }catch(e){await db.exec('rollback');throw e;}
}
beforeAll(async()=>{
 db=new PGlite();await db.waitReady;await db.exec(`create schema private;create schema auth;create role anon;create role authenticated;create role service_role bypassrls;
 create table organizations(id uuid primary key);create table auth.users(id uuid primary key);create table organization_members(organization_id uuid,user_id uuid,role text);
 grant select on organization_members to service_role;insert into organizations values('${org}');insert into auth.users values('${user}');insert into organization_members values('${org}','${user}','manager');`);
 for(const name of ['20261030042203_private_recommendation_ai_comparison','20261101051021_recommendation_private_diagnostics_v2','20261101061759_recommendation_single_diagnostic_trial','20261101130715_recommendation_corrected_diagnostic_trial','20261102043631_recommendation_reference_diagnostic_trial','20261102124759_recommendation_proof_trial_protocol','20261102153534_recommendation_direct_trial_protocol','20261103002410_recommendation_light_manual_trial_protocol'])await db.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'));
},60000);
beforeEach(async()=>{
 await db.exec('reset role;delete from private.recommendation_ai_diagnostics;delete from private.recommendation_corrected_diagnostic_trials;delete from private.recommendation_diagnostic_trials;delete from private.recommendation_ai_attempts');
 for(const [id,state,version,k]of [[root,'invalid_output','recommendation-ai-caution-safety-v6',legacyKey],[old,'invalid_output','recommendation-ai-open-criteria-safety-v9','e'.repeat(64)],[parent,'succeeded','recommendation-ai-direct-choice-v10','f'.repeat(64)]])await db.query(`insert into private.recommendation_ai_attempts(id,organization_id,user_id,cache_key,request_sha256,state,selection,metrics,completed_at) values($1,$2,$3,$4,$5,$6,case when $6='succeeded' then '[]'::jsonb else null end,$7,clock_timestamp())`,[id,org,user,k,legacyHash,state,JSON.stringify({configuration_version:version,provider_request_id:'offline-only',output_tokens:1133})]);
 await db.query(`insert into private.recommendation_corrected_diagnostic_trials(parent_attempt_id,organization_id,user_id,parent_row_md5,root_attempt_id,root_row_md5,legacy_cache_key,legacy_request_sha256,target_contract,target_validator,target_cache,child_attempt_id,consumed_at,cache_key,request_sha256,authorized_at,expires_at)
 select p.id,p.organization_id,p.user_id,md5(to_jsonb(p)::text),r.id,md5(to_jsonb(r)::text),$1,$2,'recommendation-direct-choice-v1','recommendation-structural-validator-v1','recommendation-ai-direct-choice-v10',$3,clock_timestamp()-interval '1 day',$4,$2,clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day'
 from private.recommendation_ai_attempts p cross join private.recommendation_ai_attempts r where p.id=$5 and r.id=$6`,[legacyKey,legacyHash,parent,'f'.repeat(64),old,root]);
});
afterAll(()=>db.close());
it('creates exactly one idempotent manual grant without altering the successful parent or earlier grant',async()=>{
 const before=await history(),prior=await db.query('select * from private.recommendation_corrected_diagnostic_trials');
 await arm();const first=await grant();await arm();expect(await grant()).toEqual(first);expect(first).toMatchObject({consumed_at:null,child_attempt_id:null});expect(await history()).toEqual(before);
 expect((await db.query('select * from private.recommendation_corrected_diagnostic_trials where parent_attempt_id=$1',[old])).rows).toEqual(prior.rows);
});
it.each(['text_filters_data_language','access_identity','old_runtime','wrong_cache'])('rejects mismatched %s without consuming the grant or creating a child',async kind=>{
 await arm();const before=await history();
 await expect(reserve(key,hash,kind==='access_identity'?'9'.repeat(64):legacyKey,kind==='text_filters_data_language'?'9'.repeat(64):legacyHash,{...trace,...(kind==='old_runtime'?{server_version:14}:{}),...(kind==='wrong_cache'?{cache_version:'recommendation-ai-direct-choice-v10'}:{})})).rejects.toThrow(/DIAGNOSTIC_REQUEST_CHANGED|DIAGNOSTIC_RUNTIME_INCOMPATIBLE/);
 expect((await grant()).consumed_at).toBeNull();expect(await history()).toEqual(before);
});
it.each(['succeeded','invalid_output','unknown'])('shares one consumed child and never rearms or resends after %s',async state=>{
 await arm();const before=await history(),child=await reserve();expect(child.owned).toBe(true);expect(await reserve()).toMatchObject({id:child.id,owned:false,state:'dispatched'});
 await db.query('update private.recommendation_ai_attempts set state=$1,selection=case when $1=\'succeeded\' then \'[]\'::jsonb else null end where id=$2',[state,child.id]);
 const consumed=await grant();expect(consumed.consumed_at).not.toBeNull();expect(await reserve()).toMatchObject({id:child.id,owned:false,state});await arm();expect(await grant()).toEqual(consumed);
 expect((await history()).filter(a=>a.id!==child.id)).toEqual(before);await expect(reserve('9'.repeat(64))).rejects.toThrow('DIAGNOSTIC_REQUEST_CHANGED');
});
it('rejects expiry without extending or consuming the authorization',async()=>{
 await arm();await db.exec("update private.recommendation_corrected_diagnostic_trials set authorized_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' where target_cache='recommendation-ai-light-v11'");const expired=await grant();await expect(reserve()).rejects.toThrow('DIAGNOSTIC_AUTHORIZATION_EXPIRED');await arm();expect(await grant()).toEqual(expired);
});
it('does not let a light outcome become a new v10 comparison parent',async()=>{
 await arm();const child=await reserve();await db.query("update private.recommendation_ai_attempts set state='succeeded',selection='[]',completed_at=clock_timestamp(),metrics=jsonb_set(coalesce(metrics,'{}'),'{configuration_version}','\"recommendation-ai-light-v11\"') where id=$1",[child.id]);
 await expect(arm(child.id)).rejects.toThrow('DIAGNOSTIC_PARENT_NOT_DEFINITIVELY_SUCCEEDED');
});
