// Only the disposable GitHub runner stack. Never accepts a remote database.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {join} from 'node:path'
const require=createRequire(join(process.env.CI_PG_PACKAGE,'package.json'))
const {Client}=require('pg')
const status=JSON.parse(readFileSync(process.env.CI_SUPABASE_STATUS,'utf8'))
const url=new URL(status.DB_URL)
if(!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='54322')throw Error('LOCAL_DATABASE_REQUIRED')
const db=new Client({connectionString:status.DB_URL});await db.connect()
try{
 if((await db.query("select current_setting('cron.launch_active_jobs') value")).rows[0].value!=='off')throw Error('CRON_MUST_BE_DISABLED')
 if((await db.query("select to_regclass('public.organizations') is not null present")).rows[0].present)throw Error('EMPTY_DATABASE_REQUIRED')
 await db.query("select set_config('home.reconstruction','empty-ci-v1',false)")
 await db.query('create extension if not exists pg_cron')
 for(const file of readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')).sort()){
  console.log('MIGRATION',file)
  // Historical cron definitions must never address production, even with no secrets.
  let sql=readFileSync(join('supabase/migrations',file),'utf8').replaceAll('https://ihuztjkblywzjdruusdj.supabase.co','http://127.0.0.1:9')
  try{await db.query(sql)}catch(error){console.error('MIGRATION_FAILED',file,error.code,error.message);throw Error('SCHEMA_BOOTSTRAP_FAILED')}
  if(file==='20260926064355_home_reviews_v1.sql'){
   for(const restored of ['after-v1','home_reviews_hourly_scheduler_schema']){
    console.log('RECONSTRUCTION',restored)
    await db.query(readFileSync(`supabase/reconstruction/${restored}.sql`,'utf8'))
   }
  }
  if(file==='20260927080953_simplify_review_ai.sql'){
   for(const restored of ['track_review_ai_processing_and_usage','track_review_ai_retry_history','retain_rejected_ai_outputs_for_audit']){
    console.log('RECONSTRUCTION',restored)
    await db.query(readFileSync(`supabase/reconstruction/${restored}.sql`,'utf8'))
   }
  }
 }
 console.log('SCHEMA_BOOTSTRAP_OK')
 const endpoint=new URL(status.API_URL)
 if(!['127.0.0.1','localhost'].includes(endpoint.hostname))throw Error('LOCAL_AUTH_REQUIRED')
 const users=[]
 for(let i=1;i<=2;i++){
  const email=`shared-org-${i}@example.test`,password=crypto.randomUUID()+'Aa1!'
  const response=await fetch(endpoint+'/auth/v1/admin/users',{method:'POST',headers:{apikey:status.SERVICE_ROLE_KEY,Authorization:'Bearer '+status.SERVICE_ROLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password,email_confirm:true})})
  const user=await response.json();if(!response.ok||!user.id)throw Error('LOCAL_AUTH_USER_CREATION_FAILED')
  await db.query("update profiles set preferred_language='fr' where user_id=$1",[user.id])
  const org=(await db.query('select organization_id from organization_members where user_id=$1',[user.id])).rows[0]?.organization_id
  if(!org)throw Error('LOCAL_AUTH_ORGANIZATION_MISSING')
  users.push({id:user.id,email,password,organizationId:org})
 }
 if(users[0].organizationId===users[1].organizationId)throw Error('ORGANIZATIONS_NOT_ISOLATED')
 const scheduler=crypto.randomUUID(),webhook=crypto.randomUUID()
 await db.query("insert into private.review_scheduler_credentials(singleton,token_hash) values(true,encode(extensions.digest($1,'sha256'),'hex')) on conflict(singleton) do update set token_hash=excluded.token_hash",[scheduler])
 await db.query('update public.ai_webhook_config set secret=$1',[webhook])
 // Test-local configuration only. The deployable migration allowlist stays empty.
 await db.query("update private.shared_restaurant_runtime set enabled=true")
 await db.query("insert into private.shared_restaurant_pilot_places(place_id,verification_evidence) values('ChIJTQBISo9ncDERyPcP3aY9kI4','Explicit synthetic K.HOUSE validation fixture, not production activation')")
 await db.query("update public.review_corpus_policy set paused=false,ingestions_paused=false")
 await db.query("select public.register_shared_restaurant_resolution($1::jsonb)",[JSON.stringify({placeId:'ChIJTQBISo9ncDERyPcP3aY9kI4',googleId:'10272778536914778056',name:'K.HOUSE Restaurant',fullAddress:'Nha Trang — isolated fixture',rating:4.5,totalReviews:1,locationLink:'https://www.google.com/maps?cid=10272778536914778056',photo:null})])
 await db.query("notify pgrst,'reload schema'")
 writeFileSync(process.env.CI_AUTH_FIXTURE,JSON.stringify({users,scheduler,webhook}))
 writeFileSync('.env.local',`VITE_SUPABASE_URL=${status.API_URL}\nVITE_SUPABASE_ANON_KEY=${status.ANON_KEY}\nVITE_DEMO_MODE=false\n`)
 console.log('TWO_REAL_AUTH_USERS_READY')
}finally{await db.end()}
