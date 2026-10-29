// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect,vi} from 'vitest';
import {sharedJevIdentities,sharedMissingIds,sharedBatchPlans,automaticJevSnapshot,SHARED_JEV_VERSION} from '../../supabase/functions/_shared/shared-jev-analysis';
import {directHash} from '../../supabase/functions/_shared/jev-direct-categories';
import {analysisTextSha256} from '../../supabase/functions/_shared/analysis-text';
import {currentReportProtocol} from '../../supabase/functions/_shared/current-report-v2';
import {currentBatchManifest} from '../../supabase/functions/_shared/current-batch-report';
import type {HistoricalJob} from '../../supabase/functions/_shared/historical-report-worker';
import {MIXED_SELECTOR_VERSION,evidenceSelectorBinding} from '../../supabase/functions/_shared/report-evidence-selector';
import {mockBatchJevResponse} from '../../supabase/functions/_shared/current-batch-probe';
import {validateBatchTask,type BatchRun,type BatchTask} from '../../supabase/functions/_shared/jev-batch-experiment';
const org='10000000-0000-4000-8000-000000000001',est='20000000-0000-4000-8000-000000000001',actor='30000000-0000-4000-8000-000000000001';
const schema=JSON.parse(readFileSync('tests/fixtures/shared-jev-schema-before.json','utf8'));
const definitions=JSON.parse(readFileSync('tests/fixtures/shared-jev-functions-before.json','utf8'));
let db:PGlite,deny:ReturnType<typeof vi.spyOn>;
const q=async<T=Record<string,unknown>>(sql:string,args:unknown[]=[])=> (await db.query<T>(sql,args)).rows;
const rpc=async<T=Record<string,unknown>>(fn:string,args:unknown[])=> (await q<{v:T}>('select to_jsonb(public.'+fn+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')) v',args))[0].v;
beforeAll(async()=>{
 deny=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN'));
 db=new PGlite({extensions:{pgcrypto}});await db.waitReady;
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema private;create schema extensions;create extension pgcrypto with schema extensions;create schema auth;create function auth.uid() returns uuid language sql as $$select null::uuid$$;");
 for(const table of [...new Set(schema.columns.map((c:{schema:string;table:string})=>c.schema+'.'+c.table))]){
  const cols=schema.columns.filter((c:{schema:string;table:string})=>c.schema+'.'+c.table===table);
  await db.exec('create table '+table+'('+cols.map((c:{column:string;type:string;default:string|null})=>'"'+c.column+'" '+c.type+(c.default?' default '+c.default:'')).join(',')+')');
 }
 for(const [file,name] of [['20261010080134_jev_economy_preparation.sql','jev_economy_canonical'],['20261014160258_jls_restaurant_delegated_preparation.sql','jls_restaurant_hash']]){
  const s=readFileSync('supabase/migrations/'+file,'utf8'),start=s.indexOf('create function public.'+name);await db.exec(s.slice(start,s.indexOf('$$;',start)+3));
 }
 const policy=readFileSync('supabase/migrations/20261025094916_latest_150_review_policy.sql','utf8'),retStart=policy.indexOf('create or replace function public.retained_review_ids(');
 await db.exec("create function public.review_usable_text(a text,b text) returns text language sql as $$select nullif(btrim(coalesce(nullif(a,''),b)), '')$$;");
 await db.exec(policy.slice(retStart,policy.indexOf('$$;',retStart)+3));
 const native=readFileSync('supabase/migrations/20261025161612_account_native_google_language.sql','utf8'),fpStart=native.indexOf('create or replace function public.review_corpus_fingerprint(');
 await db.exec(native.slice(fpStart,native.indexOf('$$;',fpStart)+3));
 for(const c of schema.constraints)await db.exec('alter table '+c.schema+'.'+c.table+' add constraint "'+c.name+'" '+c.definition.replaceAll('digest(', 'extensions.digest('));
 const needed=['private.retention_retire_source','private.store_current_report_publication','public.freeze_recent_review_source','public.prepare_current_v2_protocol',
  'public.commit_incremental_review_sync','public.guard_batch_frozen_data','public.jev_batch_create_current','public.jev_batch_claim_sol','public.jev_batch_save_projection',
  'public.jev_batch_recover','public.retention_batch_allowed','public.jev_batch_claim','public.jev_batch_receive','public.jev_batch_refresh_usage','public.jev_batch_continue_received'];
 for(const name of needed)await db.exec(definitions[name]);
 for(const [file,name] of [['20261027152036_restaurant_recommendation_sheets_v1.sql','recommendation_key_v1'],['20261025021329_recent_text_retention_policy.sql','retention_number']]){
  const sql=readFileSync('supabase/migrations/'+file,'utf8'),start=sql.indexOf('create function private.'+name+'(');await db.exec(sql.slice(start,sql.indexOf('$$;',start)+3));
 }
 for(const d of Object.values(JSON.parse(readFileSync('tests/fixtures/shared-jev-helpers-before.json','utf8'))))await db.exec(d as string);
 for(const [file,names] of [['20261026132413_pin_report_evidence_selector.sql',['report_evidence_selector_sha','report_evidence_selector_matches']],['20261026161509_pin_mixed_source_evidence_selector.sql',['report_evidence_selector_sha','report_request_evidence_selector_matches']]] as const){
  const sql=readFileSync('supabase/migrations/'+file,'utf8');for(const name of names){const start=sql.indexOf('create'+(sql.includes('create or replace function public.'+name+'(')?' or replace':'')+' function public.'+name+'(');expect(start).toBeGreaterThan(-1);await db.exec(sql.slice(start,sql.indexOf('$$;',start)+3));}
 }
 await db.exec("create or replace function private.enqueue_review_ai() returns trigger language plpgsql as $$begin if new.historical_import then return new;end if;return new;end$$;create table public.test_dispatch(id uuid);create or replace function public.jev_batch_wake(p_run uuid) returns bigint language plpgsql as $$begin insert into public.test_dispatch values(p_run);return 1;end$$;");
 for(const guard of JSON.parse(readFileSync('tests/fixtures/shared-jev-report-guards-before.json','utf8'))){await db.exec(guard.definition);await db.exec(guard.trigger);}
 await db.exec(readFileSync('supabase/migrations/20261029042839_shared_jev_analysis.sql','utf8'));
 await db.exec('create table public.profiles(user_id uuid,preferred_language text);');
 // Empty legacy pipelines and inert retention/dispatch: no provider transport.
 await db.exec("create table public.analysis_jls_sol_ready_operations(run_id uuid,request_count int,status text,receipt jsonb);create table public.analysis_jls_restaurant_runs(id uuid,status text);create table public.review_reply_drafts(review_id uuid,language text,ai_status text,draft_text text,ai_suggested_reply text);create function private.apply_recent_review_retention(uuid,timestamptz) returns void language sql as $$select$$;");
 const autoDefinitions=JSON.parse(readFileSync('tests/fixtures/automatic-report-functions-before.json','utf8'));
 await db.exec(autoDefinitions['public.enqueue_current_report']);
 await db.exec(readFileSync('supabase/migrations/20261029081147_automatic_report_refresh.sql','utf8'));
 await db.exec('create trigger batch_frozen before update on public.analysis_jev_batch_runs for each row execute function public.guard_batch_frozen_data();create trigger task_frozen before update on public.analysis_jev_batch_tasks for each row execute function public.guard_batch_frozen_data();');
 const guards=JSON.parse(readFileSync('tests/fixtures/report-selector-functions-before.json','utf8'));
 await db.exec(guards.definitions.find((f:{name:string})=>f.name==='guard_report_request').definition);
 await db.exec('create trigger report_request_immutable before update or delete on public.report_generation_requests for each row execute function public.guard_report_request()');
 await db.exec('grant usage on schema private,extensions to service_role;grant all on all tables in schema public,private to service_role;');
 await db.exec("alter table public.report_generation_requests alter column evidence_selector_version set default 'sol-evidence-started-source-mixed-completion-v1',alter column evidence_selector_sha256 set default 'ed41510685e7897f0f0252fee2a9323140dc49e630d7524a51e706b35d09f1b5';");
 await q('insert into public.organizations(id) values($1)',[org]);
 await q("insert into public.establishments(id,organization_id,name,active) values($1,$2,'Synthetic fixture',true)",[est,org]);
 await q("insert into public.organization_members(organization_id,user_id,role) values($1,$2,'owner')",[org,actor]);
 await q("insert into public.profiles values($1,'vi')",[actor]);
 await db.exec("insert into public.review_corpus_policy(id,enabled,paused,ingestions_paused) values(true,true,false,false);update private.shared_jev_runtime set enabled=true;");
},60000);
beforeEach(()=>db.exec('begin;set local role service_role'));
afterEach(async()=>{await db.exec('rollback');expect(deny).not.toHaveBeenCalled();});
afterAll(async()=>{await db.close();deny.mockRestore();});

