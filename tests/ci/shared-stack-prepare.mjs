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
const isolatedSql=sql=>sql.replaceAll('https://ihuztjkblywzjdruusdj.supabase.co','http://127.0.0.1:9')
const restore=async name=>{
 console.log('RECONSTRUCTION',name)
 await db.query(isolatedSql(readFileSync(`supabase/reconstruction/${name}.sql`,'utf8')))
}
try{
 if((await db.query("select current_setting('cron.launch_active_jobs') value")).rows[0].value!=='off')throw Error('CRON_MUST_BE_DISABLED')
 if((await db.query("select to_regclass('public.organizations') is not null present")).rows[0].present)throw Error('EMPTY_DATABASE_REQUIRED')
 await db.query("select set_config('home.reconstruction','empty-ci-v1',false)")
 await db.query('create extension if not exists pg_cron')
 for(const file of readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')).sort()){
  console.log('MIGRATION',file)
  const before={
   '20261108071048_avoid_duplicate_jev_projection_refresh.sql':['order_shared_jev_scope_pin','notification_read_retention_guard'],
   '20261024052532_jev_batch_experimental_adapter.sql':['isolated_nha_trang_jev_eleven_batch_experiment','fix_isolated_jev_batch_claim_alias'],
   '20261025014412_recent_text_retention_transition.sql':['experiment_nha_trang_jev_five_batches','nha_trang_jev_corrected_isolated_experiment','nha_trang_jev_minimal_isolated_experiment'],
   '20261028083600_manual_atomic_review_reload.sql':['khouse_english_isolated_experiment'],
  }
  for(const restored of before[file]??[])await restore(restored)
  // Historical cron definitions must never address production, even with no secrets.
  let sql=isolatedSql(readFileSync(join('supabase/migrations',file),'utf8'))
  if(file==='20261010064000_v13_fresh_posthoc_ai_audit_18_cases.sql'){
   const start=sql.search(/\r?\nWITH\r?\n/)
   if(start<0||!sql.slice(start).includes('V13_POSTHOC_AUDIT_INCOMPLETE'))throw Error('POSTHOC_AUDIT_SUFFIX_CHANGED')
   sql=sql.slice(0,start)
   console.log('OMIT_HISTORICAL_18_REVIEW_ANNOTATIONS_KEEP_SCHEMA')
  }
  if(file==='20261025095207_reset_restaurant_content.sql'){
   // Historical tenant-data purge: only locks, temporary trigger switches and DML.
   // It has no lasting schema definitions and must never run during reconstruction.
   if(/\bcreate\s+(?:or\s+replace\s+)?(?:function|table|index|trigger|policy)/i.test(sql))throw Error('RESET_SCHEMA_CHANGED')
   console.log('OMIT_HISTORICAL_RESTAURANT_PURGE');continue
  }
  if(file==='20261025022056_recent_text_retention_cleanup.sql'){
   // Preserve its exact persistent FK and policy configuration, excluding the
   // historical backup-gated data deletion and temporary trigger disable/enable.
   const lines=sql.split(/\r?\n/)
   const schema=lines.filter(line=>line.startsWith('alter table public.analysis_jev_compact_items ')&&!line.includes('trigger user'))
   const policy=lines.filter(line=>line.startsWith('update public.review_corpus_policy set enabled=true,'))
   if(schema.length!==2||policy.length!==1)throw Error('RETENTION_CLEANUP_SCHEMA_CHANGED')
   sql=[...schema,...policy].join('\n')
   console.log('OMIT_HISTORICAL_RETENTION_DELETES_KEEP_SCHEMA_AND_CONFIGURATION')
  }
  if(file==='20260928160000_scalable_sync_runtime_retention_load_test.sql'){
   const start=sql.indexOf('insert into public.review_sync_load_test_results(')
   if(start<0||!sql.slice(start).includes('private.run_review_sync_queue_load_test(10000)'))throw Error('LOAD_TEST_SUFFIX_CHANGED')
   // Keep every schema/function/grant definition. This suffix executes a historical
   // benchmark against existing tenants; it is not part of empty schema creation.
   sql=sql.slice(0,start)
   console.log('OMIT_HISTORICAL_LOAD_BENCHMARK_ONLY')
  }
  try{await db.query(sql)}catch(error){console.error('MIGRATION_FAILED',file,error.code,error.message);throw Error('SCHEMA_BOOTSTRAP_FAILED')}
  if(file==='20260926064355_home_reviews_v1.sql'){
   for(const restored of ['after-v1','home_reviews_hourly_scheduler_schema']){
    await restore(restored)
   }
  }
  if(file==='20260927080953_simplify_review_ai.sql'){
   for(const restored of ['track_review_ai_processing_and_usage','track_review_ai_retry_history','retain_rejected_ai_outputs_for_audit']){
    await restore(restored)
   }
  }
  if(file==='20261008122506_artisan_negative_validation.sql'){
   for(const restored of ['add_separate_ai_preannotations_for_negative_validation','isolated_jev_ai_reference_exploration_v1','prepare_independent_artisan_v11_holdout_tables','holdout_ai_reference_schema']){
    await restore(restored)
   }
  }
  const auditPrerequisites={
   '20261009034656_ai_reference_dual_jev_benchmark.sql':['record_approved_jev_ai_rechecks_separately','create_english_translation_overrides_for_ai_audit'],
   '20261009071542_experimental_jev_v12_semantic_boundaries.sql':['record_v12_ai_missed_negative_diagnostics_separately'],
   '20261009141601_independent_jev_holdout_benchmark.sql':['independent_jev_holdout_post_prediction_ai_diagnostics_v1'],
  }
  for(const restored of auditPrerequisites[file]??[]){
   await restore(restored)
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
