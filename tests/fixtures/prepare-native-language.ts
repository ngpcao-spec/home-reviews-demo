import type {PGlite} from '@electric-sql/pglite'
import {readFileSync,readdirSync} from 'node:fs'
export async function prepareNativeLanguage(db:PGlite,user:string){
 const native=JSON.parse(readFileSync('tests/fixtures/native-language-schema.json','utf8'))
 for(const table of [...new Set(native.columns.map((c:{table_name:string})=>c.table_name))]){
  const cols=native.columns.filter((c:{table_name:string})=>c.table_name===table)
  await db.exec('create table if not exists public.'+table+'(id uuid)')
  for(const c of cols)await db.exec('alter table public.'+table+' add column if not exists "'+c.column_name+'" '+c.type+(c.default_value?' default '+c.default_value:''))
 }
 await db.exec("create table if not exists public.profiles(user_id uuid primary key,preferred_language text);create or replace function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create or replace function private.is_org_member(p uuid) returns boolean language sql security definer as $$select exists(select 1 from public.organization_members where user_id=auth.uid() and organization_id=p)$$;grant usage on schema private,auth to authenticated;create table private.review_display_runtime(singleton boolean,enabled boolean);insert into private.review_display_runtime values(true,false);create function private.read_review_display(uuid[],boolean default true) returns jsonb language sql as $$select '[]'::jsonb$$;create function public.read_review_display(p_reviews uuid[],p_prepare boolean default true) returns jsonb language sql as $$select private.read_review_display(p_reviews,p_prepare)$$;create or replace function private.enqueue_review_ai() returns trigger language plpgsql as $$begin return new;end$$;")
 for(const suffix of ['_latest_150_review_policy.sql','_normalize_textless_frozen_sources.sql'])await db.exec(readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith(suffix)),'utf8'))
 for(const f of native.functions)await db.exec(f.definition)
 await db.exec(readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith('_account_native_google_language.sql')),'utf8'))
 await db.exec(readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith('_native_publication_sources.sql')),'utf8'))
 await db.query("insert into public.profiles(user_id,preferred_language) values($1,'vi')",[user])
 await db.exec("grant execute on function public.read_review_display(uuid[],boolean) to authenticated;grant execute on function private.read_review_display(uuid[],boolean) to authenticated;grant all on all tables in schema public to service_role;")
 await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user])
}