async function autoReference(n=100){
 const s=await source(n);
 for(const [i,r] of s.rows.entries())await q("insert into public.reviews(id,organization_id,establishment_id,external_review_id,rating,original_text,original_language,published_at) values($1,$2,$3,$4,5,$5,'vi','2026-01-01'::timestamptz+$6*interval '1 second')",[r.id,org,est,r.external_review_id,r.original_text,i]);
 await q("update public.historical_report_runs set status='completed',created_at=clock_timestamp()-interval '1 day' where id=$1",[s.id]);
 const report=crypto.randomUUID();
 await q("insert into public.current_report_publications(establishment_id,organization_id,language,report_id,source_run_id,source_created_at,generated_at,scope,document,source_bindings,evidence_bindings,stale,provenance) select $1,$2,'vi',$3,$4,clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day',jsonb_build_object('policy_epoch',epoch,'review_count',$5::int),'{\"state\":\"completed\",\"controls\":{\"technical_checks_passed\":true}}',$6,'[]',false,'{}' from public.review_corpus_policy",[est,org,report,s.id,n,s.rows.map(r=>({id:r.id}))]);
 await db.exec("insert into public.report_pipeline_settings(id,engine,jev_transport) values(true,'jev_sol_v2','batch_initial_v1') on conflict(id) do update set engine='jev_sol_v2',jev_transport='batch_initial_v1';update private.automatic_report_runtime set enabled=true;");
 return {...s,report};
}
async function fresh(n:number,negative=0){
 const ids=[];for(let i=0;i<n;i++){const id=crypto.randomUUID();ids.push(id);await q("insert into public.reviews(id,organization_id,establishment_id,external_review_id,rating,requires_attention,historical_import,original_text,published_at) values($1,$2,$3,$4,$5::smallint,$5::smallint<=3,true,null,clock_timestamp()-interval '1 hour'+$6*interval '1 second')",[id,org,est,'new-google-'+i,i<negative?3:5,i]);}return ids;
}
const counts=async()=> (await q<{v:{new_reviews:number;negative_reviews:number;threshold_met:boolean;reference_usable:boolean}}>("select private.report_refresh_counts($1,'vi') v",[est]))[0].v;
const triggerAuto=async()=> (await q<{v:string}>("select private.maybe_refresh_report($1,'vi') v",[est]))[0].v;
it.each([[2,2,false],[3,3,true],[24,2,false],[25,1,true],[25,0,true],[25,3,true],[8,3,true]])('automatic thresholds: %i new / %i low-star, including textless',async(n,neg,met)=>{
 await autoReference();await fresh(n,neg);expect(await counts()).toMatchObject({new_reviews:n,negative_reviews:neg,threshold_met:met});
 expect(await triggerAuto()).toBe(met?'enqueued':'below_threshold');
 expect((await q("select * from public.report_generation_requests where origin='automatic_thresholds'")).length).toBe(met?1:0);
 expect(await q('select * from public.analysis_jev_batch_tasks')).toHaveLength(0);
});
it('uses Google IDs across duplicate/internal-ID changes; text edits and identical reload are not new',async()=>{
 const s=await autoReference(2);await q('update public.reviews set id=$1,original_text=$2 where id=$3',[crypto.randomUUID(),'Changed',s.rows[0].id]);
 await q("insert into public.reviews(id,organization_id,establishment_id,external_review_id,rating,requires_attention,historical_import,published_at) values($1,$2,$3,$4,1,true,true,clock_timestamp()-interval '1 hour') on conflict(establishment_id,external_review_id) do nothing",[crypto.randomUUID(),org,est,s.rows[1].external_review_id]);
 expect(await counts()).toMatchObject({new_reviews:0,negative_reviews:0});
});
it('excludes novelty rotated out of the latest 150 before the trigger',async()=>{
 await autoReference(150);const ids=await fresh(25,2);await q("update public.reviews set published_at='2025-01-01' where id=$1",[ids[24]]);
 expect(await counts()).toMatchObject({new_reviews:24,negative_reviews:2,threshold_met:false});expect(await triggerAuto()).toBe('below_threshold');
});
it('manual and automatic share the same enqueue in both orders, including reconnect/double trigger',async()=>{
 await autoReference();await fresh(25,3);
 const a=await rpc<{id:string}>('enqueue_current_report',[est,org,actor,'vi',crypto.randomUUID(),'gpt-6.1-sol',8]);
 expect(await triggerAuto()).toBe('joined');expect(await triggerAuto()).toBe('already_authorized');
 const b=await rpc<{id:string}>('enqueue_current_report',[est,org,actor,'vi',crypto.randomUUID(),'gpt-6.1-sol',8]);expect(b.id).toBe(a.id);
 expect((await q("select * from public.historical_report_runs where status='queued'")).length).toBe(1);
});
it('a manual click joins an automatic request and retains pinned origin/version',async()=>{
 await autoReference();await fresh(25);expect(await triggerAuto()).toBe('enqueued');
 const a=(await q<{source_run_id:string}>("select * from public.report_generation_requests where origin='automatic_thresholds'"))[0];
 const b=await rpc<{id:string}>('enqueue_current_report',[est,org,actor,'vi',crypto.randomUUID(),'gpt-6.1-sol',8]);expect(b.id).toBe(a.source_run_id);
 expect(await q("select * from public.report_generation_requests where shared_jev_version='shared-jev-initial-v1' and origin='automatic_thresholds'")).toHaveLength(1);
});
it('failed or unknown automatic work keeps reference/counts and never authorizes a paid retry',async()=>{
 const s=await autoReference();await fresh(25);expect(await triggerAuto()).toBe('enqueued');
 await db.exec("update public.historical_report_runs set status='failed',error_code='REPORT_PREVIOUS_OUTCOME_UNCERTAIN' where status='queued'");
 expect(await triggerAuto()).toBe('already_authorized');expect(await counts()).toMatchObject({new_reviews:25});
 expect((await q<{report_id:string}>('select report_id from public.current_report_publications'))[0].report_id).toBe(s.report);
 const state=await rpc<{state:string}>('read_report_refresh_state',[est,'vi']);expect(state.state).toBe('failed');
});
it('publication covers only its frozen Google IDs and keeps arrivals during generation',async()=>{
 await autoReference();const first=await fresh(25);expect(await triggerAuto()).toBe('enqueued');
 const a=(await q<{source_run_id:string}>("select * from public.report_generation_requests where origin='automatic_thresholds'"))[0];
 const later=crypto.randomUUID();await q("insert into public.reviews(id,organization_id,establishment_id,external_review_id,rating,requires_attention,historical_import,published_at) values($1,$2,$3,'arrived-during-generation',1,true,true,clock_timestamp())",[later,org,est]);
 const bindings=(await q<{id:string;external_review_id:string}>('select id,external_review_id from public.reviews where id<>$1',[later])).map(r=>({id:r.id,google_review_id_sha256:null}));
 await q("update public.current_report_publications set report_id=$1,source_run_id=$2,scope=jsonb_set(scope,'{review_count}',to_jsonb($3::int)),source_bindings=$4,stale=true,stale_reason='CORPUS_CHANGED'",[crypto.randomUUID(),a.source_run_id,bindings.length,bindings]);
 expect(first).toHaveLength(25);expect(await counts()).toMatchObject({new_reviews:1,negative_reviews:1});
 await q("update public.historical_report_runs set status='completed' where id=$1",[a.source_run_id]);expect(await triggerAuto()).toBe('below_threshold');
});
it('enqueues remaining threshold arrivals only after the published source closes, once',async()=>{
 await autoReference();const first=await fresh(25);expect(await triggerAuto()).toBe('enqueued');
 const a=(await q<{source_run_id:string}>("select source_run_id from public.report_generation_requests where origin='automatic_thresholds'"))[0];
 const bindings=await q<{id:string}>('select id from public.reviews');
 for(let i=0;i<25;i++)await q("insert into public.reviews(id,organization_id,establishment_id,external_review_id,rating,published_at) values($1,$2,$3,$4,5,clock_timestamp())",[crypto.randomUUID(),org,est,'later-'+i]);
 await q("update public.current_report_publications set report_id=$1,source_run_id=$2,scope=jsonb_set(scope,'{review_count}',to_jsonb($3::int)),source_bindings=$4",[crypto.randomUUID(),a.source_run_id,bindings.length,bindings]);
 expect(first).toHaveLength(25);expect(await counts()).toMatchObject({new_reviews:25});
 expect(await q("select * from public.historical_report_runs where status='queued'")).toHaveLength(1);
 await q("update public.historical_report_runs set status='completed' where id=$1",[a.source_run_id]);
 expect(await q("select * from public.historical_report_runs where status='queued'")).toHaveLength(1);
 expect(await q("select * from public.report_generation_requests where origin='automatic_thresholds'")).toHaveLength(2);
 expect(await triggerAuto()).toBe('already_authorized');
});
it('no usable reference, purged reference, or missing Google identity keeps first generation manual',async()=>{
 await db.exec('update private.automatic_report_runtime set enabled=true');await fresh(25,3);expect(await triggerAuto()).toBe('manual_reference_required');
 await autoReference(2);await q("update private.report_review_coverage set usable=false,missing_ids=1");expect(await triggerAuto()).toBe('manual_reference_required');
 await db.exec('delete from public.current_report_publications');expect(await triggerAuto()).toBe('manual_reference_required');
 expect(await q("select * from public.report_generation_requests where origin='automatic_thresholds'")).toHaveLength(0);
});
it('read state has no enqueue/dispatch and private counters are inaccessible to browser roles',async()=>{
 await autoReference();await fresh(25);const before=await q('select * from public.test_dispatch');await rpc('read_report_refresh_state',[est,'vi']);expect(await q('select * from public.test_dispatch')).toEqual(before);
 const grants=await q<{v:boolean}>("select has_function_privilege('authenticated','public.read_report_refresh_state(uuid,text)','execute') v");expect(grants[0].v).toBe(false);
 await db.exec('set local role authenticated');await expect(rpc('read_report_refresh_state',[est,'vi'])).rejects.toThrow();
});
it('coalesces unplanned same-language sync comments without delaying a lone comment or overwriting a racing preparation',async()=>{
 await autoReference(2);const ids=await fresh(3);await q("update public.reviews set original_text='Synthetic new comment',original_language='vi' where id=any($1)",[ids]);
 const job=async(slice:string[],language='vi')=>{const id=crypto.randomUUID();await q("insert into public.review_sync_jobs(id,organization_id,establishment_id,status,collection_language) values($1,$2,$3,'completed',$4)",[id,org,est,language]);return (await q<{id:string}>('select private.enqueue_new_review_jev($1,$2) id',[id,slice]))[0].id;};
 const first=await job(ids.slice(0,1));const [old]=await q<{snapshot:Parameters<typeof automaticJevSnapshot>[0];snapshot_sha256:string}>('select snapshot,snapshot_sha256 from public.analysis_jev_batch_runs where id=$1',[first]);
 expect(await job(ids.slice(1))).toBe(first);
 const before=await automaticJevSnapshot(old.snapshot);expect(await rpc('jev_shared_normalize_auto',[first,before,await directHash(before),old.snapshot_sha256])).toBe(false);
 const [merged]=await q<{snapshot:Parameters<typeof automaticJevSnapshot>[0];snapshot_sha256:string}>('select snapshot,snapshot_sha256 from public.analysis_jev_batch_runs where id=$1',[first]);expect(merged.snapshot.reviews).toHaveLength(3);
 const normalized=await automaticJevSnapshot(merged.snapshot);expect(await rpc('jev_shared_normalize_auto',[first,normalized,await directHash(normalized),merged.snapshot_sha256])).toBe(true);
 expect(await job([ids[0]],'fr')).not.toBe(first);expect(await q('select * from public.analysis_jev_batch_tasks')).toHaveLength(0);
});
it('plans a single available textual comment immediately with the unchanged native batch planner',async()=>{
 const auto=await source(1,'auto');const refs=await allocate(auto);expect(sharedMissingIds(refs)).toEqual([auto.rows[0].id]);
 const plans=await sharedBatchPlans(auto.rows.map(r=>({review_id:r.id,text:r.analysis_text})),()=>100);expect(plans).toHaveLength(1);expect(plans[0].reviews).toBe(1);
 expect(await rpc('jev_shared_plan_auto',[auto.id,plans])).toBe(true);expect(await rpc('jev_batch_claim_sol',[auto.id,'forbidden'])).toBe(false);
});
it('does not automatically authorize a report in a departed account language or after removal of authority',async()=>{
 await autoReference();await fresh(25);await q("update public.profiles set preferred_language='fr'");expect(await triggerAuto()).toBe('not_eligible');
 await q("update public.profiles set preferred_language='vi'");await db.exec('delete from public.organization_members');expect(await triggerAuto()).toBe('not_eligible');
 expect(await q('select * from private.automatic_report_attempts')).toHaveLength(0);
});
async function source(n=4,mode='manual'){
 const rows=await Promise.all(Array.from({length:n},async(_,i)=>({id:crypto.randomUUID(),google_review_id:'google-'+i,organization_id:org,establishment_id:est,
  analysis_text:'Original '+i,original_text:'Original '+i,original_language:'vi',external_review_id:'google-'+i,rating:i%5+1,review_context:null,review_detailed_rating:null,published_at:null,
  analysis_text_sha256:await analysisTextSha256('Original '+i),analysis_language:'vi',analysis_source:'original_target',translation_provenance:{}})));
 const id=crypto.randomUUID(),snapshot={reviews:rows},hash=await directHash(snapshot);
 if(mode==='manual'){
  await q("insert into public.historical_report_runs(id,organization_id,establishment_id,language,status,created_at) values($1,$2,$3,'vi','running',clock_timestamp())",[id,org,est]);
  await q("insert into public.report_corpus_scopes(source_run_id,organization_id,establishment_id,policy_epoch,review_count,review_ids,fingerprint) select $1,$2,$3,epoch,$4,$5,'fixture' from public.review_corpus_policy",[id,org,est,n,rows.map(r=>r.id)]);
  await q("insert into public.report_generation_requests(id,organization_id,establishment_id,authority_user_id,language,engine,jev_transport,source_run_id) values($1,$2,$3,$4,'vi','jev_sol_v2','batch_initial_v1',$5)",[crypto.randomUUID(),org,est,actor,id]);
  await q('insert into public.analysis_parallel_launch_preparations(id,current_source_run_id,body,sha256) values($1,$2,$3,$4)',[crypto.randomUUID(),id,{source_snapshot:snapshot},hash]);
 }else{
  await q("insert into public.analysis_jev_batch_runs(id,organization_id,establishment_id,purpose,shared_jev_version,policy_epoch,sync_job_id,stage,status,armed,expires_at,snapshot,snapshot_sha256,template,manifest,manifest_sha256,source_manifest_sha256,authorization_evidence,max_new_jev_calls) select $1,$2,$3,'new_reviews',$4,epoch,$5,'auto_plan','running',true,clock_timestamp()+interval '24 hours',$6,$7,'{}','{}',$8,$8,'local simulation',0 from public.review_corpus_policy",[id,org,est,SHARED_JEV_VERSION,crypto.randomUUID(),snapshot,hash,await directHash({})]);
 }
 return {id,rows,snapshot};
}
async function allocate(s:Awaited<ReturnType<typeof source>>){return await rpc<{review_id:string;owned:boolean;state:string;task_id:string|null}[]>('jev_shared_allocate',[s.id,await sharedJevIdentities(s.rows)]);}
async function manualQueue(s:Awaited<ReturnType<typeof source>>){
 const [{generation_id}]=await q<{generation_id:string}>('select generation_id from public.historical_report_runs where id=$1',[s.id]);
 const [{id:request_id}]=await q<{id:string}>('select id from public.report_generation_requests where source_run_id=$1',[s.id]);
 const job={id:s.id,generation_id,organization_id:org,establishment_id:est,engine:'jev_sol_v2',shared_jev_version:SHARED_JEV_VERSION,request_id,requested_by:actor,language:'vi',
  evidence_selector_version:MIXED_SELECTOR_VERSION,evidence_selector_sha256:(await evidenceSelectorBinding(MIXED_SELECTOR_VERSION)).sha256,
  snapshot:{reviews:s.rows,base:{organization_id:org,establishment_id:est,stored_reviews_count:s.rows.length,source_fingerprint:'fixture'}}} as unknown as HistoricalJob;
 const p=await currentReportProtocol(job);await q('update public.analysis_parallel_launch_preparations set body=$1,sha256=$2 where current_source_run_id=$3',[p.body,p.sha256,s.id]);
 const a=await allocate(s),m=await currentBatchManifest(p,()=>100,{missing_ids:sharedMissingIds(a)});
 return {run:await rpc<string>('jev_batch_create_current',[s.id,m.body,m.sha256]),manifest:m};
}
it('installs without enqueuing work or modifying any supplier receipt',async()=>{
 expect(await q('select * from public.test_dispatch')).toEqual([]);expect(await q('select * from private.shared_jev_analyses')).toEqual([]);
 for(const role of ['anon','authenticated'])for(const fn of ['jev_shared_allocate(uuid,jsonb)','jev_shared_read(uuid)','jev_shared_progress(uuid)','jev_shared_plan_auto(uuid,jsonb)','jev_shared_refresh(uuid)'])expect((await q('select has_function_privilege($1,$2,\'execute\') ok',[role,'public.'+fn]))[0].ok).toBe(false);
});
it('146 saved plus 4 new analyses plans exactly four; all saved plans zero',async()=>{
 const s=await source(150),a=await allocate(s);expect(sharedMissingIds(a)).toHaveLength(150);
 // Explicit simulation of validated native saved classifications, not quality proof.
 await q("update private.shared_jev_analyses set state='ready',result='{}',result_sha256=public.jls_restaurant_hash('{}') where google_review_id not in('google-146','google-147','google-148','google-149')");
 expect(sharedMissingIds(await allocate(s))).toHaveLength(4);
 await q("update private.shared_jev_analyses set state='ready',result='{}',result_sha256=public.jls_restaurant_hash('{}')");
 expect(sharedMissingIds(await allocate(s))).toEqual([]);
 expect(await rpc('jev_shared_progress',[s.id])).toEqual({completed_reviews:150,total_reviews:150,unknown_reviews:0,failed_reviews:0});
});
it('coordinates automatic/manual consumers on the same Google IDs without a second owner',async()=>{
 const auto=await source(4,'auto');expect(sharedMissingIds(await allocate(auto))).toHaveLength(4);
 const manual=await source(4);expect(sharedMissingIds(await allocate(manual))).toEqual([]);
 expect((await q('select count(*)::int n from private.shared_jev_analyses'))[0].n).toBe(4);
 const plans=await sharedBatchPlans(auto.rows.map(r=>({review_id:r.id,text:r.analysis_text})),()=>100);
 expect(await rpc('jev_shared_plan_auto',[auto.id,plans])).toBe(true);
 expect(await rpc('jev_shared_plan_auto',[auto.id,plans])).toBe(true);
 expect((await q('select count(*)::int n from public.analysis_jev_batch_tasks'))[0].n).toBe(1);
 expect(await rpc('jev_batch_claim_sol',[auto.id,'worker'])).toBe(false);
});
it('unknown or failed attempts block future consumers and are not silently submitted again',async()=>{
 const first=await source();await allocate(first);await q("update private.shared_jev_analyses set state='unknown'");
 const second=await source();expect(()=>sharedMissingIds([])).not.toThrow();
 expect(()=>sharedMissingIds([])).not.toThrow();const rows=await allocate(second);expect(()=>sharedMissingIds(rows)).toThrow('SHARED_JEV_PREVIOUS_ATTEMPT_BLOCKED');
 expect(await q('select * from public.analysis_jev_batch_tasks')).toEqual([]);
});
it('keeps an active frozen generation valid across rotation, but rejects a reload barrier',async()=>{
 const s=await source();await allocate(s);await q("update public.report_corpus_scopes set stale=true,stale_reason='CORPUS_CHANGED'");
 expect((await q('select private.shared_jev_frozen_allowed($1) ok',[s.id]))[0].ok).toBe(true);
 expect((await q("select private.retention_retire_source($1,'CORPUS_REVIEW_REMOVED') ok",[s.id]))[0].ok).toBe(false);
 await q("update public.establishments set review_reload_barrier_at=clock_timestamp()+interval '1 second' where id=$1",[est]);
 await expect(allocate(s)).rejects.toThrow('SHARED_JEV_CONSUMER_OBSOLETE');
});
it('uses only text and exact source-language policy, with Google translations but no internal translation',async()=>{
 const raw={organization_id:org,establishment_id:est,language:'fr' as const,reviews:[{id:crypto.randomUUID(),external_review_id:'en',original_text:'Good',original_language:'en',review_translations:[{language:'fr',translated_text:'Bien',source_text_sha256:await analysisTextSha256('Good')}]},{id:crypto.randomUUID(),external_review_id:'empty',original_text:null,text:null}]};
 const s=await automaticJevSnapshot(raw);expect(s.reviews).toHaveLength(1);expect(s.reviews[0].analysis_text).toBe('Bien');expect(s.reviews[0].analysis_language).toBe('fr');
});
it('manual full queue creates zero native tasks when all compatible classifications are saved',async()=>{
 const s=await source();await allocate(s);await q("update private.shared_jev_analyses set state='ready',result='{}',result_sha256=public.jls_restaurant_hash('{}')");
 const {run,manifest}=await manualQueue(s);expect(manifest.body.plans).toHaveLength(0);
 expect(await q('select stage,max_new_jev_calls from public.analysis_jev_batch_runs where id=$1',[run])).toEqual([{stage:'prepare_evidence',max_new_jev_calls:0}]);
 expect(await q('select * from public.analysis_jev_batch_tasks')).toEqual([]);
 expect(await rpc('jev_batch_create_current',[s.id,manifest.body,manifest.sha256])).toBe(run);
});
it('automatic producer completes saved native projection, wakes manual consumer, and never creates a report itself',async()=>{
 const auto=await source(4,'auto');await allocate(auto);await rpc('jev_shared_plan_auto',[auto.id,await sharedBatchPlans(auto.rows.map(r=>({review_id:r.id,text:r.analysis_text})),()=>100)]);
 const manual=await source(4),{run:manualRun}=await manualQueue(manual);
 expect(await q('select stage from public.analysis_jev_batch_runs where id=$1',[manualRun])).toEqual([{stage:'shared_wait'}]);
 expect((await q('select count(*)::int n from public.analysis_parallel_reports'))[0].n).toBe(1);
 const t=await rpc<BatchTask>('jev_batch_claim',[auto.id,'worker']);expect(t.status).toBe('reserved');
 expect(await rpc('jev_batch_claim',[auto.id,'worker-duplicate'])).toBeNull();
 const raw=JSON.stringify(mockBatchJevResponse(JSON.parse(t.request_wire))),receipt={request_sha256:t.request_sha256,http_status:200,error:null,raw_response_text:raw,raw_response_sha256:await analysisTextSha256(raw),served_model:'jev-1.13.0',usage:{input_tokens:101,output_tokens:202},duration_ms:3};
 expect(await rpc('jev_batch_receive',[t.id,'worker',receipt,await directHash(receipt)])).toBe(true);
 const received=await rpc<BatchTask>('jev_batch_claim',[auto.id,'projector']),[br]=await q<BatchRun>('select * from public.analysis_jev_batch_runs where id=$1',[auto.id]);
 const projection=await validateBatchTask(br,received);
 expect(await rpc('jev_batch_save_projection',[t.id,'projector',projection,await directHash(projection),null])).toBe(true);
 expect(await rpc('jev_batch_save_projection',[t.id,'projector',projection,await directHash(projection),null])).toBe(true);
 expect(await q('select status,armed,sol_request_count from public.analysis_jev_batch_runs where id=$1',[auto.id])).toEqual([{status:'completed',armed:false,sol_request_count:0}]);
 expect(await q('select stage from public.analysis_jev_batch_runs where id=$1',[manualRun])).toEqual([{stage:'prepare_evidence'}]);
 expect((await rpc<{state:string}[]>('jev_shared_read',[manual.id])).every(x=>x.state==='ready')).toBe(true);
 expect((await q('select sum(request_count)::int n from public.analysis_jev_batch_tasks'))[0].n).toBe(1);
});
it('manual wins the same identity first; automatic then waits without creating native tasks',async()=>{
 const manual=await source(4),{run}=await manualQueue(manual);const auto=await source(4,'auto');
 expect(sharedMissingIds(await allocate(auto))).toEqual([]);expect(await rpc('jev_shared_plan_auto',[auto.id,[]])).toBe(true);
 expect(await q('select stage,max_new_jev_calls from public.analysis_jev_batch_runs where id=$1',[auto.id])).toEqual([{stage:'shared_wait',max_new_jev_calls:0}]);
 expect((await q('select count(*)::int n from public.analysis_jev_batch_tasks where run_id=$1',[run]))[0].n).toBe(1);
 expect((await q('select count(*)::int n from public.analysis_jev_batch_tasks'))[0].n).toBe(1);
});
it('records an unknown attempt once; late saved response can be validated without rearming or republishing',async()=>{
 const auto=await source(2,'auto');await allocate(auto);await rpc('jev_shared_plan_auto',[auto.id,await sharedBatchPlans(auto.rows.map(r=>({review_id:r.id,text:r.analysis_text})),()=>100)]);
 const t=await rpc<BatchTask>('jev_batch_claim',[auto.id,'worker']);
 await q("update public.analysis_jev_batch_tasks set lease_until=now()-interval '1 minute' where id=$1",[t.id]);
 expect(await rpc('jev_batch_claim',[auto.id,'duplicate'])).toBeNull();await rpc('jev_shared_refresh',[auto.id]);
 expect((await q('select state from private.shared_jev_analyses')).every(x=>x.state==='unknown')).toBe(true);
 const raw=JSON.stringify(mockBatchJevResponse(JSON.parse(t.request_wire))),receipt={request_sha256:t.request_sha256,http_status:200,error:null,raw_response_text:raw,raw_response_sha256:await analysisTextSha256(raw),served_model:'jev-1.13.0',usage:{input_tokens:101,output_tokens:202},duration_ms:3};
 expect(await rpc('jev_batch_receive',[t.id,'worker',receipt,await directHash(receipt)])).toBe(true);
 const received=await rpc<BatchTask>('jev_shared_claim_saved',[auto.id,'late-projector']),[br]=await q<BatchRun>('select * from public.analysis_jev_batch_runs where id=$1',[auto.id]);
 const projection=await validateBatchTask(br,received);await rpc('jev_batch_save_projection',[t.id,'late-projector',projection,await directHash(projection),null]);
 expect((await q('select state from private.shared_jev_analyses')).every(x=>x.state==='ready')).toBe(true);
 expect(await q('select status,armed,sol_request_count from public.analysis_jev_batch_runs where id=$1',[auto.id])).toEqual([{status:'blocked',armed:false,sol_request_count:0}]);
 expect(await q('select request_count from public.analysis_jev_batch_tasks')).toEqual([{request_count:1}]);expect(await q('select * from public.analysis_parallel_reports')).toEqual([]);
});
it('queues only newly saved text on a successful sync and normalizes it before native planning',async()=>{
 const ids=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()],job=crypto.randomUUID();
 await q("insert into public.review_sync_jobs(id,organization_id,establishment_id,status,collection_language) values($1,$2,$3,'completed','fr')",[job,org,est]);
 for(const [i,id] of ids.entries())await q('insert into public.reviews(id,organization_id,establishment_id,external_review_id,rating,requires_attention,requires_ai_analysis,original_text,original_language,published_at) values($1,$2,$3,$4,$5,true,true,$6,\'en\',clock_timestamp())',[id,org,est,'external-'+i,i+1,i===2?'':'Good '+i]);
 const [queued]=await q<{id:string}>('select private.enqueue_new_review_jev($1,$2) id',[job,ids]);
 expect(queued.id).toBeTruthy();expect(await q('select * from public.analysis_parallel_reports')).toEqual([]);
 const [b]=await q<{snapshot:Parameters<typeof automaticJevSnapshot>[0]}>('select snapshot from public.analysis_jev_batch_runs where id=$1',[queued.id]);
 expect(b.snapshot.reviews).toHaveLength(2);
 const normalized=await automaticJevSnapshot(b.snapshot);expect(await rpc('jev_shared_normalize_auto',[queued.id,normalized,await directHash(normalized)])).toBe(true);
 const refs=await sharedJevIdentities(normalized.reviews);expect(await rpc('jev_shared_allocate',[queued.id,refs])).toHaveLength(2);
 const plans=await sharedBatchPlans(normalized.reviews.map(r=>({review_id:r.id,text:r.analysis_text})),()=>100);
 expect(await rpc('jev_shared_plan_auto',[queued.id,plans])).toBe(true);
 await q('select private.enqueue_new_review_jev($1,$2)',[job,ids]);expect((await q('select count(*)::int n from public.analysis_jev_batch_runs'))[0].n).toBe(1);
 expect((await q('select count(*)::int n from public.reviews'))[0].n).toBe(3);
});
it('a partial native result fails all consumers without changing existing classifications or retrying',async()=>{
 const auto=await source(4,'auto');await allocate(auto);await rpc('jev_shared_plan_auto',[auto.id,await sharedBatchPlans(auto.rows.map(r=>({review_id:r.id,text:r.analysis_text})),()=>100)]);
 const t=await rpc<BatchTask>('jev_batch_claim',[auto.id,'worker']),receipt={request_sha256:t.request_sha256,raw_response_text:'{}',http_status:200};
 await rpc('jev_batch_receive',[t.id,'worker',receipt,await directHash(receipt)]);
 const received=await rpc<BatchTask>('jev_batch_claim',[auto.id,'validator']);
 expect(received.id).toBe(t.id);await rpc('jev_batch_save_projection',[t.id,'validator',{error_code:'BATCH_INCOMPLETE'},await directHash({error_code:'BATCH_INCOMPLETE'}),'BATCH_INCOMPLETE']);
 expect((await q('select state from private.shared_jev_analyses')).every(x=>x.state==='failed')).toBe(true);
 expect(await rpc('jev_batch_claim',[auto.id,'retry'])).toBeNull();expect(await rpc('jev_batch_claim_sol',[auto.id,'sol'])).toBe(false);
 expect(await q('select request_count from public.analysis_jev_batch_tasks')).toEqual([{request_count:1}]);
});
it('invalidates just changed review inputs and pins the feature choice across a future setting change',async()=>{
 const s=await source(4);await allocate(s);const changed=await source(4);changed.rows[1].analysis_text+=' edited';changed.rows[1].analysis_text_sha256=await analysisTextSha256(changed.rows[1].analysis_text);
 changed.rows[2].analysis_language='fr';await q('update public.analysis_parallel_launch_preparations set body=$1 where current_source_run_id=$2',[{source_snapshot:{reviews:changed.rows}},changed.id]);
 const a=await allocate(changed);expect(sharedMissingIds(a)).toHaveLength(2);expect((await q('select count(*)::int n from private.shared_jev_analyses'))[0].n).toBe(6);
 await q('update private.shared_jev_runtime set enabled=false');expect((await q('select shared_jev_version from public.report_generation_requests where source_run_id=$1',[s.id]))[0].shared_jev_version).toBe(SHARED_JEV_VERSION);
});
it('retains a dated publication on a changed corpus and refuses publication across a reset epoch',async()=>{
 const s=await source(),[scope]=await q('select * from public.report_corpus_scopes where source_run_id=$1',[s.id]);
 const now=new Date().toISOString(),report={id:crypto.randomUUID(),state:'completed',controls:{technical_checks_passed:true,evidence:[]},derived_report:{report:{categories:[],positive_aspects:[],negative_aspects:[],recommendations:[]}},
  generated_at:now,created_at:now,current_source_run_id:s.id,organization_id:org,establishment_id:est,language:'vi',configuration_version:'jev-multi-review-initial-v1',source_reviews:s.rows,statistics:{scope:{source_reviews:4}},source_report:{},usage:{}};
 await q("update public.report_corpus_scopes set stale=true,stale_reason='CORPUS_CHANGED' where source_run_id=$1",[s.id]);
 expect((await q('select private.store_current_report_publication($1,$2,$3,false) ok',[report,{...scope,stale:true},now]))[0].ok).toBe(true);
 const before=await q('select report_id,stale,document,source_bindings from public.current_report_publications');expect(before[0].stale).toBe(true);
 await q('update public.review_corpus_policy set epoch=gen_random_uuid()');
 expect((await q('select private.store_current_report_publication($1,$2,$3,false) ok',[{...report,id:crypto.randomUUID()},scope,now]))[0].ok).toBe(false);
 expect(await q('select report_id,stale,document,source_bindings from public.current_report_publications')).toEqual(before);
});
it('expires temporary automatic input and retains a content-free unknown-attempt fence and native ledger',async()=>{
 const auto=await source(2,'auto');await allocate(auto);await rpc('jev_shared_plan_auto',[auto.id,await sharedBatchPlans(auto.rows.map(r=>({review_id:r.id,text:r.analysis_text})),()=>100)]);
 const t=await rpc<BatchTask>('jev_batch_claim',[auto.id,'worker']);await q("update public.analysis_jev_batch_tasks set status='unknown',lease_until=now()-interval '1 minute' where id=$1",[t.id]);await rpc('jev_shared_refresh',[auto.id]);
 // Explicit offline clock jump, not a production escape hatch.
 await db.exec('reset role;alter table public.analysis_jev_batch_runs disable trigger batch_frozen');
 await q("update public.analysis_jev_batch_runs set expires_at=clock_timestamp()-interval '1 minute' where id=$1",[auto.id]);
 await db.exec('alter table public.analysis_jev_batch_runs enable trigger batch_frozen;set local role service_role');
 await q('select private.cleanup_shared_jev()');
 expect(await q('select * from public.analysis_jev_batch_runs')).toEqual([]);expect(await q('select * from public.analysis_jev_batch_tasks')).toEqual([]);
 expect((await q('select state,result from private.shared_jev_analyses')).every(x=>x.state==='unknown'&&x.result===null)).toBe(true);
 const ledger=await q('select * from private.provider_attempt_ledger');expect(ledger).toHaveLength(1);expect(ledger[0].attempts).toBe(1);expect(ledger[0].outcome).toBe('unknown');
 expect(JSON.stringify(ledger)).not.toContain('Original');
});
it('the real publication triggers permit a pinned rotated corpus, mark it dated/stale and complete its source',async()=>{
 const s=await source();await allocate(s);await q("update private.shared_jev_analyses set state='ready',result='{}',result_sha256=public.jls_restaurant_hash('{}')");
 const {run}=await manualQueue(s);await q("update public.report_corpus_scopes set stale=true,stale_reason='CORPUS_CHANGED' where source_run_id=$1",[s.id]);
 await q("update public.analysis_parallel_reports set state='completed',generated_at=clock_timestamp(),controls='{\"technical_checks_passed\":true,\"evidence\":[]}',derived_report='{\"report\":{\"categories\":[],\"positive_aspects\":[],\"negative_aspects\":[],\"recommendations\":[]}}' where id=(select report_id from public.analysis_jev_batch_runs where id=$1)",[run]);
 expect(await q('select state from public.analysis_parallel_reports')).toEqual([{state:'completed'}]);
 expect(await q('select status from public.historical_report_runs where id=$1',[s.id])).toEqual([{status:'completed'}]);
 expect(await q('select stale from public.current_report_publications')).toEqual([{stale:true}]);
 expect((await q('select jsonb_array_length(source_bindings) n from public.current_report_publications'))[0].n).toBe(4);
});
it('preserves provably compatible legacy native results before disposable-source retirement',async()=>{
 const s=await source(4),{run}=await manualQueue(s),t=await rpc<BatchTask>('jev_batch_claim',[run,'worker']);
 const raw=JSON.stringify(mockBatchJevResponse(JSON.parse(t.request_wire))),receipt={request_sha256:t.request_sha256,http_status:200,error:null,raw_response_text:raw,raw_response_sha256:await analysisTextSha256(raw),served_model:'jev-1.13.0',usage:{input_tokens:101,output_tokens:202}};
 await rpc('jev_batch_receive',[t.id,'worker',receipt,await directHash(receipt)]);
 const received=await rpc<BatchTask>('jev_batch_claim',[run,'projector']),[br]=await q<BatchRun>('select * from public.analysis_jev_batch_runs where id=$1',[run]),projection=await validateBatchTask(br,received);
 await rpc('jev_batch_save_projection',[t.id,'projector',projection,await directHash(projection),null]);
 // Simulate an existing pre-feature projection: only the shared index is absent.
 await q('delete from private.shared_jev_analyses');
 for(const r of s.rows)await q("insert into public.reviews(id,organization_id,establishment_id,external_review_id,rating,requires_attention,historical_import,original_text,original_language,published_at) values($1,$2,$3,$4,$5,$6,true,$7,'vi',clock_timestamp())",[r.id,org,est,r.google_review_id,r.rating,r.rating<=3,r.original_text]);
 await q('select private.preserve_retiring_shared_jev($1)',[s.id]);
 expect((await q('select state,source_review_id from private.shared_jev_analyses')).every(x=>x.state==='ready'&&s.rows.some(r=>r.id===x.source_review_id))).toBe(true);
 const next=await source(4);expect(sharedMissingIds(await allocate(next))).toEqual([]);
 expect((await q('select count(*)::int n from public.analysis_jev_batch_tasks'))[0].n).toBe(1);
});
