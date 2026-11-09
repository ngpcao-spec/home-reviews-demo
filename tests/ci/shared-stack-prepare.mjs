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
 if((await db.query("show cron.launch_active_jobs")).rows[0].cron_launch_active_jobs==='on')throw Error('CRON_MUST_BE_DISABLED')
 for(const file of readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')).sort()){
  console.log('MIGRATION',file)
  // Historical cron definitions must never address production, even with no secrets.
  const sql=readFileSync(join('supabase/migrations',file),'utf8').replaceAll('https://ihuztjkblywzjdruusdj.supabase.co','http://127.0.0.1:9')
  try{await db.query(sql)}catch(error){console.error('MIGRATION_FAILED',file,error.code,error.message);throw Error('SCHEMA_BOOTSTRAP_FAILED')}
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
 writeFileSync(process.env.CI_AUTH_FIXTURE,JSON.stringify({users}))
 writeFileSync('.env.local',`VITE_SUPABASE_URL=${status.API_URL}\nVITE_SUPABASE_ANON_KEY=${status.ANON_KEY}\nVITE_DEMO_MODE=false\n`)
 console.log('TWO_REAL_AUTH_USERS_READY')
}finally{await db.end()}
