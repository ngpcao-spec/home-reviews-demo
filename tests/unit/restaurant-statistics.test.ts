// @vitest-environment node
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest'
import type {PGlite} from '@electric-sql/pglite'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {statisticsDatabase,estA,estB,orgA,orgB,userA,userB,restaurant} from '../fixtures/statistics-database'
import type {Statistics,ReviewPage} from '../../src/lib/restaurant-statistics'
let db:PGlite
beforeAll(async()=>{db=await statisticsDatabase()},30000)
beforeEach(()=>db.exec('begin'))
afterEach(()=>db.exec('rollback'))
afterAll(()=>db?.close())
async function failure(run:()=>Promise<unknown>,message:string|RegExp){await db.exec('savepoint expected_error');await expect(run()).rejects.toThrow(message);await db.exec('rollback to expected_error;release expected_error')}
async function login(user=userA){await db.exec(`reset role;set request.jwt.claim.sub='${user}';set role authenticated`)}
async function stats(id=estA,period='all'){return (await db.query<{v:Statistics}>('select public.read_restaurant_statistics($1,$2) v',[id,period])).rows[0].v}
async function reviews(id=estA,period='all',ratings:number[]|null=null,topic:string|null=null,polarity:string|null=null,cursor:ReviewPage['next']=null){return(await db.query<{v:ReviewPage}>('select public.read_restaurant_statistic_reviews($1,$2,$3,$4,$5,$6,$7,50) v',[id,period,ratings,topic,polarity,cursor?.before??null,cursor?.id??null])).rows[0].v}
it('counts all 1205 retained rows once, including shared/local copies; pagination reaches history beyond 150 and 1000',async()=>{
 await login();const s=await stats();expect(s.metrics.count).toBe(1205);expect(s.metrics.average).toBe(3);expect(s.metrics.low_count).toBe(723)
 expect(s.distribution.map(r=>r.count)).toEqual([241,241,241,241,241]);expect(s.comparison).toBeNull();expect(s.coverage.complete).toBe(false)
 let cursor:ReviewPage['next']=null;const ids:string[]=[]
 do{const page=await reviews(estA,'all',null,null,null,cursor);expect(page.total).toBe(1205);ids.push(...page.items.map(r=>r.source_id));cursor=page.next}while(cursor)
 expect(ids.length).toBe(1205);expect(new Set(ids).size).toBe(1205);expect(ids.at(-1)).not.toBe(ids[0])
},30000)
it('isolates membership, direct RPC calls, inactive restaurants and private fields',async()=>{
 await login();await failure(()=>stats(estB),'FORBIDDEN')
 await db.exec('reset role');await db.exec(`update public.establishments set active=false where id='${estA}'`);await login();await failure(()=>stats(),'FORBIDDEN')
},10000)
it('uses the pilot gate and the subscription, never another organization local corpus',async()=>{
 await login(userB);expect((await stats(estB)).metrics.count).toBe(1205);expect(JSON.stringify(await reviews(estB))).not.toContain('PRIVATE A')
 await db.exec(`reset role;delete from private.shared_restaurant_subscriptions where organization_id='${orgB}'`);await login(userB);expect((await stats(estB)).metrics.count).toBe(0)
 await db.exec(`reset role;delete from private.shared_restaurant_pilot_places`);await login();expect((await stats()).metrics.count).toBe(1205)
})
it('refuses anonymous access and direct private helper calls',async()=>{
 await db.exec('set role anon');await failure(()=>stats(),/permission denied/)
 await login();await failure(()=>db.query('select * from private.statistics_rows($1)',[estA]),/permission denied/)
 await db.exec("reset role;set request.jwt.claim.sub='';set role authenticated");await failure(()=>stats(),'UNAUTHORIZED')
})
it('keeps verified provider translations, original fallback and blank ratings without invented text',async()=>{
 await db.exec(`insert into public.review_translations select id,'fr','Texte français',encode(extensions.digest(original_text,'sha256'),'hex') from public.reviews where external_review_id='source-400';
 insert into public.review_translations select id,'fr','WRONG TRANSLATION','bad-hash' from public.reviews where external_review_id='source-800';
 update private.shared_restaurant_reviews set original_text='' where external_id='source-1200';`)
 await login();const p=await reviews();expect(p.items.find(r=>r.source_id==='source-400')?.display_text).toBe('Texte français');expect(p.items.find(r=>r.source_id==='source-800')?.translated).toBe(false)
 expect(p.items.find(r=>r.source_id==='source-1200')?.display_text).toBe('');expect((await stats()).metrics.count).toBe(1205)
})
it('uses saved polarity, independent of stars, with matching text/language; source drilldown is exact',async()=>{
 await db.exec(`insert into private.shared_jev_analyses(identity_sha256,establishment_id,google_review_id,state,identity,result)
 select 'analysis-'||external_review_id,establishment_id,external_review_id,'ready',jsonb_build_object('analysis_language','en','analysis_text_sha256',encode(extensions.digest(original_text,'sha256'),'hex')),
 '{"categories":{"service":{"status":"classified","classification":"mixed"},"quality":{"status":"classified","classification":"negative"}}}' from public.reviews where external_review_id in('source-4','source-5');
 insert into private.shared_restaurant_jev_keys select '${restaurant}',identity_sha256,identity_sha256 from private.shared_jev_analyses;
 update private.shared_jev_analyses set identity=jsonb_set(identity,'{analysis_text_sha256}','"obsolete"') where google_review_id='source-5';`)
 await login();const s=await stats();expect(s.topics.analyzed).toBe(1);expect(s.topics.text_count).toBe(1205)
 expect(s.topics.items.find(t=>t.key==='service')).toEqual({key:'service',positive:1,negative:1})
 const page=await reviews(estA,'all',null,'quality','negative');expect(page.total).toBe(1);expect(page.items[0].rating).toBe(5)
 await login(userB);expect((await stats(estB)).topics.analyzed).toBe(1)
})
it('keeps empty intervals empty, rejects future/undated ratings and does not fabricate chart points',async()=>{
 await db.exec(`update public.reviews set published_at=now()-interval '2 years';update private.shared_restaurant_reviews set published_at=now()-interval '2 years';
 update private.shared_restaurant_reviews set published_at=null where external_id='source-1';update private.shared_restaurant_reviews set published_at=now()+interval '1 day' where external_id='source-2'`)
 await login();const s=await stats(estA,'3m');expect(s.metrics).toEqual({count:0,average:null,low_count:0,low_percent:null});expect(s.series).toEqual([]);expect(s.coverage.excluded).toBe(2);expect((await reviews(estA,'3m')).total).toBe(0)
})
it('uses publication dates, rating-only reviews and exact equal calendar durations in restaurant time',async()=>{
 const rows=(await db.query<{start_date:string;end_date:string;days:number;previous_days:number}>(`select start_date::text,end_date::text,(end_at at time zone 'Asia/Ho_Chi_Minh')::date-start_date days,start_date-(previous_start at time zone 'Asia/Ho_Chi_Minh')::date previous_days from private.statistics_bounds('30d','Asia/Ho_Chi_Minh','2026-11-19T20:00:00Z')`)).rows[0]
 expect(rows).toEqual({start_date:'2026-10-22',end_date:'2026-11-20',days:30,previous_days:30})
 const month=(await db.query<{d:string}>(`select start_date::text d from private.statistics_bounds('3m','Asia/Ho_Chi_Minh','2026-05-31T05:00Z')`)).rows[0];expect(month.d).toBe('2026-02-28')
 const dst=(await db.query<{days:number;previous_days:number}>(`select (end_at at time zone 'Europe/Paris')::date-start_date days,start_date-(previous_start at time zone 'Europe/Paris')::date previous_days from private.statistics_bounds('30d','Europe/Paris','2026-04-05T12:00Z')`)).rows[0];expect(dst.days).toBe(dst.previous_days)
 await login();expect((await stats(estA,'30d')).metrics.count).toBeGreaterThan(0)
})
it('hides unreliable comparisons and handles zero denominators; reliable full coverage computes deltas',async()=>{
 await login();expect((await stats(estA,'30d')).comparison?.reliable).toBe(false)
 await db.exec(`reset role;delete from public.reviews;delete from private.shared_restaurant_reviews;
 insert into public.reviews(organization_id,establishment_id,external_review_id,published_at,rating,original_text) values
 ('${orgA}','${estA}','current-1',now()-interval '1 day',5,''),('${orgA}','${estA}','current-2',now()-interval '2 days',3,''),('${orgA}','${estA}','previous',now()-interval '40 days',2,'');
 update public.establishments set total_reviews=3,review_collection_status='complete',review_collection_expected=3,review_collection_unique=3,review_collection_checked_at=now() where id='${estA}';`)
 await login();const s=await stats(estA,'30d');expect(s.comparison).toMatchObject({reliable:true,count_change:100,average_change:2,low_percent_change:-50})
 await db.exec("reset role;update public.reviews set published_at=now()-interval '1 day'");await login();expect((await stats(estA,'30d')).comparison).toMatchObject({count_change:null,average_change:null,low_percent_change:null})
 await db.exec(`reset role;insert into public.review_retention_events values('${estA}',1)`);await login();expect((await stats(estA,'30d')).comparison?.reliable).toBe(false)
})
it('rating drilldowns sum to aggregate; invalid filters cannot bypass authorization',async()=>{
 await login();expect((await reviews(estA,'all',[1,2,3])).total).toBe(723);expect((await reviews(estA,'all',[5])).total).toBe(241)
 await failure(()=>stats(estA,'bogus'),'INVALID_PERIOD');await failure(()=>reviews(estA,'all',[6]),'INVALID_FILTER')
})
it('aggregates and paginates within bounded server time on 1205 reviews (local measurement, not a production SLA)',async()=>{
 await login();const times:number[]=[]
 for(let i=0;i<3;i++){const start=performance.now();await stats();times.push(Math.round(performance.now()-start))}
 const start=performance.now();await reviews();const pageMs=Math.round(performance.now()-start)
 mkdirSync('test-results',{recursive:true});writeFileSync('test-results/statistics-performance.json',JSON.stringify({fixtureReviews:1205,aggregateMs:times,firstPageMs:pageMs},null,2))
 expect((await stats()).metrics.count).toBe(1205)
})
it('rollback removes only the new functions/index and preserves the corpus',async()=>{
 await db.exec('commit');await db.exec(readFileSync('scripts/rollback/restaurant-statistics.sql','utf8'))
 expect((await db.query<{n:number}>('select count(*)::int n from public.reviews')).rows[0].n).toBe(1205)
 expect((await db.query<{p:string|null}>("select to_regprocedure('public.read_restaurant_statistics(uuid,text)')::text p")).rows[0].p).toBeNull()
})
