import {PGlite} from '@electric-sql/pglite'
import {readFileSync} from 'node:fs'
import type {SupabaseClient} from '@supabase/supabase-js'
import {sqlMigrationSource} from './sql-migration-source'

export const MENU_MIGRATION='20261124030622_automatic_rainminer_menu_queue.sql'
export const menuSql=(name:string)=>sqlMigrationSource(readFileSync('supabase/migrations/'+name,'utf8'))
export function sqlFunction(file:string,name:string) {
 const sql=menuSql(file), start=sql.search(new RegExp('create (?:or replace )?function '+name.replaceAll('.','\\.')+'\\('))
 if(start<0)throw Error('MISSING_FUNCTION '+name)
 const body=sql.indexOf('$$',start),end=sql.indexOf('$$',body+2)
 return sql.slice(start,end+3)
}
export const ORG='10000000-0000-4000-8000-000000000001',ORG2='10000000-0000-4000-8000-000000000002'
export const USER='20000000-0000-4000-8000-000000000001',USER2='20000000-0000-4000-8000-000000000002'
export const PLACE='ChIJMenuFixtureOnly',ACTOR='8GGZ9N7j2JhqnQ3oT'
export const pricing={actorId:ACTOR,pricing:{pricingModel:'PAY_PER_EVENT',minimalMaxTotalChargeUsd:0}}
export async function menuDatabase(){
 const db=new PGlite();await db.waitReady
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema private;create schema auth;create schema vault;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table organizations(id uuid primary key,monitoring_interval_hours integer default 12);
 create table organization_members(organization_id uuid,user_id uuid,role text);
 create table establishments(id uuid primary key default gen_random_uuid(),organization_id uuid,place_id text,
 google_id text,name text,google_maps_url text,address text,rating numeric,total_reviews integer,photo_url text,
 active boolean default true,created_at timestamptz default now(),initial_import_job_id uuid,
 initialized_at timestamptz,last_review_id text,last_review_at timestamptz,reporting_started_at timestamptz,
 last_sync_at timestamptz,next_sync_at timestamptz,sync_status text,sync_error text,last_sync_status text,last_sync_error text,
 updated_at timestamptz,review_collection_status text,review_collection_expected integer,review_collection_unique integer,review_collection_checked_at timestamptz);
 create table establishment_snapshots(establishment_id uuid,total_reviews integer,captured_at timestamptz,source_run_id text);
 create table vault.decrypted_secrets(name text,decrypted_secret text);
 create table review_sync_runtime_config(singleton boolean,jitter_fraction numeric,jitter_cap_minutes integer);
 insert into review_sync_runtime_config values(true,0.1,30);
 create table private.shared_restaurants(id uuid primary key,place_id text);
 create table private.shared_restaurant_establishments(establishment_id uuid,restaurant_id uuid,organization_id uuid);
 create table private.shared_restaurant_subscriptions(restaurant_id uuid,organization_id uuid,language text);
 create table private.shared_restaurant_runtime(singleton boolean primary key,enabled boolean);insert into private.shared_restaurant_runtime values(true,true);
 create table private.shared_restaurant_pilot_places(place_id text primary key);
 create table private.shared_restaurant_menu_versions(restaurant_id uuid,run_id text,collected_at timestamptz,raw jsonb,menu_references jsonb,provenance jsonb,primary key(restaurant_id,run_id));
 insert into organizations(id) values('${ORG}'),('${ORG2}');
 insert into organization_members values('${ORG}','${USER}','owner'),('${ORG2}','${USER2}','owner');
 grant usage on schema private,auth to service_role;`)
 const initial=JSON.parse(readFileSync('tests/fixtures/initial-import-functions.json','utf8'))
 await db.exec('create table initial_import_jobs('+initial.columns.map((c:{name:string;type:string;default:string|null})=>'"'+c.name+'" '+c.type+(c.default?' default '+c.default:'')).join(',')+',primary key(id));')
 await db.exec("alter table initial_import_jobs add column if not exists request_kind text default 'initial'")
 // Actual cadence and finalization definitions, not substitutes for import success.
 const spread=initial.functions.find((f:{name:string})=>f.name.startsWith('review_sync_spread_offset('))
 if(spread)await db.exec(spread.definition)
 else {
  const definition=sqlFunction('20260928160000_scalable_sync_runtime_retention_load_test.sql','public.review_sync_spread_offset')
  await db.exec(definition)
 }
 for(const name of ['private.initial_review_collection_coverage','public.finalize_initial_import_job'])
  await db.exec(sqlFunction('20261028064035_review_collection_coverage_and_manual_retry.sql',name))
 const queue=menuSql('20261107120320_rainminer_menu_jobs.sql')
 await db.exec(queue.slice(0,queue.indexOf("select cron.schedule(")))
 await db.exec('alter function public.enqueue_rainminer_menu(uuid,uuid,uuid) rename to enqueue_rainminer_menu_before_sharing')
 for(const [file,name] of [
  ['20261108160300_shared_restaurant_runtime_bridge.sql','public.shared_restaurant_runtime_enabled'],
  ['20261109051656_shared_restaurant_pilot_allowlist.sql','private.shared_pilot_place'],
  ['20261108160300_shared_restaurant_runtime_bridge.sql','public.shared_restaurant_for_establishment'],
  ['20261108161921_shared_restaurant_subscription_runtime.sql','public.read_shared_establishment_menu'],
 ]) {
  let sql=sqlFunction(file,name)
  if(['public.shared_restaurant_for_establishment','public.read_shared_establishment_menu'].includes(name))
   sql=sql.replaceAll('public.shared_restaurant_runtime_enabled()','private.shared_pilot_place((select place_id from public.establishments where id=p_establishment))')
  await db.exec(sql)
 }
 // PGlite lacks pg_cron/pg_net; omit only the registration statement. Its
 // work_due predicate is real SQL tested below; CI registers the actual Cron.
 await db.exec(menuSql(MENU_MIGRATION).replace(/select cron\.schedule\([\s\S]*?\$cron\$\);/,''))
 await db.exec('create trigger capture_shared_rainminer_menu after insert or update of status,result on rainminer_menu_jobs for each row execute function private.capture_shared_rainminer_menu()')
 return db
}
export async function configureMenus(db:PGlite,automatic=true,cap=2){
 await db.query('update private.rainminer_menu_config set launches_enabled=true,automatic_enabled=$1,budget_limit_usd=$2,configured_at=now()',[automatic,cap])
}
export async function newImport(db:PGlite,{place=PLACE,org=ORG,user=USER,kind='initial',old=false}:{place?:string|null;org?:string;user?:string;kind?:string;old?:boolean}={}){
 const id=crypto.randomUUID(),est=crypto.randomUUID()
 await db.query(`insert into establishments(id,organization_id,place_id,google_id,initial_import_job_id,active,created_at)
 values($1::uuid,$2,$3,$1::text,$4,true,case when $5 then '2020-01-01'::timestamptz else clock_timestamp() end)`,[est,org,place,id,old])
 await db.query(`insert into initial_import_jobs(id,organization_id,user_id,query,expected_google_id,establishment_id,status,locked_by,lease_until,reviews_fetched,request_kind)
 values($1,$2,$3,'fixture',$4::text,$4::uuid,'running','worker',now()+interval '5 minutes',1,$5)`,[id,org,user,est,kind])
 return {id,est}
}
export async function finalizeMenuImport(db:PGlite,item:{id:string;est:string},total=1){
 return (await db.query<{ok:boolean}>(`select public.finalize_initial_import_job($1,'worker',$2,'review-head',now(),now(),$3) ok`,[item.id,item.est,{reportedGoogleTotal:total}])).rows[0].ok
}
export const menuAdmin=(db:PGlite)=>({
 rpc:async(name:string,args:Record<string,unknown>={})=>{
  try{
   if(!/^(claim_rainminer_menu|authorize_rainminer_start|checkpoint_rainminer_menu)$/.test(name))throw Error('UNEXPECTED_RPC')
   const keys=Object.keys(args),call='public.'+name+'('+keys.map((key,i)=>key+'=> $'+(i+1)).join(',')+')'
   const query=name==='claim_rainminer_menu'?'select * from '+call:'select '+call+' value'
   const response=await db.query(query,Object.values(args))
   return {data:name==='claim_rainminer_menu'?response.rows:response.rows[0]?.value,error:null}
  }catch(error){return {data:null,error:{message:error instanceof Error?error.message:String(error)}}}
 }
}) as unknown as SupabaseClient
