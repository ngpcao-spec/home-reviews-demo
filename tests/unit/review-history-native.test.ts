// @vitest-environment node
import {it,expect} from 'vitest'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {join,resolve} from 'node:path'
import {mkdirSync,writeFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {createServer} from 'node:net'
import type {PGlite} from '@electric-sql/pglite'
import {statisticsDatabase,estA,estB,orgA,orgB,userA,userB} from '../fixtures/statistics-database'
import {enableRealRetention} from '../fixtures/install-review-history'

// Optional native dependency provided by the local test environment, never a hosted URL.
it.skipIf(!process.env.HISTORY_NATIVE_PACKAGE)('two real PostgreSQL connections ingest the same source concurrently without duplicating history',async()=>{
 const require=createRequire(join(resolve(process.env.HISTORY_NATIVE_PACKAGE!),'package.json'))
 const {default:EmbeddedPostgres}=await import(/* @vite-ignore */pathToFileURL(require.resolve('embedded-postgres')).href)
 const directory=resolve('test-results','history-postgres-'+crypto.randomUUID());mkdirSync(directory,{recursive:true})
 const password=crypto.randomUUID()
 const port=await new Promise<number>((resolve,reject)=>{const server=createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const address=server.address();if(!address||typeof address==='string')return reject(Error('LOCAL_PORT_UNAVAILABLE'));server.close(()=>resolve(address.port))})})
 const pg=new EmbeddedPostgres({databaseDir:directory,port,user:'postgres',password,persistent:true,
  initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}})
 let main:ReturnType<typeof pg.getPgClient>|undefined,a:ReturnType<typeof pg.getPgClient>|undefined,b:ReturnType<typeof pg.getPgClient>|undefined
 try{
  await pg.initialise();await pg.start();main=pg.getPgClient('postgres','127.0.0.1');await main.connect();console.info('HISTORY_NATIVE_STARTED')
  const adapter={waitReady:Promise.resolve(),exec:(sql:string)=>main!.query(sql),query:(sql:string,params?:unknown[])=>main!.query(sql,params)} as unknown as PGlite
  await statisticsDatabase(150,adapter);await enableRealRetention(adapter);console.info('HISTORY_NATIVE_SCHEMA_READY')
  const security=await main.query("select c.relrowsecurity rls,has_table_privilege('authenticated',c.oid,'SELECT') readable from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('review_history','review_history_scopes','review_history_translations')")
  expect(security.rows).toHaveLength(3);expect(security.rows.every((r:{rls:boolean;readable:boolean})=>r.rls&&!r.readable)).toBe(true)
  const functions=await main.query("select p.proname,p.prosecdef,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,has_function_privilege('anon',p.oid,'EXECUTE') anonymous from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('save_review_history','retain_review_history_bundle','retain_incremental_review_history','retain_review_history_row')")
  expect(functions.rows).toHaveLength(4);expect(functions.rows.every((r:{prosecdef:boolean;authenticated:boolean;anonymous:boolean})=>r.prosecdef&&!r.authenticated&&!r.anonymous)).toBe(true)
  a=pg.getPgClient('postgres','127.0.0.1');b=pg.getPgClient('postgres','127.0.0.1');await Promise.all([a.connect(),b.connect()])
  await Promise.all([a.query('set role service_role'),b.query('set role service_role')])
  const bundle=(establishment_id:string,organization_id:string,language:string)=>JSON.stringify([{row:{establishment_id,organization_id,external_review_id:'concurrent',rating:2,original_text:'Shared original',original_language:'en',published_at:new Date(Date.now()-3600000).toISOString(),provider_scraped_at:new Date().toISOString(),private_draft:'DO NOT SHARE'},translations:[{language,translated_text:language==='fr'?'Texte français':'Nội dung tiếng Việt'}]}])
  // Both INSERTs block on the same shared history key in the real server.
  await a.query('begin')
  await a.query("select public.ingest_recent_reviews($1,$2,$3,'apify')",[estA,orgA,bundle(estA,orgA,'fr')])
  let secondFinished=false
  const pending=b.query("select public.ingest_recent_reviews($1,$2,$3,'apify')",[estB,orgB,bundle(estB,orgB,'vi')]).then(()=>{secondFinished=true})
  await main.query('select pg_sleep(0.15)');expect(secondFinished).toBe(false)
  const blocked=await main.query("select count(*)::int n from pg_stat_activity where wait_event_type='Lock' and query like 'select public.ingest_recent_reviews%'")
  expect(blocked.rows[0].n).toBe(1);await a.query('commit');await pending
  expect((await main.query("select count(*)::int n from private.review_history where scope_kind='shared' and external_id='concurrent'")).rows[0].n).toBe(1)
  expect((await main.query("select count(*)::int n from private.review_history_translations where scope_kind='shared' and external_id='concurrent'")).rows[0].n).toBe(2)
  for(const [client,user,est] of [[a,userA,estA],[b,userB,estB]] as const){
   await client!.query(`reset role;set request.jwt.claim.sub='${user}';set role authenticated`)
   expect((await client!.query("select public.read_restaurant_statistics($1,'all') v",[est])).rows[0].v.metrics.count).toBe(151)
  }
  writeFileSync('test-results/review-history-native.json',JSON.stringify({connections:2,observedBlocking:true,sharedReviewRows:1,translationLanguages:2,statisticsPerAccount:151,providerCalls:0},null,2))
  if(process.env.HISTORY_RUN_ADVISORS==='1'){
   try{
   const report=execFileSync(process.execPath,[resolve('node_modules/supabase/dist/supabase.js'),'db','advisors','--db-url',`postgresql://postgres:${password}@127.0.0.1:${port}/postgres?sslmode=disable`,'--type','all','--level','warn','--fail-on','none','--output-format','json'],{encoding:'utf8',windowsHide:true,timeout:30000,stdio:['ignore','pipe','pipe']})
   writeFileSync('test-results/review-history-advisors.json',report)
   }catch(error){
    const failure=error as {stderr?:string|Buffer,stdout?:string|Buffer,code?:string,status?:number}
    writeFileSync('test-results/review-history-advisors.json',JSON.stringify({status:'unavailable',code:failure.code??null,exitStatus:failure.status??null,detail:String(failure.stderr??'').replaceAll(password,'[test password removed]'),output:String(failure.stdout??'').replaceAll(password,'[test password removed]')},null,2))
   }
  }
 }finally{await Promise.allSettled([a?.end(),b?.end(),main?.end()]);await pg.stop()}
},60000)
