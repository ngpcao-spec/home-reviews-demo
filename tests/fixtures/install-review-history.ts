import {readFileSync} from 'node:fs'
import type {PGlite} from '@electric-sql/pglite'

export const historyMigration='20261119120255_retained_review_history.sql'
export const historyStatisticsMigration='20261119120531_statistics_retained_history.sql'
export function actualFunction(file:string,name:string){
 const sql=readFileSync('supabase/migrations/'+file,'utf8')
 const re=new RegExp('create (?:or replace )?function '+name.replaceAll('.','\\.')+'\\(','i'),start=sql.search(re)
 if(start<0)throw Error('Missing real function: '+name)
 const opening=/\$[a-zA-Z_]*\$/.exec(sql.slice(start));if(!opening)throw Error('Missing function delimiter')
 const closing=sql.indexOf(opening[0],start+opening.index+opening[0].length),end=sql.indexOf(';',closing+opening[0].length)
 if(closing<0||end<0)throw Error('Missing closing function delimiter: '+name)
 return sql.slice(start,end+1)
}
// Only fixture DDL and auth claims are reduced. Retention/admission/ingestion and
// the incremental validation body below are the actual application definitions.
export async function installReviewHistory(db:PGlite){
 const fixture=JSON.parse(readFileSync('tests/fixtures/retention-production-definitions.json','utf8'))
 await db.exec('create role service_role bypassrls;grant usage on schema public,private,auth,extensions to service_role')
 for(const c of fixture.columns.filter((c:{table:string;schema:string})=>c.schema==='public'&&['reviews','establishments','initial_import_jobs','review_sync_jobs','review_provider_payloads','analysis_review_english_translation_overrides','notifications','push_test_deliveries','review_reply_drafts','establishment_snapshots'].includes(c.table))){
  await db.exec(`create table if not exists public.${c.table}(fixture_placeholder boolean);alter table public.${c.table} add column if not exists "${c.column}" ${c.type}${c.default?' default '+c.default:''}`)
 }
 await db.exec(`alter table public.establishments add column review_reload_job_id uuid,add column review_reload_barrier_at timestamptz;
 alter table public.review_translations add column updated_at timestamptz default now();
 alter table public.review_corpus_policy add column enabled boolean default true,add column paused boolean default false,add column ingestions_paused boolean default false,add column epoch uuid default gen_random_uuid();
 alter table public.review_retention_events add column organization_id uuid,add column policy_epoch uuid,add column as_of timestamptz,add column cutoff timestamptz,add column before_count integer,add column after_count integer;
 create table private.review_seen_keys(establishment_id uuid,external_key_sha256 text,first_published_at timestamptz,primary key(establishment_id,external_key_sha256));
 create table public.report_corpus_scopes(source_run_id uuid,establishment_id uuid,review_ids uuid[],stale boolean,stale_reason text,fingerprint text);
 create table public.current_report_publications(establishment_id uuid,scope jsonb,stale boolean,stale_reason text,updated_at timestamptz);
 create table public.review_corpus_states(establishment_id uuid primary key,organization_id uuid,policy_epoch uuid,checked_at timestamptz,retained_count integer,text_count integer,period_start timestamptz,period_end timestamptz,fingerprint text,changed_at timestamptz);
 create unique index history_fixture_payload on public.review_provider_payloads(review_id,provider);
 create unique index history_fixture_snapshot on public.establishment_snapshots(establishment_id,provider,source_run_id);
 create table public.organizations(id uuid primary key,monitoring_interval_hours integer default 24);
 insert into public.organizations(id) select distinct organization_id from public.establishments;
 alter table public.review_sync_jobs add column apify_run_id text,add column apify_dataset_id text,add column provider_start_attempted_at timestamptz,
  add column incremental_version text,add column incremental_input jsonb,add column incremental_identity jsonb,add column incremental_build text,
  add column incremental_receipt jsonb,add column incremental_received integer,add column incremental_result jsonb,add column collection_language text;
 grant all on all tables in schema public,private to service_role;`)
 await db.exec(actualFunction('20261025021329_recent_text_retention_policy.sql','public.review_usable_text'))
 await db.exec(actualFunction('20261108160752_shared_restaurant_sync_runtime.sql','private.shared_review_public_fields'))
 const production=JSON.parse(readFileSync('tests/fixtures/history-runtime-definitions.json','utf8'))
 for(const f of production.functions)await db.exec(f.definition)
 await db.exec(actualFunction('20261025094916_latest_150_review_policy.sql','public.review_corpus_fingerprint'))
 // Patch the same real validation function as the deployed shared wrapper calls.
 await db.exec(actualFunction('20260928150000_scalable_review_sync_queue.sql','public.review_sync_spread_offset'))
 await db.exec(actualFunction('20260928150000_scalable_review_sync_queue.sql','public.complete_review_sync_job'))
 await db.exec(actualFunction('20261029004621_incremental_review_sync.sql','public.reserve_incremental_review_sync'))
 await db.exec(actualFunction('20261029004621_incremental_review_sync.sql','public.commit_incremental_review_sync'))
 await db.exec(readFileSync('supabase/migrations/20261108044812_incremental_review_collection_overlap.sql','utf8'))
 await db.exec('alter function public.commit_incremental_review_sync(uuid,text,jsonb,jsonb) rename to commit_incremental_review_sync_before_sharing')
 await db.exec(readFileSync('supabase/migrations/'+historyMigration,'utf8'))
 await db.exec(readFileSync('supabase/migrations/'+historyStatisticsMigration,'utf8'))
}

export async function enableRealRetention(db:PGlite){
 await db.exec(`create trigger recent_text_admission before insert or update on public.reviews for each row execute function private.retention_review_admission();
 create trigger recent_text_refresh after insert or update or delete on public.reviews for each row execute function private.retention_review_changed();`)
}
