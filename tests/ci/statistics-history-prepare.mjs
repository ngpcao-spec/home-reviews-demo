// Real ephemeral Supabase only. No provider endpoints and no production data.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createRequire} from 'node:module'
import {join} from 'node:path'
import assert from 'node:assert/strict'
const require=createRequire(join(process.env.CI_PG_PACKAGE,'package.json'))
const {Client}=require('pg'),status=JSON.parse(readFileSync(process.env.CI_SUPABASE_STATUS,'utf8'))
const url=new URL(status.DB_URL)
if(!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='54322')throw Error('LOCAL_DATABASE_REQUIRED')
const fixture=JSON.parse(readFileSync(process.env.CI_AUTH_FIXTURE,'utf8'))
const db=new Client({connectionString:status.DB_URL}),writer=new Client({connectionString:status.DB_URL,application_name:'history-transition-writer'})
await Promise.all([db.connect(),writer.connect()])
const placeId='ChIJTQBISo9ncDERyPcP3aY9kI4',languages=['fr','vi'],establishments=[],privateEstablishments=[]
const now=Date.now(),date=days=>new Date(now-days*86400000).toISOString()
try{
 for(let i=0;i<2;i++){
  const user=fixture.users[i];await db.query('update public.profiles set preferred_language=$2 where user_id=$1',[user.id,languages[i]])
  const e=(await db.query(`insert into public.establishments(organization_id,name,google_id,place_id,google_maps_url,collection_language,initialized_at,last_sync_at,sync_status)
   values($1,'K.HOUSE Restaurant','10272778536914778056',$2,'https://www.google.com/maps?cid=10272778536914778056',$3,now(),now(),'ok') returning id`,[user.organizationId,placeId,languages[i]])).rows[0].id
  const restaurant=(await db.query("select public.subscribe_verified_shared_restaurant($1,'K.HOUSE Restaurant','https://www.google.com/maps?cid=10272778536914778056',$2,$3,$4) id",[placeId,user.organizationId,user.id,languages[i]])).rows[0].id
  await db.query('insert into private.shared_restaurant_establishments(establishment_id,restaurant_id,organization_id) values($1,$2,$3)',[e,restaurant,user.organizationId])
  establishments.push(e)
  privateEstablishments.push((await db.query("insert into public.establishments(organization_id,name,google_id,google_maps_url,collection_language,initialized_at) values($1,$2,$3,'https://www.google.com/maps?cid=900',$4,now()) returning id",[user.organizationId,'Private '+languages[i],'private-'+i,languages[i]])).rows[0].id)
 }
 const bundle=(id,days)=>({row:{establishment_id:establishments[0],organization_id:fixture.users[0].organizationId,external_review_id:id,published_at:date(days),rating:5,original_text:'Original '+id,text:'Original '+id,original_language:'en',provider_scraped_at:date(0),author_name:'Synthetic customer',historical_import:true,requires_attention:false,requires_ai_analysis:false,status:'ignored'},translations:[{language:'fr',translated_text:'Traduction française '+id},{language:'vi',translated_text:'Bản dịch tiếng Việt '+id}]})
 await db.query('set role service_role')
 await db.query("select public.ingest_recent_reviews($1,$2,$3,'apify')",[establishments[0],fixture.users[0].organizationId,JSON.stringify(Array.from({length:150},(_,i)=>bundle('seed-'+(i+1),i+10)))])
 await db.query('reset role')
 await db.query('select public.capture_shared_review_corpus($1)',[establishments[0]])
 // Linearization point: the migration obtains its actual table locks before
 // seeding. A real ingest submitted during this interval must wait, then be captured.
 await db.query('begin')
 await db.query('lock table public.reviews,public.review_translations,private.shared_restaurant_reviews,private.shared_restaurant_review_translations in share row exclusive mode')
 let finished=false
 await writer.query('set role service_role')
 const pending=writer.query("select public.ingest_recent_reviews($1,$2,$3,'apify')",[establishments[0],fixture.users[0].organizationId,JSON.stringify([bundle('transition-new',1)])]).then(()=>{finished=true})
 await db.query('select pg_sleep(0.2)');assert.equal(finished,false)
 assert.equal((await db.query("select count(*)::int n from pg_stat_activity where application_name='history-transition-writer' and wait_event_type='Lock'")).rows[0].n,1)
 const migration=readFileSync('supabase/migrations/20261119120255_retained_review_history.sql','utf8')
 assert.match(migration,/^begin;\r?$/m);assert.match(migration,/commit;\s*$/)
 await db.query(migration.replace(/^begin;\r?$/m,'').replace(/commit;\s*$/,''));await db.query('commit');await pending
 await db.query(readFileSync('supabase/migrations/20261119120531_statistics_retained_history.sql','utf8'))
 const seedCount=(await db.query("select count(*)::int n from private.review_history where scope_kind='local' and scope_id=$1 and external_id like 'seed-%'",[establishments[0]])).rows[0].n
 assert.equal(seedCount,150)
 assert.equal((await db.query("select count(*)::int n from private.review_history where scope_kind='local' and scope_id=$1",[establishments[0]])).rows[0].n,151)
 // Replay the same result then add seven others; never contact a provider.
 await writer.query("select public.ingest_recent_reviews($1,$2,$3,'apify')",[establishments[0],fixture.users[0].organizationId,JSON.stringify([bundle('transition-new',1),...Array.from({length:7},(_,i)=>bundle('after-'+i,2+i/10))])])
 assert.equal((await db.query('select count(*)::int n from public.retained_review_ids($1)',[establishments[0]])).rows[0].n,150)
 for(let i=0;i<2;i++){
  await db.query('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[fixture.users[i].id]);await db.query('set local role authenticated')
  const result=(await db.query("select public.read_restaurant_statistics($1,'all') v",[establishments[i]])).rows[0].v
  assert.equal(result.metrics.count,158);assert.equal(result.distribution.reduce((n,r)=>n+r.count,0),158)
  await db.query('rollback')
 }
 assert.equal((await db.query('select count(*)::int n from public.notifications')).rows[0].n,0)
 assert.equal((await db.query('select count(*)::int n from public.review_sync_jobs')).rows[0].n,0)
 mkdirSync('test-results/statistics-history',{recursive:true})
 writeFileSync('test-results/statistics-history/transition.json',JSON.stringify({migrationWaitObserved:true,seedReviewsPreserved:seedCount,distinctHistory:158,reportSelection:150,replayDuplicated:false,notifications:0,providerCalls:0},null,2))
 writeFileSync(process.env.CI_AUTH_FIXTURE,JSON.stringify({...fixture,establishments,privateEstablishments}))
 await db.query("notify pgrst,'reload schema'")
 console.log('HISTORY_TRANSITION_AND_SEED_PASSED')
}finally{await Promise.allSettled([db.query('rollback'),writer.query('rollback')]);await Promise.all([db.end(),writer.end()])}
