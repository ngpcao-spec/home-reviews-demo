import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFileSync} from 'node:fs';

/** Local PostgreSQL only. No Supabase client, credentials, fetch or worker. */
export async function recommendationDatabase(beforeInstall?:(db:PGlite)=>Promise<void>){
 const db=new PGlite({extensions:{pgcrypto}});await db.waitReady;
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema private;create schema extensions;create extension pgcrypto with schema extensions;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.user_id',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create table public.organizations(id uuid primary key);
 create table public.establishments(id uuid primary key,organization_id uuid not null references public.organizations(id),name text,google_id text,place_id text,address text,google_maps_url text);
 create table public.organization_members(organization_id uuid,user_id uuid,role text);grant select on public.organization_members to authenticated;
 create table public.reviews(id uuid primary key,organization_id uuid,establishment_id uuid,review_context jsonb,review_detailed_rating jsonb,rating integer);
 create table public.review_provider_payloads(id uuid primary key default gen_random_uuid(),review_id uuid,provider text,raw_payload jsonb,provider_last_seen_at timestamptz);
 create table public.review_corpus_policy(enabled boolean,paused boolean,epoch uuid);
 create table public.historical_report_runs(id uuid,establishment_id uuid,organization_id uuid,language text,created_at timestamptz);
 create table public.analysis_parallel_reports(current_source_run_id uuid,establishment_id uuid,language text,state text);
 create function public.review_corpus_fingerprint(uuid) returns text language sql as $$select 'fingerprint'::text$$;
 create function private.retention_retire_source(uuid,text) returns boolean language sql as $$select true$$;
 `);
 const base=readFileSync('supabase/migrations/20261025075847_current_report_publications.sql','utf8');
 await db.exec(base.slice(base.indexOf('create table public.current_report_publications'),base.indexOf('create function private.publication_generated_report')));
 const extract=(sql:string,signature:string)=>{const start=sql.indexOf(signature);return sql.slice(start,sql.indexOf('$$;',start)+3);};
 await db.exec(extract(base,'create function private.publication_generated_report'));
 await db.exec(extract(readFileSync('supabase/migrations/20261010080134_jev_economy_preparation.sql','utf8'),'create function public.jev_economy_canonical'));
 await db.exec(extract(readFileSync('supabase/migrations/20261014160258_jls_restaurant_delegated_preparation.sql','utf8'),'create function public.jls_restaurant_hash'));
 await db.exec(readFileSync('tests/fixtures/recommendation-publication-writer.sql','utf8'));
 if(beforeInstall)await beforeInstall(db);
 await db.exec(readFileSync('supabase/migrations/20261027152036_restaurant_recommendation_sheets_v1.sql','utf8'));
 return db;
}
