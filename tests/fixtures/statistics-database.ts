// Isolated PostgreSQL fixture. Only auth claims are simulated. Business lookup functions
// are loaded from their versioned definitions, including the pilot migration's rewrite.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync } from 'node:fs'
export const orgA='10000000-0000-4000-8000-000000000001',orgB='10000000-0000-4000-8000-000000000002'
export const userA='20000000-0000-4000-8000-000000000001',userB='20000000-0000-4000-8000-000000000002'
export const estA='30000000-0000-4000-8000-000000000001',estB='30000000-0000-4000-8000-000000000002',restaurant='40000000-0000-4000-8000-000000000001'
export const migration=readFileSync('supabase/migrations/20261119105944_restaurant_statistics_readonly.sql','utf8')
const definition=(file:string,name:string)=>{
 const text=readFileSync('supabase/migrations/'+file,'utf8'),start=text.indexOf('create function '+name+'(')
 if(start<0)throw Error('Missing actual function '+name)
 const end=text.indexOf('$$;',text.indexOf('$$',start)+2)
 return text.slice(start,end+3)
}
export async function statisticsDatabase(count=1205){
 const db=new PGlite({extensions:{pgcrypto}});await db.waitReady
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema private;create schema extensions;create extension pgcrypto with schema extensions;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.organization_members(organization_id uuid,user_id uuid);
 create table public.profiles(user_id uuid primary key,preferred_language text);
 create table public.establishments(id uuid primary key,organization_id uuid,active boolean default true,place_id text,name text,total_reviews integer,review_collection_status text,review_collection_expected integer,review_collection_unique integer,review_collection_checked_at timestamptz);
 create table public.review_corpus_policy(id boolean primary key,timezone text);insert into public.review_corpus_policy values(true,'Asia/Ho_Chi_Minh');
 create table public.review_retention_events(establishment_id uuid,purged_count integer);
 create table public.reviews(id uuid primary key default gen_random_uuid(),organization_id uuid,establishment_id uuid,external_review_id text,published_at timestamptz,rating smallint,original_text text,text text,original_language text,author_name text,review_url text,updated_at timestamptz default now(),private_draft text);
 create index reviews_statistics_fixture on public.reviews(establishment_id,external_review_id);
 create table public.review_translations(review_id uuid,language text,translated_text text,source_text_sha256 text,primary key(review_id,language));
 create table private.shared_restaurant_runtime(singleton boolean,enabled boolean);insert into private.shared_restaurant_runtime values(true,true);
 create table private.shared_restaurant_pilot_places(place_id text primary key);
 create table private.shared_restaurant_establishments(establishment_id uuid primary key,restaurant_id uuid,organization_id uuid);
 create table private.shared_restaurant_subscriptions(restaurant_id uuid,organization_id uuid,language text);
 create table private.shared_restaurant_reviews(restaurant_id uuid,external_id text,published_at timestamptz,rating integer,original_text text,public_payload jsonb,primary key(restaurant_id,external_id));
 create table private.shared_restaurant_review_translations(restaurant_id uuid,external_id text,language text,original_text_sha256 text,translated_text text,primary key(restaurant_id,external_id,language));
 create table private.shared_jev_analyses(identity_sha256 text primary key,establishment_id uuid,google_review_id text,state text,identity jsonb,result jsonb,updated_at timestamptz default now());
 create table private.shared_restaurant_jev_keys(restaurant_id uuid,compatibility_sha256 text,identity_sha256 text,primary key(restaurant_id,compatibility_sha256));
 insert into public.organization_members values('${orgA}','${userA}'),('${orgB}','${userB}');
 insert into public.profiles values('${userA}','fr'),('${userB}','vi');
 insert into public.establishments(id,organization_id,place_id,name,total_reviews) values('${estA}','${orgA}','ChIJStatisticsFixture','K.HOUSE Restaurant',5000),('${estB}','${orgB}','ChIJStatisticsFixture','K.HOUSE Restaurant',5000);
 insert into private.shared_restaurant_establishments values('${estA}','${restaurant}','${orgA}'),('${estB}','${restaurant}','${orgB}');
 insert into private.shared_restaurant_subscriptions values('${restaurant}','${orgA}','fr'),('${restaurant}','${orgB}','vi');
 insert into private.shared_restaurant_pilot_places values('ChIJStatisticsFixture');
 insert into public.reviews(organization_id,establishment_id,external_review_id,published_at,rating,original_text,original_language,author_name,private_draft)
 select '${orgA}','${estA}','source-'||i,now()-make_interval(days=>i%400+1),1+(i%5),'Original '||i,'en','Client '||i,'PRIVATE A' from generate_series(1,${count}) i;
 insert into private.shared_restaurant_reviews select '${restaurant}',external_review_id,published_at,rating,original_text,jsonb_build_object('original_language',original_language,'author_name',author_name) from public.reviews;
 grant usage on schema public,auth to authenticated;
 `)
 const bridge='20261108160300_shared_restaurant_runtime_bridge.sql',pilot='20261109051656_shared_restaurant_pilot_allowlist.sql'
 await db.exec(definition(bridge,'public.shared_restaurant_runtime_enabled'))
 await db.exec(definition(pilot,'private.shared_pilot_place'))
 await db.exec(definition(pilot,'private.shared_pilot_establishment'))
 await db.exec(definition(bridge,'public.shared_restaurant_for_establishment').replace('public.shared_restaurant_runtime_enabled()','private.shared_pilot_establishment(p_establishment)'))
 await db.exec(migration)
 return db
}
