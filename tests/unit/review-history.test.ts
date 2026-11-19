// @vitest-environment node
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest'
import type {PGlite} from '@electric-sql/pglite'
import {readFileSync} from 'node:fs'
import {statisticsDatabase,estA,estB,orgA,orgB,userA,userB} from '../fixtures/statistics-database'
import {enableRealRetention} from '../fixtures/install-review-history'
import type {Statistics,ReviewPage} from '../../src/lib/restaurant-statistics'
import {prepareIncrementalResult} from '../../supabase/functions/_shared/incremental-review-sync'
import {reviewIngestionBundle} from '../../supabase/functions/_shared/sync-service'
let db:PGlite
beforeAll(async()=>{db=await statisticsDatabase(150);await enableRealRetention(db)},30000)
beforeEach(()=>db.exec('begin'))
afterEach(()=>db.exec('rollback'))
afterAll(()=>db?.close())
async function login(user=userA){await db.exec(`reset role;set request.jwt.claim.sub='${user}';set role authenticated`)}
async function stats(est=estA){return (await db.query<{v:Statistics}>('select public.read_restaurant_statistics($1,\'all\') v',[est])).rows[0].v}
async function pages(est=estA){let cursor:ReviewPage['next']=null;const rows:ReviewPage['items']=[];let total=0;do{
 const p=(await db.query<{v:ReviewPage}>('select public.read_restaurant_statistic_reviews($1,\'all\',null,null,null,$2,$3,50) v',[est,cursor?.before??null,cursor?.id??null])).rows[0].v
 total=p.total;rows.push(...p.items);cursor=p.next
 }while(cursor);return {rows,total}}
const date=(days:number)=>new Date(Date.now()-days*86400000).toISOString()
const row=(id:string,days=1,est=estA,org=orgA)=>({establishment_id:est,organization_id:org,external_review_id:id,rating:2,original_text:'Original '+id,text:'Original '+id,original_language:'en',published_at:date(days),provider_scraped_at:date(0),author_name:'Fixture',source_provider:'apify',historical_import:false,requires_attention:true,requires_ai_analysis:true,status:'to_process'})
async function ingest(bundle:unknown[],est=estA,org=orgA){await db.exec('reset role;set role service_role');return(await db.query<{v:{inserted:number;retained:number}}>("select public.ingest_recent_reviews($1,$2,$3,'apify') v",[est,org,JSON.stringify(bundle)])).rows[0].v}
async function fails(run:()=>Promise<unknown>,error:string|RegExp){await db.exec('savepoint rejected');await expect(run()).rejects.toThrow(error);await db.exec('rollback to rejected;release rejected')}

