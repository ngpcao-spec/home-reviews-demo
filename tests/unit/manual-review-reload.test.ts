// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {prepareNativeLanguage} from '../fixtures/prepare-native-language';
import {prepareManualReviewReload} from '../../supabase/functions/_shared/manual-review-reload';
const fixture=JSON.parse(readFileSync('tests/fixtures/retention-production-definitions.json','utf8'));
let db:PGlite;
const org='10000000-0000-4000-8000-000000000001',est='20000000-0000-4000-8000-000000000001',user='30000000-0000-4000-8000-000000000001';
const other='20000000-0000-4000-8000-000000000002';
const migration=(suffix:string)=>readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith(suffix)),'utf8');
beforeAll(async()=>{ db=new PGlite({extensions:{pgcrypto}});await db.waitReady;
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.uid() returns uuid language sql as $$select null::uuid$$;create schema private;create schema extensions;create extension pgcrypto with schema extensions;create schema cron;create table cron.job(jobid bigint,jobname text,active boolean);create function cron.alter_job(bigint,active boolean) returns void language sql as $$update cron.job set active=$2 where jobid=$1$$;`);
 await db.exec("set search_path=public,extensions;set timezone='UTC'");
 const tables=new Map<string,typeof fixture.columns>();
 for(const c of fixture.columns){const key=c.schema+'.'+c.table;if(!tables.has(key))tables.set(key,[]);tables.get(key)!.push(c);}
 for(const [key,cols] of tables)await db.exec('create table '+key+'('+cols.map((c:{column:string,type:string,default:string|null})=>'"'+c.column+'" '+c.type+(c.default?' default '+c.default:'')).join(',')+')');
 for(const c of fixture.constraints){const key=c.table.includes('.')?c.table:'public.'+c.table;if(tables.has(key)&&/^(PRIMARY KEY|UNIQUE)/.test(c.definition))await db.exec('alter table '+key+' add constraint "'+c.name+'" '+c.definition);}
 // Parent identities remain outside the purge scope in production.
 await db.exec('create table if not exists public.organizations(id uuid primary key);grant usage on schema private,extensions to service_role;grant all on all tables in schema public,private to service_role;grant select on public.organization_members to authenticated;');
 for(const f of fixture.functions.filter((f:{proname:string})=>['enqueue_current_report','jev_batch_claim','jev_batch_claim_sol'].includes(f.proname)))await db.exec(f.definition);
 const guards=JSON.parse(readFileSync('tests/fixtures/retention-delete-guards.json','utf8'));
 for(const f of new Map(guards.map((g:{schema:string;proname:string;definition:string})=>[g.schema+'.'+g.proname,g.definition])).values())await db.exec(f as string);
 for(const t of guards)await db.exec(t.trigger_definition);
 await db.exec("create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin insert into cron.job values(999,$1,true);return 999;end $$");
 for(const suffix of ['_recent_text_retention_transition.sql','_recent_text_retention_policy.sql','_recent_text_retention_safety.sql','_recent_text_source_guard.sql','_recent_text_rebuild_barrier.sql','_recent_text_ingestion_dedup.sql','_recent_text_native_usage.sql','_recent_text_superseded_cleanup.sql'])await db.exec(readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith(suffix)),'utf8'));
 for(const [file,name] of [['20261010080134_jev_economy_preparation.sql','jev_economy_canonical'],['20261014160258_jls_restaurant_delegated_preparation.sql','jls_restaurant_hash']]){
  const sql=readFileSync('supabase/migrations/'+file,'utf8');await db.exec(sql.slice(sql.indexOf('create function public.'+name),sql.indexOf('$$;',sql.indexOf('create function public.'+name))+3));
 }
 await db.exec(readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith('_recover_compact_saved_references.sql')),'utf8'));
 const finishSql=readFileSync('supabase/migrations/20261024080230_current_jev_batch_transport.sql','utf8'),finishStart=finishSql.indexOf('create or replace function public.jev_batch_finish(');
 await db.exec(finishSql.slice(finishStart,finishSql.indexOf('$$;',finishStart)+3));
 await db.exec(readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith('_current_report_publications.sql')),'utf8'));
 await db.exec(readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith('_finalize_report_publication_safety.sql')),'utf8'));
 await db.exec(readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith('_report_metadata_staleness.sql')),'utf8'));
 await db.exec(`update public.review_corpus_policy set enabled=true,paused=false,ingestions_paused=false;insert into public.organizations values('${org}');insert into public.establishments(id,organization_id,name,google_id,google_maps_url) values('${est}','${org}','Fixture','fixture','fixture');insert into public.organization_members(organization_id,user_id,role) values('${org}','${user}','owner');insert into public.report_pipeline_settings(id,engine,jev_transport) values(true,'jev_sol_v2','batch_initial_v1') on conflict(id) do update set engine=excluded.engine,jev_transport=excluded.jev_transport;`);

 await prepareNativeLanguage(db,user);
 const initial=JSON.parse(readFileSync('tests/fixtures/initial-import-functions.json','utf8'));
 for(const c of initial.columns)await db.exec('alter table public.initial_import_jobs add column if not exists "'+c.name+'" '+c.type+(c.default?' default '+c.default:''));
 for(const f of initial.functions)await db.exec(f.definition);
 await db.exec(`create schema net;create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);insert into vault.decrypted_secrets values('home_reviews_scheduler_token','SYNTHETIC');
 create table private.fake_net_calls(id bigint generated always as identity,url text,body jsonb);
 create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 1000) returns bigint language plpgsql as $$declare rid bigint;begin insert into private.fake_net_calls(url,body) values(url,body) returning id into rid;return rid;end$$;
 create function public.review_sync_spread_offset(uuid,integer) returns interval language sql as $$select interval '0 seconds'$$;
 create function private.notify_initial_import_completed() returns trigger language plpgsql as $$begin return new;end$$;
 create trigger initial_import_completion_notification after update of status on public.initial_import_jobs for each row execute function private.notify_initial_import_completed();`);
 await db.exec(migration('_initial_import_immediate_continuation.sql').replaceAll('add column ', 'add column if not exists '));
 await db.exec(migration('_review_collection_coverage_and_manual_retry.sql'));
 const additional=JSON.parse(readFileSync('tests/fixtures/manual-reload-schema.json','utf8'));
 for(const table of new Set(additional.columns.map((c:{table:string})=>c.table))){
  const cols=additional.columns.filter((c:{table:string})=>c.table===table);
  await db.exec('create table if not exists private.'+table+'('+cols.map((c:{column:string,type:string,default:string|null})=>'"'+c.column+'" '+c.type+(c.default?' default '+c.default:'')).join(',')+')');
 }
 await db.exec('alter table public.establishments add column if not exists place_id text;alter table public.organizations add column if not exists monitoring_interval_hours integer default 12;');
 await db.exec('create table public.restaurant_recommendation_sheets(establishment_id uuid,language text);create table public.review_display_texts(review_id uuid)');
 for(const table of ['review_translations','review_provider_payloads','review_reply_drafts','review_display_texts','notifications']) await db.exec('alter table public.'+table+' add constraint reload_'+table+'_fk foreign key(review_id) references public.reviews(id) on delete cascade');
 await db.exec(migration('_manual_atomic_review_reload.sql'));
 const production=JSON.parse(readFileSync('tests/fixtures/review-reload-production-guards.json','utf8'));
 for(const c of production.checks){
  await db.exec('alter table public.reviews drop constraint if exists "'+c.name+'"');
  await db.exec('alter table public.reviews add constraint "'+c.name+'" '+c.definition);
 }
 await db.exec("create table if not exists public.ai_webhook_config(singleton boolean,secret text);insert into public.ai_webhook_config values(true,'SYNTHETIC');");
 await db.exec(production.aiTrigger.body);
 await db.exec('drop trigger reviews_enqueue_ai_after_insert on public.reviews;'+production.aiTrigger.definition);
 await db.exec(migration('_allow_historical_attention_without_auto_ai.sql'));
 await db.exec(`grant all on all tables in schema public to service_role;grant usage on schema extensions,private to service_role;
 update public.review_corpus_policy set enabled=true,paused=false,ingestions_paused=false;`);
},90000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user])});
afterEach(()=>db.exec('rollback'));afterAll(()=>db.close());

const items=(count=5,total=5,language='vi')=>Array.from({length:count},(_,i)=>({
 cid:'fixture',placeId:'place-fixture',reviewId:'fresh-'+i,stars:i%5+1,text:i%2?'Original EN':'',originalLanguage:'en',
 textTranslated:i%2?'Bản dịch Google':'',translatedLanguage:language,language,reviewsCount:total,
 publishedAtDate:'2020-01-01T00:00:00Z',scrapedAt:new Date().toISOString(),
}));
const stageBundle=(rows=items())=>prepareManualReviewReload(rows,{id:est,organization_id:org,google_id:'fixture',place_id:'place-fixture',language:'vi',requested_at:new Date(Date.now()-60000).toISOString()});
async function request(id=crypto.randomUUID(),target=est){return (await db.query('select (public.request_review_reload($1,$2)).*',[target,id])).rows[0]}
async function running(){
 const j=await request();
 await db.query(`update public.initial_import_jobs set status='running',locked_by='worker',lease_until=now()+interval '5 minutes',
 provider_start_attempted_at=now(),provider_run_id='native-run',provider_dataset_id='native-dataset',provider_status='SUCCEEDED',
 provider_finished_observed_at=now(),provider_finished_at=now() where id=$1`,[j.id]);
 return j;
}
async function seed(){
 await db.exec("select set_config('home.retention_ingest','on',true)");
 await db.query("update public.establishments set place_id='place-fixture',active=true where id=$1",[est]);
 await db.query("insert into public.establishments(id,organization_id,name,google_id,google_maps_url,active) values($1,$2,'Other','other','other',true)",[other,org]);
 for(const id of [est,other]){
  const r=(await db.query(`insert into public.reviews(organization_id,establishment_id,external_review_id,author_name,rating,text,original_text,published_at)
  values($1,$2,'old','Client',5,'Old original','Old original','2020-01-01') returning id`,[org,id])).rows[0];
  await db.query("insert into public.review_translations(review_id,language,translated_text) values($1,'fr','Ancienne traduction')",[r.id]);
  await db.query("insert into public.review_provider_payloads(review_id,provider,raw_payload) values($1,'apify','{\"text\":\"Old original\"}')",[r.id]);
 }
 await db.exec("select set_config('home.retention_ingest','',true)");
}
async function stage(j:Record<string,unknown>,rows=items()){
 const {bundle,summary}=stageBundle(rows);
 await db.exec('set local role service_role');
 await db.query("select public.stage_review_reload($1,'worker',$2,$3)",[j.id,bundle,summary]);
 return bundle;
}
const apply=(id:unknown)=>db.query("select public.apply_review_reload($1,'worker') r",[id]);
async function reject(sql:string,args:unknown[],message:string){
 await db.exec('savepoint rejected');await expect(db.query(sql,args)).rejects.toThrow(message);await db.exec('rollback to savepoint rejected');
}

it('installs no work and makes no calls on migration',async()=>{
 expect((await db.query('select count(*)::int n from private.fake_net_calls')).rows[0].n).toBe(0);
 expect((await db.query('select count(*)::int n from private.review_reload_staging')).rows[0].n).toBe(0);
});
it('validates a full native batch, counts unique IDs, accepts 5/5 and old/textless/all-star reviews, and rejects 5/150',()=>{
 const five=items();expect(stageBundle([...five,...five]).bundle).toHaveLength(5);
 expect(stageBundle(items(150,1000)).bundle).toHaveLength(150);
 expect(new Set(stageBundle().bundle.map(b=>b.row.rating)).size).toBe(5);
 expect(stageBundle().bundle[0].row.published_at).toBe('2020-01-01T00:00:00.000Z');
 expect(()=>stageBundle(items(5,1000))).toThrow('RELOAD_COLLECTION_INCOMPLETE');
 expect(()=>stageBundle(items(5,5,'fr'))).toThrow('RELOAD_LANGUAGE_MISMATCH');
 expect(()=>stageBundle(items().map(i=>({...i,cid:'wrong',placeId:'wrong'})))).toThrow('RELOAD_RESTAURANT_MISMATCH');
 expect(()=>stageBundle(items().map(i=>({...i,scrapedAt:'2020-01-01'})))).toThrow('RELOAD_FRESHNESS_UNVERIFIED');
});
it('joins double clicks, freezes account language, and never uses the old merge retry endpoint',async()=>{
 await seed();const key=crypto.randomUUID();const a=await request(key),b=await request(key);
 expect(a.id).toBe(b.id);expect(a.preferred_language).toBe('vi');expect(a.request_kind).toBe('reload');
 expect((await db.query('select count(*)::int n from public.reviews where establishment_id=$1',[est])).rows[0].n).toBe(1);
 await reject('select public.retry_initial_import_job($1)',[a.id],'USE_MANUAL_RELOAD');
});
it('replaces only the selected corpus atomically, purges old translations/raws, preserves identity and receipts, and is idempotent',async()=>{
 await seed();const j=await running();await stage(j);
 const result=(await apply(j.id)).rows[0].r;
 expect(result).toMatchObject({inserted:5,reload_replaced:true});
 expect((await db.query('select external_review_id from public.reviews where establishment_id=$1 order by external_review_id',[est])).rows.map(r=>r.external_review_id)).toEqual(items().map(i=>i.reviewId));
 expect((await db.query('select external_review_id from public.reviews where establishment_id=$1',[other])).rows).toEqual([{external_review_id:'old'}]);
 expect((await db.query("select t.translated_text from public.review_translations t join public.reviews r on r.id=t.review_id where r.establishment_id=$1",[est])).rows).toEqual([{translated_text:'Bản dịch Google'},{translated_text:'Bản dịch Google'}]);
 expect((await db.query("select count(*)::int n from public.review_provider_payloads p join public.reviews r on r.id=p.review_id where r.establishment_id=$1 and p.raw_payload->>'text'='Old original'",[est])).rows[0].n).toBe(0);
 expect((await db.query('select name,google_id,place_id,review_reload_status from public.establishments where id=$1',[est])).rows[0]).toMatchObject({name:'Fixture',google_id:'fixture',place_id:'place-fixture',review_reload_status:'completed'});
 expect((await db.query('select status,provider_run_id,provider_dataset_id from public.initial_import_jobs where id=$1',[j.id])).rows[0]).toEqual({status:'completed',provider_run_id:'native-run',provider_dataset_id:'native-dataset'});
 expect((await db.query('select count(*)::int n from private.review_reload_staging')).rows[0].n).toBe(0);
 const ids=(await db.query('select id from public.reviews order by id')).rows;
 await apply(j.id);expect((await db.query('select id from public.reviews order by id')).rows).toEqual(ids);
 await db.exec('reset role');expect((await request(j.request_key as string)).id).toBe(j.id);
});
it('rolls back a mid-replacement write failure and keeps the validated stage for a manual database-only retry',async()=>{
 await seed();
 await db.query(`insert into public.current_report_publications(establishment_id,organization_id,language,report_id,source_run_id,source_created_at,generated_at,scope,document,source_bindings,evidence_bindings)
 values($1,$2,'vi',$3,$4,now()-interval '1 hour',now(),'{}','{"summary":"UNCHANGED"}','[]','[]')`,[est,org,crypto.randomUUID(),crypto.randomUUID()]);
 const j=await running();await stage(j);await db.exec('reset role');
 await db.exec(`create function public.synthetic_reload_failure() returns trigger language plpgsql as $$begin if new.external_review_id='fresh-2' then raise exception 'SYNTHETIC_WRITE_FAILURE';end if;return new;end$$;
 create trigger synthetic_reload_failure before insert on public.reviews for each row execute function public.synthetic_reload_failure();`);
 await db.exec('set local role service_role');await reject("select public.apply_review_reload($1,'worker')",[j.id],'SYNTHETIC_WRITE_FAILURE');
 expect((await db.query('select original_text from public.reviews where establishment_id=$1',[est])).rows).toEqual([{original_text:'Old original'}]);
 expect((await db.query('select document from public.current_report_publications where establishment_id=$1',[est])).rows[0].document).toEqual({summary:'UNCHANGED'});
 expect((await db.query('select count(*)::int n from private.review_reload_staging')).rows[0].n).toBe(1);
 await db.query("select public.fail_review_reload($1,'worker','SYNTHETIC_WRITE_FAILURE')",[j.id]);await db.exec('reset role');
 const alias=crypto.randomUUID();const resumed=await request(alias);expect(resumed.id).toBe(j.id);expect(resumed.provider_run_id).toBe('native-run');
 expect((await db.query('select count(*)::int n from public.initial_import_jobs where request_kind=\'reload\'')).rows[0].n).toBe(1);
 await db.exec('drop trigger synthetic_reload_failure on public.reviews');
 await db.query("update public.initial_import_jobs set status='running',locked_by='worker',lease_until=now()+interval '5 minutes' where id=$1",[j.id]);
 await db.exec('set local role service_role');await apply(j.id);
 expect((await db.query('select count(*)::int n from public.reviews where establishment_id=$1',[est])).rows[0].n).toBe(5);
 await db.exec('reset role');expect((await request(alias)).id).toBe(j.id);
});
it('preserves existing data after a partial or failed collection, without automatic retry or unknown-start resend',async()=>{
 await seed();const j=await running();const {bundle}=stageBundle();await db.exec('set local role service_role');
 await reject("select public.stage_review_reload($1,'worker',$2,$3)",[j.id,bundle,{uniqueCount:5,googleTotal:1000}],'RELOAD_COLLECTION_INCOMPLETE');
 await db.query("select public.fail_review_reload($1,'worker','RELOAD_COLLECTION_INCOMPLETE')",[j.id]);await db.exec('reset role');
 expect((await db.query('select original_text from public.reviews where establishment_id=$1',[est])).rows).toEqual([{original_text:'Old original'}]);
 await db.query("update public.initial_import_jobs set provider_run_id=null where id=$1",[j.id]);
 await reject('select public.request_review_reload($1,$2)',[est,crypto.randomUUID()],'APIFY_START_OUTCOME_UNKNOWN');
});
it('blocks competing ingestion and generation and rejects obsolete ingestion after success',async()=>{
 await seed();const j=await running();const {bundle}=stageBundle();await db.exec('set local role service_role');
 await reject("select public.ingest_recent_reviews($1,$2,$3,'apify')",[est,org,bundle],'REVIEW_RELOAD_IN_PROGRESS');
 await reject("select public.enqueue_current_report($1,$2,$3,'vi',$4,'gpt-6.1-sol',8)",[est,org,user,crypto.randomUUID()],'REVIEW_RELOAD_IN_PROGRESS');
 await stage(j);await apply(j.id);
 const old=bundle.map(b=>({...b,row:{...b.row,provider_scraped_at:'2020-01-01'}}));
 await reject("select public.ingest_recent_reviews($1,$2,$3,'apify')",[est,org,old],'RELOAD_OBSOLETE_INGESTION');
});
it('rejects unauthorized access before changing the selected restaurant',async()=>{
 await db.query("select set_config('request.jwt.claim.sub',$1,true)",[crypto.randomUUID()]);
 await reject('select public.request_review_reload($1,$2)',[est,crypto.randomUUID()],'FORBIDDEN');
 await db.exec('set local role authenticated');
 await reject("select public.apply_review_reload($1,'worker')",[crypto.randomUUID()],'permission denied');
});

it('removes durable reports, recommendation sheets and experiment copies, retaining content-free native receipts and replay tombstones',async()=>{
 await seed();await db.exec('set local role service_role');
 const source=(await db.query("select (public.enqueue_current_report($1,$2,$3,'vi',$4,'gpt-6.1-sol',8)).*",[est,org,user,crypto.randomUUID()])).rows[0];
 await db.query("update public.historical_report_runs set status='completed' where id=$1",[source.id]);await db.exec('reset role');
 const report=crypto.randomUUID(),experiment=crypto.randomUUID();
 await db.query(`insert into public.current_report_publications(establishment_id,organization_id,language,report_id,source_run_id,source_created_at,generated_at,scope,document,source_bindings,evidence_bindings)
 values($1,$2,'vi',$3,$4,now()-interval '1 hour',now(),'{"review_count":1}','{"report":{"summary":"OLD REPORT"}}','[]','[]')`,[est,org,report,source.id]);
 await db.query("insert into public.restaurant_recommendation_sheets values($1,'vi')",[est]);
 await db.query("insert into private.kh_en_experiments(id,reference_report_id,establishment_id,armed,body,artifacts) values($1,$2,$3,false,'{\"old_text\":\"OLD REVIEW COPY\"}','{\"old_report\":\"OLD REPORT COPY\"}')",[experiment,report,est]);
 await db.query(`insert into private.kh_en_calls(experiment_id,phase,request_wire,request_sha256,state,attempts,receipt)
 values($1,'sol','OLD REVIEW COPY','requesthash','received',1,$2)`,[experiment,{http_status:200,raw_response_text:JSON.stringify({model:'gpt-6.1-sol',usage:{input_tokens:30,output_tokens:5},output:'OLD REPORT COPY'}),raw_response_sha256:'receipthash',provider_request_id:'native-id',duration_ms:123}]);
 const j=await running();await stage(j);await apply(j.id);await db.exec('reset role');
 for(const table of ['current_report_publications','restaurant_recommendation_sheets','historical_report_runs'])expect((await db.query('select count(*)::int n from public.'+table+' where establishment_id=$1',[est])).rows[0].n).toBe(0);
 expect((await db.query('select count(*)::int n from private.kh_en_calls')).rows[0].n).toBe(0);
 const receipts=(await db.query("select to_jsonb(l) r from private.provider_attempt_ledger l where source_relation='private.kh_en_calls'")).rows;
 expect(receipts).toHaveLength(1);expect(receipts[0].r).toMatchObject({input_tokens:30,output_tokens:5,provider_request_id:'native-id',receipt_sha256:'receipthash'});
 expect(JSON.stringify(receipts)).not.toContain('OLD REVIEW');expect(JSON.stringify(receipts)).not.toContain('OLD REPORT');
 expect((await db.query('select count(*)::int n from private.retired_generation_keys where source_run_id=$1',[source.id])).rows[0].n).toBe(1);
 await reject(`insert into public.current_report_publications(establishment_id,organization_id,language,report_id,source_run_id,source_created_at,generated_at,scope,document,source_bindings,evidence_bindings)
 values($1,$2,'vi',$3,$4,now()-interval '1 hour',now(),'{}','{}','[]','[]')`,[est,org,report,source.id],'RELOAD_OBSOLETE_PUBLICATION');
});

it('allows manual retry of a terminal partial run as a fresh job but resumes a saved complete stage/run without resending',async()=>{
 await seed();const j=await running();await db.exec('set local role service_role');
 await db.query("select public.fail_review_reload($1,'worker','RELOAD_COLLECTION_INCOMPLETE')",[j.id]);await db.exec('reset role');
 const fresh=await request();expect(fresh.id).not.toBe(j.id);expect(fresh.provider_run_id).toBeNull();
 expect((await db.query('select provider_run_id from public.initial_import_jobs where id=$1',[j.id])).rows[0].provider_run_id).toBe('native-run');
 await db.query("update public.initial_import_jobs set status='failed',provider_run_id='second-known',provider_status='SUCCEEDED',provider_finished_observed_at=now(),error_code='DATASET_READ_FAILED' where id=$1",[fresh.id]);
 const resumed=await request();expect(resumed.id).toBe(fresh.id);expect(resumed.provider_run_id).toBe('second-known');
});

it('blocks a reload with an in-flight/unknown report attempt, and blocks another sync while queued',async()=>{
 await seed();await db.exec('set local role service_role');
 const source=(await db.query("select (public.enqueue_current_report($1,$2,$3,'vi',$4,'gpt-6.1-sol',8)).*",[est,org,user,crypto.randomUUID()])).rows[0];
 await db.exec('reset role');await reject('select public.request_review_reload($1,$2)',[est,crypto.randomUUID()],'RELOAD_GENERATION_OR_RESULT_PENDING');
 await db.query("update public.historical_report_runs set status='completed' where id=$1",[source.id]);await request();
 expect((await db.query("insert into public.review_sync_jobs(establishment_id,status) values($1,'queued') returning id",[est])).rows).toHaveLength(0);
});

it('accepts a verifiable native zero-review place, while an empty/unidentifiable dataset cannot erase old reviews',async()=>{
 expect(()=>stageBundle([])).toThrow('RELOAD_COLLECTION_UNVERIFIED');
 await seed();const j=await running();
 const zero=[{cid:'fixture',placeId:'place-fixture',reviewsCount:0,language:'vi',scrapedAt:new Date().toISOString()}];
 const bundle=await stage(j,zero as ReturnType<typeof items>);expect(bundle).toHaveLength(0);
 expect((await apply(j.id)).rows[0].r).toMatchObject({inserted:0,reload_replaced:true});
 expect((await db.query('select count(*)::int n from public.reviews where establishment_id=$1',[est])).rows[0].n).toBe(0);
});

it.each([null,{http_status:null,error:'network outcome unknown'}])('blocks consumed report attempts with an unknown native HTTP outcome %s',async receipt=>{
 await seed();const run=crypto.randomUUID();
 await db.query("insert into public.analysis_jev_batch_runs(id,organization_id,establishment_id,status,armed,sol_request_count,sol_receipt) values($1,$2,$3,'failed',false,1,$4)",[run,org,est,receipt]);
 await reject('select public.request_review_reload($1,$2)',[est,crypto.randomUUID()],'RELOAD_GENERATION_OR_RESULT_PENDING');
 expect((await db.query('select count(*)::int n from public.reviews where establishment_id=$1',[est])).rows[0].n).toBe(1);
});

it('reproduces the production CHECK failure, rolls back the old corpus/report, then installs the identical staged 1--5-star batch without automatic AI',async()=>{
 await seed();const report=crypto.randomUUID();
 await db.query(`insert into public.current_report_publications(establishment_id,organization_id,language,report_id,source_run_id,source_created_at,generated_at,scope,document,source_bindings,evidence_bindings)
 values($1,$2,'vi',$3,$4,now()-interval '1 hour',now(),'{}','{"summary":"UNCHANGED"}','[]','[]')`,[est,org,report,crypto.randomUUID()]);
 const j=await running();await stage(j,items(150,1790));await db.exec('reset role');
 const fixed=(await db.query("select pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.reviews'::regclass and conname='reviews_attention_rule'")).rows[0].d;
 const old=JSON.parse(readFileSync('tests/fixtures/review-reload-production-guards.json','utf8')).checks.find((c:{name:string})=>c.name==='reviews_attention_rule').definition;
 await db.exec('alter table public.reviews drop constraint reviews_attention_rule;alter table public.reviews add constraint reviews_attention_rule '+old);
 const before=(await db.query('select sha256 from private.review_reload_staging where job_id=$1',[j.id])).rows[0].sha256;
 await db.exec('set local role service_role');await reject("select public.apply_review_reload($1,'worker')",[j.id],'reviews_attention_rule');
 expect((await db.query('select original_text from public.reviews where establishment_id=$1',[est])).rows).toEqual([{original_text:'Old original'}]);
 expect((await db.query('select document from public.current_report_publications where establishment_id=$1',[est])).rows[0].document).toEqual({summary:'UNCHANGED'});
 expect((await db.query('select sha256 from private.review_reload_staging where job_id=$1',[j.id])).rows[0].sha256).toBe(before);
 await db.exec('reset role');await db.exec('alter table public.reviews drop constraint reviews_attention_rule;alter table public.reviews add constraint reviews_attention_rule '+fixed);
 await db.exec('set local role service_role');await apply(j.id);
 const rows=(await db.query('select rating,historical_import,requires_attention,requires_ai_analysis,ai_status,ai_attempt_count from public.reviews where establishment_id=$1',[est])).rows;
 expect(rows).toHaveLength(150);expect(new Set(rows.map(r=>r.rating)).size).toBe(5);
 for(const r of rows)expect(r).toMatchObject({historical_import:true,requires_attention:(r.rating as number)<=3,requires_ai_analysis:false,ai_status:null,ai_attempt_count:0});
 await db.exec('reset role');
 expect((await db.query("select count(*)::int n from private.fake_net_calls where url like '%/analyze-review'")).rows[0].n).toBe(0);
 expect((await db.query('select count(*)::int n from public.report_generation_requests')).rows[0].n).toBe(0);
 expect((await db.query('select count(*)::int n from public.historical_report_runs')).rows[0].n).toBe(0);
 expect((await db.query('select count(*)::int n from public.reviews where establishment_id=$1',[other])).rows[0].n).toBe(1);
});

it('keeps live-review constraints and proves the production AI trigger would be observed by the HTTP mock',async()=>{
 const insert=`insert into public.reviews(organization_id,establishment_id,external_review_id,rating,text,original_text,published_at,historical_import,requires_attention,requires_ai_analysis)
 values($1,$2,$3,$4,'Text','Text','2020-01-01',$5,$6,$7)`;
 for(const rating of [1,2,3]){
  await reject(insert,[org,est,'invalid-live-'+rating,rating,false,true,false],'reviews_attention_rule');
  await reject(insert,[org,est,'invalid-attention-'+rating,rating,true,false,false],'reviews_attention_rule');
  await db.query(insert,[org,est,'valid-historical-'+rating,rating,true,true,false]);
 }
 for(const rating of [4,5])await reject(insert,[org,est,'invalid-positive-'+rating,rating,true,true,false],'reviews_attention_rule');
 expect((await db.query("select count(*)::int n from private.fake_net_calls where url like '%/analyze-review'")).rows[0].n).toBe(0);
 await db.query(insert,[org,est,'live-control',2,false,true,true]);
 expect((await db.query("select count(*)::int n from private.fake_net_calls where url like '%/analyze-review'")).rows[0].n).toBe(1);
});

it('Retry requeues the validated batch with identical native IDs, hash and counters, without another collection reservation',async()=>{
 await seed();const j=await running();await stage(j,items(150,1790));
 await db.query("select public.fail_review_reload($1,'worker','reviews_attention_rule')",[j.id]);await db.exec('reset role');
 const before=(await db.query('select sha256 from private.review_reload_staging where job_id=$1',[j.id])).rows[0].sha256;
 const resumed=await request();expect(resumed.id).toBe(j.id);
 expect(resumed).toMatchObject({provider_run_id:'native-run',provider_dataset_id:'native-dataset',reviews_fetched:150,provider_requests:0});
 expect((await db.query('select count(*)::int n from public.initial_import_jobs where request_kind=\'reload\'')).rows[0].n).toBe(1);
 expect((await db.query('select sha256 from private.review_reload_staging where job_id=$1',[j.id])).rows[0].sha256).toBe(before);
 await db.query("update public.initial_import_jobs set status='running',locked_by='worker',lease_until=now()+interval '5 minutes' where id=$1",[j.id]);
 await db.exec('set local role service_role');expect((await db.query("select public.review_reload_stage_ready($1,'worker') ok",[j.id])).rows[0].ok).toBe(true);
 await apply(j.id);
});

it.each([false,true])('blocks expired/deleted validated stages before any provider fallback (legacy marker=%s)',async legacy=>{
 await seed();const j=await running();await stage(j,items(150,1790));
 await db.query("select public.fail_review_reload($1,'worker','reviews_attention_rule')",[j.id]);await db.exec('reset role');
 if(legacy)await db.query("update public.initial_import_jobs set result='{}',persistence_started_at=now() where id=$1",[j.id]);
 await db.query("update private.review_reload_staging set created_at=now()-interval '25 hours' where job_id=$1",[j.id]);
 await reject('select public.request_review_reload($1,$2)',[est,crypto.randomUUID()],'RELOAD_VALIDATED_STAGE_EXPIRED');
 await db.exec('select private.expire_review_reload_stages()');
 expect((await db.query('select count(*)::int n from private.review_reload_staging')).rows[0].n).toBe(0);
 await reject('select public.request_review_reload($1,$2)',[est,crypto.randomUUID()],'RELOAD_VALIDATED_STAGE_EXPIRED');
 await db.query("update public.initial_import_jobs set status='running',locked_by='worker',lease_until=now()+interval '5 minutes' where id=$1",[j.id]);
 await db.exec('set local role service_role');
 await reject("select public.review_reload_stage_ready($1,'worker')",[j.id],'RELOAD_VALIDATED_STAGE_EXPIRED');
 expect((await db.query('select external_review_id from public.reviews where establishment_id=$1',[est])).rows).toEqual([{external_review_id:'old'}]);
});

it('preserves the validation marker for a zero-review stage so its expiration cannot fall through to provider access',async()=>{
 await seed();const j=await running();
 const zero=[{cid:'fixture',placeId:'place-fixture',reviewsCount:0,language:'vi',scrapedAt:new Date().toISOString()}];
 await stage(j,zero as ReturnType<typeof items>);
 await db.query("select public.fail_review_reload($1,'worker','SYNTHETIC_DATABASE_ERROR')",[j.id]);await db.exec('reset role');
 const saved=(await db.query('select reviews_fetched,result from public.initial_import_jobs where id=$1',[j.id])).rows[0];
 expect(saved.reviews_fetched).toBe(0);expect(saved.result).toHaveProperty('validated_stage.sha256');
 await db.query("update private.review_reload_staging set created_at=now()-interval '25 hours' where job_id=$1",[j.id]);await db.exec('select private.expire_review_reload_stages()');
 await reject('select public.request_review_reload($1,$2)',[est,crypto.randomUUID()],'RELOAD_VALIDATED_STAGE_EXPIRED');
});
