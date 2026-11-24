import {test,expect,type Page} from '@playwright/test'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createRequire} from 'node:module'
import {join} from 'node:path'
const place='ChIJTQBISo9ncDERyPcP3aY9kI4'
test('automatic menus through real Auth, imports, PostgreSQL and Edge worker with simulated Apify',async({browser})=>{
 test.setTimeout(240000)
 const fixture=JSON.parse(readFileSync(process.env.CI_AUTH_FIXTURE!,'utf8')),status=JSON.parse(readFileSync(process.env.CI_SUPABASE_STATUS!,'utf8'))
 if(!['localhost','127.0.0.1'].includes(new URL(status.API_URL).hostname))throw Error('LOCAL_ONLY')
 const require=createRequire(join(process.env.CI_PG_PACKAGE!,'package.json')),PG=require('pg').Client
 const db=new PG({connectionString:status.DB_URL});await db.connect()
 const rows=async(sql:string,args:unknown[]=[]) => (await db.query(sql,args)).rows
 const provider=async()=>await(await fetch('http://127.0.0.1:4411/control/status')).json()
 const worker=async(name:string,body:unknown={})=>{
  const r=await fetch(status.API_URL+'/functions/v1/'+name,{method:'POST',headers:{'Content-Type':'application/json','x-home-reviews-scheduler':fixture.scheduler},body:JSON.stringify(body)})
  const data=await r.json();expect(r.status,JSON.stringify(data)).toBeLessThan(300);return data
 }
 const invoke=async(page:Page,name:string,body:unknown)=>page.evaluate(async({name,body})=>{
  const {supabase}=await import(/* @vite-ignore */'/src/lib/supabase.ts')
  const r=await supabase.functions.invoke(name,{body})
  return {data:r.data,error:r.error?{status:r.error.context?.status,message:r.error.message}:null}
 },{name,body})
 const contexts=await Promise.all([0,1].map(()=>browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})))
 const pages:Page[]=[],passed:string[]=[]
 mkdirSync('test-results/automatic-menus',{recursive:true})
 const mark=(name:string)=>{passed.push(name);writeFileSync('test-results/automatic-menus/receipt.json',JSON.stringify({passed}));console.log('MENU_SCENARIO_PASSED',name)}
 try{
  expect((await rows('select automatic_enabled,launches_enabled,budget_limit_usd from private.rainminer_menu_config'))[0]).toEqual({automatic_enabled:false,launches_enabled:false,budget_limit_usd:'0.000000'})
  await rows("update private.rainminer_menu_config set automatic_enabled=true,launches_enabled=true,configured_at=now(),budget_limit_usd=2")
  await rows("select vault.create_secret('https://home-reviews-ci.invalid/functions/v1/rainminer-menu','home_reviews_rainminer_worker_url')")
  for(let i=0;i<2;i++){
   const p=await contexts[i].newPage();pages.push(p)
   await p.addLocatorHandler(p.getByRole('dialog',{name:'Restez informé des nouveaux avis'}),()=>p.getByRole('button',{name:'Plus tard',exact:true}).click())
   await p.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort())
   await p.goto('/')
   const id=await p.evaluate(async user=>{
    const {supabase}=await import(/* @vite-ignore */'/src/lib/supabase.ts')
    const result=await supabase.auth.signInWithPassword(user);if(result.error)throw result.error
    return (await supabase.auth.getUser()).data.user.id
   },{email:fixture.users[i].email,password:fixture.users[i].password})
   expect(id).toBe(fixture.users[i].id)
   await p.goto('/etablissements/ajouter')
   await p.getByRole('textbox').fill('https://www.google.com/maps?query_place_id='+place)
   await p.getByRole('button',{name:'Rechercher l’établissement',exact:true}).click()
   await expect(p.getByRole('button',{name:'Ajouter cet établissement',exact:true})).toBeVisible()
  }
  await Promise.all(pages.map(p=>p.getByRole('button',{name:'Ajouter cet établissement',exact:true}).click()))
  await expect.poll(async()=>Number((await rows('select count(*) n from initial_import_jobs'))[0].n)).toBe(2)
  await pages[0].close() // No browser remains for this user's import/menu completion.
  await Promise.all([worker('process-initial-import-jobs'),worker('process-initial-import-jobs')])
  await rows("update initial_import_jobs set available_at=now() where status in ('queued','retry') and provider_start_attempted_at is null")
  await worker('process-initial-import-jobs')
  expect((await rows('select status,error_code from initial_import_jobs')).every((j:{status:string;error_code:string|null})=>j.status==='completed'&&!j.error_code)).toBe(true)
  expect((await rows('select * from private.rainminer_menu_enqueue_errors'))).toHaveLength(0)
  expect((await rows('select status,trigger_kind from rainminer_menu_jobs'))).toEqual([{status:'queued',trigger_kind:'automatic'}])
  expect((await rows('select * from private.rainminer_menu_requests'))).toHaveLength(2)
  expect((await provider()).menuRuns).toHaveLength(0);mark('two-real-imports-one-menu-queue-browser-closed')
  const establishments=await Promise.all(fixture.users.map(async(u:{organizationId:string})=>(await rows('select * from establishments where organization_id=$1',[u.organizationId]))[0]))
  // Two independent HTTP requests race against actual PostgreSQL and Edge workers.
  await Promise.all([worker('rainminer-menu',{action:'work'}),worker('rainminer-menu',{action:'work'})])
  expect((await provider()).menuRuns).toHaveLength(1)
  expect((await rows('select status from rainminer_menu_jobs'))).toEqual([{status:'running'}])
  await worker('rainminer-menu',{action:'work'})
  expect((await rows('select status from rainminer_menu_jobs'))).toEqual([{status:'completed'}])
  mark('concurrent-real-workers-single-provider-post')
  pages[0]=await contexts[0].newPage()
  for(let i=0;i<2;i++){
   const p=pages[i]
   if(i===1){
    await p.goto('/plus')
    await p.locator('#preferred-language').selectOption('vi')
    await expect.poll(async()=>(await rows('select preferred_language from profiles where user_id=$1',[fixture.users[1].id]))[0].preferred_language).toBe('vi')
   }
   await p.goto('/etablissements/'+establishments[i].id)
   const label=i===0?'Plats du restaurant':'Món ăn',panel=p.getByRole('region',{name:label})
   await expect(panel.getByText(i===0?'Menu disponible':'Đã có thực đơn',{exact:true})).toBeVisible()
   await expect(panel.getByText('Riz aux légumes',{exact:true})).toHaveCount(2)
   await expect(panel.getByText('Chef spécial',{exact:true})).toBeVisible()
   await expect(panel.getByText('Green tea',{exact:true})).toHaveCount(0)
   await panel.screenshot({path:'test-results/automatic-menus/menu-'+(i===0?'fr':'vi')+'.png'})
   const snapshot=await invoke(p,'rainminer-menu',{action:'status',establishment_id:establishments[i].id})
   expect(snapshot.error).toBeNull();expect(snapshot.data.result.counts).toMatchObject({received:4,excludedDrinks:1,retained:3,review:1})
   const forbidden=await invoke(p,'rainminer-menu',{action:'status',establishment_id:establishments[1-i].id})
   expect(forbidden.error?.status).toBe(404)
   const unsigned=await invoke(p,'rainminer-menu',{action:'start',establishment_id:establishments[i].id,request_id:crypto.randomUUID()})
   expect(unsigned.error?.status).toBe(400)
  }
  mark('fr-vi-panel-raw-preserved-and-authorization')
  expect((await rows('select raw from rainminer_menu_jobs'))[0].raw).toHaveLength(4)
  expect((await rows('select * from private.shared_restaurant_menu_versions'))).toHaveLength(1)
  expect(Number((await rows("select count(*) n from notifications where type='new_negative_review'"))[0].n)).toBe(0)
  expect((await provider()).aiCalls).toBe(0)
  // Rejoining the same language takes the real shared fast path and saved menu.
  await pages[1].goto('/plus');await pages[1].locator('#preferred-language').selectOption('fr')
  await expect.poll(async()=>(await rows('select preferred_language from profiles where user_id=$1',[fixture.users[1].id]))[0].preferred_language).toBe('fr')
  const leave=await pages[1].evaluate(async id=>{
   const {supabase}=await import(/* @vite-ignore */'/src/lib/supabase.ts')
   const r=await supabase.rpc('remove_establishment_subscription',{p_establishment:id});return {error:r.error?.message??null}
  },establishments[1].id)
  expect(leave.error).toBeNull()
  const rejoin=await invoke(pages[1],'add-establishment',{organizationId:fixture.users[1].organizationId,expectedGoogleId:establishments[1].google_id,confirmed:true,query:'https://www.google.com/maps?query_place_id='+place})
  expect(rejoin.error,JSON.stringify(rejoin)).toBeNull()
  expect((await provider()).menuRuns).toHaveLength(1)
  expect((await invoke(pages[1],'rainminer-menu',{action:'status',establishment_id:establishments[1].id})).data.result.counts.retained).toBe(3)
  mark('shared-menu-reused-without-new-provider')
  // Prove old data is not enrolled when configuration changes.
  const before=Number((await rows('select count(*) n from rainminer_menu_jobs'))[0].n)
  await rows('update private.rainminer_menu_config set automatic_enabled=false,launches_enabled=false')
  await worker('rainminer-menu',{action:'work'})
  expect(Number((await rows('select count(*) n from rainminer_menu_jobs'))[0].n)).toBe(before)
  expect((await provider()).menuRuns).toHaveLength(1)
  expect((await provider()).runs).toHaveLength(1)
  expect((await provider()).aiCalls).toBe(0)
  mark('disabled-no-backfill-no-paid-retries')
 }finally{await Promise.all(contexts.map(c=>c.close()));await db.end()}
})