it('seeds current rows only, records start independently of old review dates, and excludes private data',async()=>{
 await login();const s=await stats();expect(s.metrics.count).toBe(150);expect(s.coverage.history_started_at).toBeTruthy();expect(Date.parse(s.coverage.history_started_at!)).toBeGreaterThan(Date.parse(s.coverage.first_date!));expect(s.coverage.complete).toBe(false)
 await db.exec('reset role');const dump=JSON.stringify((await db.query('select * from private.review_history')).rows)
 expect(dump).not.toContain('PRIVATE A');expect(dump).not.toContain('reply_draft');expect(dump).not.toContain('requires_ai_analysis')
 for(const table of ['notifications','review_sync_jobs','initial_import_jobs','current_report_publications'])expect((await db.query<{n:number}>(`select count(*)::int n from public.${table}`)).rows[0].n).toBe(0)
})
it('real ingestion/retention evicts old active rows but aggregate, pages and saved translations retain them',async()=>{
 const evidence={language:'fr',generated_at:'2026-10-01',proof:[{source_id:'source-150',text:'Frozen evidence'}]}
 await db.query('insert into public.current_report_publications values($1,$2,false,null,now())',[estA,JSON.stringify(evidence)])
 await db.exec(`insert into public.review_translations(review_id,language,translated_text,source_text_sha256) select id,'fr','Ancien avis traduit',encode(extensions.digest(original_text,'sha256'),'hex') from public.reviews where external_review_id='source-150'`)
 const before=(await db.query<{id:string}>('select id from public.reviews where external_review_id=\'source-150\'')).rows[0].id
 expect(await ingest(Array.from({length:8},(_,i)=>({row:row('new-'+i,1+i/100)})))).toEqual({inserted:8,retained:150})
 await db.exec('reset role');expect((await db.query('select id from public.reviews where id=$1',[before])).rows).toHaveLength(0)
 expect((await db.query<{n:number}>('select count(*)::int n from public.retained_review_ids($1)',[estA])).rows[0].n).toBe(150)
 expect((await db.query('select scope from public.current_report_publications where establishment_id=$1',[estA])).rows[0].scope).toEqual(evidence)
 await login();const s=await stats(),p=await pages();expect(s.metrics.count).toBe(158);expect(p.total).toBe(158);expect(p.rows).toHaveLength(158);expect(new Set(p.rows.map(r=>r.source_id)).size).toBe(158)
 expect(p.rows.find(r=>r.source_id==='source-150')).toMatchObject({review_id:before,display_text:'Ancien avis traduit',translated:true})
 expect(s.distribution.reduce((n,r)=>n+r.count,0)).toBe(p.total)
 await login(userB);expect((await stats(estB)).metrics.count).toBe(158)
})
it('saves an older collected row even when admission rejects it from the active 150',async()=>{
 expect(await ingest([{row:row('outside-window',800)}])).toEqual({inserted:0,retained:150})
 await db.exec('reset role');expect((await db.query("select 1 from public.reviews where external_review_id='outside-window'")).rows).toHaveLength(0)
 await login();expect((await stats()).metrics.count).toBe(151);expect((await pages()).rows.some(r=>r.source_id==='outside-window')).toBe(true)
})
it.each([['fr','vi'],['vi','fr']])('deduplicates both language arrival orders %s/%s and replay, preserves a genuine edit as one review',async(first,second)=>{
 const original=row('versioned',3)
 for(const [i,language] of [first,second,first].entries())await ingest([{row:{...original,provider_scraped_at:date(-i/10000)},translations:[{language,translated_text:language==='fr'?'Texte français':'Nội dung tiếng Việt'}]}])
 await login();expect((await stats()).metrics.count).toBe(151);expect((await pages()).rows.find(r=>r.source_id==='versioned')?.display_text).toBe('Texte français')
 await login(userB);expect((await pages(estB)).rows.find(r=>r.source_id==='versioned')?.display_text).toBe('Nội dung tiếng Việt')
 await ingest([{row:{...original,published_at:date(1),original_text:'Changed original',text:'Changed original',rating:4,provider_scraped_at:date(-1)}}])
 await login();const edited=(await pages()).rows.find(r=>r.source_id==='versioned')!;expect(edited).toMatchObject({original_text:'Changed original',display_text:'Changed original',translated:false,rating:4});expect(Date.parse(edited.published_at)).toBe(Date.parse(original.published_at));expect((await stats()).metrics.count).toBe(151)
 await db.exec('reset role');expect((await db.query<{n:number}>("select count(*)::int n from private.review_history_translations where scope_kind='shared' and external_id='versioned'")).rows[0].n).toBe(2)
})
it('does not let a late older observation undo a newer review version',async()=>{
 const r=row('late',3);await ingest([{row:{...r,original_text:'New',text:'New',provider_scraped_at:date(-1)}}]);await ingest([{row:{...r,provider_scraped_at:date(1)}}])
 await login();expect((await pages()).rows.find(r=>r.source_id==='late')?.original_text).toBe('New');expect((await stats()).metrics.count).toBe(151)
})
it('isolates direct calls, non-pilot scopes and unsubscribe without deleting the other account history',async()=>{
 await ingest([{row:row('new',2)}]);await login();await fails(()=>stats(estB),'FORBIDDEN');await fails(()=>db.query('select * from private.review_history'),/permission denied/)
 await fails(()=>db.query("select private.retain_review_history_bundle($1,$2,'[]')",[estB,orgB]),/permission denied/)
 await db.exec(`reset role;delete from private.shared_restaurant_subscriptions where organization_id='${orgB}'`);await login(userB);expect((await stats(estB)).metrics.count).toBe(0)
 await login();expect((await stats()).metrics.count).toBe(151)
 await db.exec('reset role;delete from private.shared_restaurant_pilot_places');await login();expect((await stats()).metrics.count).toBe(151)
 await login(userB);expect((await stats(estB)).metrics.count).toBe(0)
 await db.exec(`reset role;update public.establishments set active=false where id='${estA}'`);await login();await fails(()=>stats(),'FORBIDDEN')
})
it('invalid ingestion rolls back history and leaves synchronization cursors and publications untouched',async()=>{
 await db.exec(`update public.establishments set last_review_id='cursor',last_review_at=now()-interval '1 day',next_sync_at=now()+interval '2 hours';insert into public.current_report_publications values('${estA}','{"proof":"keep"}',false,null,now())`)
 const before=await db.query(`select id,last_review_id,last_review_at,next_sync_at from public.establishments order by id`)
 await db.exec('set role service_role');await fails(()=>db.query("select public.ingest_recent_reviews($1,$2,$3,'apify')",[estA,orgA,JSON.stringify([{row:row('bad',2,estB,orgB)}])]),'INGESTION_SCOPE_INVALID')
 await db.exec('reset role');expect((await db.query(`select id,last_review_id,last_review_at,next_sync_at from public.establishments order by id`)).rows).toEqual(before.rows)
 expect((await db.query("select scope from public.current_report_publications")).rows).toEqual([{scope:{proof:'keep'}}]);expect((await db.query("select 1 from private.review_history where external_id='bad'")).rows).toHaveLength(0)
})
it('real incremental preparation/commit captures the overlap and edited known review, without changing novelty or watermark rules',async()=>{
 const checkpoint=new Date((await db.query<{at:string}>("select published_at at from public.reviews where external_review_id='source-1'")).rows[0].at).toISOString()
 const job='60000000-0000-4000-8000-000000000001'
 const cp={google_id:'123',google_maps_url:'https://www.google.com/maps?cid=123',checkpoint_review_id:'source-1',checkpoint_review_at:checkpoint}
 const item=(reviewId:string,publishedAtDate:string)=>({cid:'123',reviewId,publishedAtDate,stars:2,text:'Updated '+reviewId,originalLanguage:'en',scrapedAt:date(0)})
 const plan=prepareIncrementalResult([item('new-sync',date(1)),item('source-1',checkpoint),item('older-overlap',date(3))],cp,{runId:'run',datasetId:'dataset',status:'SUCCEEDED'})
 expect(plan.reviews).toHaveLength(2);expect(plan.historyReviews).toHaveLength(3)
 const scope={id:estA,organization_id:orgA},bundle=reviewIngestionBundle(scope,plan.reviews,false,'apify')
 const result={run_id:'run',dataset_id:'dataset',since:plan.since,received:plan.received,unique:plan.unique,external_ids:plan.external_ids,outside_window:plan.outside_window,history_bundle:reviewIngestionBundle(scope,plan.historyReviews,false,'apify'),place:{rating:4,totalReviews:152}}
 await db.query("update public.establishments set last_review_id='source-1',last_review_at=$1 where id=$2",[checkpoint,estA])
 await db.query(`insert into public.review_sync_jobs(id,establishment_id,organization_id,status,locked_by,lease_until,checkpoint_review_id,checkpoint_review_at,apify_run_id,apify_dataset_id,incremental_receipt,incremental_received,incremental_version,incremental_build,incremental_input)
 values($1,$2,$3,'running','worker',now()+interval '10 minutes','source-1',$4,'run','dataset','{"id":"run","status":"SUCCEEDED"}',3,'google-reviews-incremental-v1','0.0.545',jsonb_build_object('reviewsStartDate',($4::timestamptz-interval '24 hours')::text))`,[job,estA,orgA,checkpoint])
 await db.exec('set role service_role')
 const commit=()=>db.query<{v:{added:number;head_id:string;retained:number}}>('select public.commit_incremental_review_sync_before_sharing($1,\'worker\',$2,$3) v',[job,JSON.stringify(bundle),JSON.stringify(result)])
 expect((await commit()).rows[0].v).toMatchObject({added:1,head_id:'new-sync',retained:150})
 expect((await commit()).rows[0].v).toMatchObject({added:1,head_id:'new-sync'}) // completed replay, no second write
 await login();expect((await stats()).metrics.count).toBe(152);const p=await pages();expect(p.total).toBe(152);expect(p.rows.find(r=>r.source_id==='source-1')?.original_text).toBe('Updated source-1');expect(p.rows.some(r=>r.source_id==='older-overlap')).toBe(true)
 await db.exec('reset role');expect((await db.query<{n:number}>('select count(*)::int n from public.retained_review_ids($1)',[estA])).rows[0].n).toBe(150)
})
it('rollback stops capture but preserves history and leaves the report window unchanged',async()=>{
 await ingest([{row:row('before-rollback',1)}]);await db.exec('reset role;commit')
 await db.exec(readFileSync('scripts/rollback/review-history.sql','utf8'))
 expect((await db.query<{n:number}>("select count(*)::int n from private.review_history where scope_kind='local'")).rows[0].n).toBe(151)
 await ingest([{row:row('after-rollback',1)}]);await db.exec('reset role')
 expect((await db.query<{n:number}>("select count(*)::int n from private.review_history where scope_kind='local'")).rows[0].n).toBe(151)
 expect((await db.query<{n:number}>('select count(*)::int n from public.retained_review_ids($1)',[estA])).rows[0].n).toBe(150)
})
