// @vitest-environment node
import {PGlite} from '@electric-sql/pglite'
import {readFileSync,readdirSync} from 'node:fs'
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest'
let db:PGlite
const user='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',org='20000000-0000-4000-8000-000000000001',review='30000000-0000-4000-8000-000000000001'
const migration=readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith('_account_language_review_display.sql')),'utf8')
beforeAll(async()=>{
 db=new PGlite();await db.waitReady
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema private;create schema auth;create schema extensions;create schema net;create schema vault;create schema cron;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
 create table public.profiles(user_id uuid primary key,preferred_language text);
 create table public.organization_members(user_id uuid,organization_id uuid);
 create function private.is_org_member(p uuid) returns boolean language sql security definer as $$select exists(select 1 from public.organization_members where user_id=auth.uid() and organization_id=p)$$;
 create table public.reviews(id uuid primary key,organization_id uuid,original_text text,text text,original_language text,source_provider text,rating integer);
 create table public.review_translations(review_id uuid,language text,translated_text text);
 create table public.review_provider_payloads(review_id uuid,provider text,raw_payload jsonb);
 create table public.review_corpus_policy(paused boolean);insert into public.review_corpus_policy values(false);
 create function public.review_usable_text(text,text) returns text language sql immutable as $$select nullif(btrim(coalesce(nullif($1,''),$2,'')),'')$$;
 create table vault.decrypted_secrets(name text,decrypted_secret text);insert into vault.decrypted_secrets values('home_reviews_scheduler_token','SYNTHETIC');
 create table private.fake_dispatch(id bigint generated always as identity,url text);create function net.http_post(url text,body jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 1000) returns bigint language plpgsql as $$declare n bigint;begin insert into private.fake_dispatch(url) values(url) returning id into n;return n;end$$;
 create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
 insert into public.profiles values('${user}','fr'),('${other}','vi');insert into public.organization_members values('${user}','${org}'),('${other}','${org}');
 insert into public.reviews values('${review}','${org}','Very slow service.','Very slow service.','en','apify',2);
 grant usage on schema private,auth to authenticated,service_role;grant all on all tables in schema public to service_role;
 alter table public.reviews enable row level security;grant select on public.reviews to authenticated;create policy own_reviews on public.reviews for select to authenticated using(private.is_org_member(organization_id));`)
 await db.exec(migration)
},30000)
beforeEach(async()=>{await db.exec('begin');await db.exec(`select set_config('request.jwt.claim.sub','${user}',true);update private.review_display_runtime set enabled=true`)})
afterEach(()=>db.exec('rollback'))
afterAll(()=>db.close())
const read=async(ids=[review],prepare=true)=>(await db.query('select public.read_review_display($1,$2) rows',[ids,prepare])).rows[0].rows as {language:string;status:string;source_sha256:string;translated_text:string|null}[]
const claim=async(worker='worker')=>(await db.query('select * from public.claim_review_display($1)',[worker])).rows.map(r=>r.claim_review_display as {review_id:string;source_sha256:string;language:string;provider_translation:string|null})
const reserve=async(j:Awaited<ReturnType<typeof claim>>[0],worker='worker')=>(await db.query('select public.reserve_review_display($1,$2,$3,$4) attempt',[j.review_id,j.language,j.source_sha256,worker])).rows[0].attempt
const finish=async(j:Awaited<ReturnType<typeof claim>>[0],result:unknown,attempt:unknown=null,worker='worker')=>(await db.query('select public.finish_review_display($1,$2,$3,$4,$5,$6) ok',[j.review_id,j.language,j.source_sha256,worker,result,attempt])).rows[0].ok
it('does not backfill, translate or dispatch existing reviews on installation',async()=>{
 expect((await db.query('select count(*)::int n from public.review_display_texts')).rows[0].n).toBe(0)
 expect((await db.query('select count(*)::int n from private.fake_dispatch')).rows[0].n).toBe(0)
 expect(await read([review],false)).toMatchObject([{status:'missing',language:'fr'}])
})
it('uses the account language, deduplicates readers and never selects legacy English for FR/VI',async()=>{
 await db.query("insert into public.review_translations values($1,'en','English intermediate')",[review])
 await read();await read();expect((await claim()).length).toBe(1);expect((await read())[0]).toMatchObject({language:'fr',translated_text:null})
 await db.exec(`select set_config('request.jwt.claim.sub','${other}',true)`);expect((await read())[0].language).toBe('vi')
 expect((await db.query('select count(*)::int n from public.review_display_texts')).rows[0].n).toBe(2)
})
it('shares one compatible translation between users and keeps the original/rating/analysis translation intact',async()=>{
 await read();const [j]=await claim(),a=await reserve(j);expect(typeof a).toBe('string');expect(await reserve(j)).toBeNull()
 await finish(j,{status:'translated',translated_text:'Service très lent.',source_language:'en',language_origin:'detected',model:'mock',usage:{input_tokens:12,output_tokens:8}},a)
 await db.exec(`update public.profiles set preferred_language='fr' where user_id='${other}';select set_config('request.jwt.claim.sub','${other}',true)`)
 expect((await read())[0].translated_text).toBe('Service très lent.');expect(await claim()).toHaveLength(0)
 expect((await db.query('select original_text,rating from public.reviews')).rows[0]).toEqual({original_text:'Very slow service.',rating:2})
})
it('prepares only future text insertions in the background and no textless review',async()=>{
 const id=crypto.randomUUID();await db.query("insert into public.reviews values($1,$2,'','','vi','apify',5)",[id,org]);expect(await read([id])).toMatchObject([{status:'original'}])
 expect(await claim()).toHaveLength(0)
 await db.query("update public.reviews set original_text='Merci beaucoup.',text='Merci beaucoup.' where id=$1",[id]);expect(await claim()).toHaveLength(2)
})
it('preserves two global processing slots across workers and cron',async()=>{
 await read();await db.exec(`select set_config('request.jwt.claim.sub','${other}',true)`);await read();expect(await claim('one')).toHaveLength(2);expect(await claim('two')).toHaveLength(0)
})
it('invalidates a changed original and prevents publishing a late previous translation',async()=>{
 await read();const [j]=await claim(),a=await reserve(j)
 await db.query("update public.reviews set original_text='Changed original.' where id=$1",[review])
 expect(await finish(j,{status:'translated',translated_text:'ANCIEN',source_language:'en',language_origin:'detected',usage:{input_tokens:10}},a)).toBe(false)
 expect((await read())[0].translated_text).toBeNull();expect((await read())[0].source_sha256).not.toBe(j.source_sha256)
 expect((await db.query('select usage from private.review_display_receipts')).rows[0].usage).toEqual({input_tokens:10})
})
it('refuses a paid start if the source changes after claim',async()=>{
 await read();const [j]=await claim();await db.query("update public.reviews set original_text='Changed.' where id=$1",[review]);expect(await reserve(j)).toBeNull()
})
it('does not resend an unknown attempt after lease expiry, but accepts its matching late result',async()=>{
 await read();const [j]=await claim(),a=await reserve(j);await db.exec("update public.review_display_texts set lease_until=clock_timestamp()-interval '1 second'")
 expect(await claim('cron')).toHaveLength(0);expect((await read())[0].status).toBe('unknown')
 expect(await finish(j,{status:'translated',translated_text:'Service lent.',source_language:'en',language_origin:'detected'},a)).toBe(true)
 expect((await read())[0].status).toBe('translated')
})
it('can reclaim a lost lease before any provider attempt was reserved',async()=>{
 await read();await claim();await db.exec("update public.review_display_texts set lease_until=clock_timestamp()-interval '1 second'");expect(await claim('next')).toHaveLength(1)
})
it('purges all display content on review deletion and saves only the late technical receipt',async()=>{
 await read();const [j]=await claim(),a=await reserve(j);await db.query('delete from public.reviews where id=$1',[review])
 expect(await finish(j,{status:'translated',translated_text:'NE PAS REPUBLIER',model:'mock',usage:{input_tokens:7}},a)).toBe(false)
 expect((await db.query('select count(*)::int n from public.review_display_texts')).rows[0].n).toBe(0)
 expect((await db.query('select review_id,usage from private.review_display_receipts')).rows[0]).toEqual({review_id:null,usage:{input_tokens:7}})
})
it('only reuses provider translations proven to match the current original and target',async()=>{
 await db.query("insert into public.review_translations values($1,'fr','Service lent.')",[review])
 await db.query('insert into public.review_provider_payloads values($1,\'apify\',$2)',[review,{text:'Very slow service.',textTranslated:'Service lent.',translatedLanguage:'fr'}])
 await read();expect((await claim())[0].provider_translation).toBe('Service lent.')
})
it('rejects legacy translations without compatible source evidence',async()=>{
 await db.query("insert into public.review_translations values($1,'fr','Ancien texte')",[review]);await read();expect((await claim())[0].provider_translation).toBeNull()
})
it('denies nonmembers, anonymous access and direct cache writes',async()=>{
 await read();await db.exec(`delete from public.organization_members where user_id='${user}';set local role authenticated;savepoint denied`)
 await expect(read()).rejects.toThrow('FORBIDDEN');await db.exec('rollback to savepoint denied')
 expect((await db.query('select * from public.review_display_texts')).rows).toHaveLength(0)
 await expect(db.query("update public.review_display_texts set translated_text='FORGED'")).rejects.toThrow('permission denied');await db.exec('rollback to savepoint denied;set local role anon')
 await expect(read()).rejects.toThrow('permission denied')
})
