import {test,expect,type Page,type Locator} from '@playwright/test'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createRequire} from 'node:module'
import {join} from 'node:path'
import type {DishProfile,DishMatch} from '../../src/lib/restaurant-dishes'

test('saved menus, two real Auth accounts, permissions, manual corrections and mobile FR/VI',async({browser})=>{
 test.setTimeout(240000)
 const fixture=JSON.parse(readFileSync(process.env.CI_AUTH_FIXTURE!,'utf8'))
 const status=JSON.parse(readFileSync(process.env.CI_SUPABASE_STATUS!,'utf8'))
 for(const endpoint of [status.API_URL,status.DB_URL])if(!['127.0.0.1','localhost'].includes(new URL(endpoint).hostname))throw Error('ISOLATED_ENDPOINT_REQUIRED')
 const require=createRequire(join(process.env.CI_PG_PACKAGE!,'package.json')),PG=require('pg').Client
 const db=new PG({connectionString:status.DB_URL});await db.connect()
 const rows=async(sql:string,args:unknown[]=[]) => (await db.query(sql,args)).rows
 const saved=JSON.parse(readFileSync('tests/fixtures/banh-can-menu-saved.json','utf8'))
 const folder='test-results/dishes-auth';mkdirSync(folder,{recursive:true})
 const passed:string[]=[],captures:string[]=[],dimensions:unknown[]=[]
 const record=()=>writeFileSync(folder+'/receipt.json',JSON.stringify({commit:process.env.GITHUB_SHA,passed,captures,dimensions,auth:'Two real GoTrue users and independent browser sessions',database:'Disposable Supabase PostgreSQL; complete schema reconstruction',sourceRun:saved.runId,providerCalls:0,productionModified:false},null,2))
 const mark=(name:string)=>{passed.push(name);record();console.log('DISH_SCENARIO_PASSED',name)}
 const contexts=await Promise.all([0,1].map(()=>browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1})))
 const pages:Page[]=[],establishments:string[]=[],privateEstablishments:string[]=[]
 const rpc=async<T>(page:Page,name:string,args:Record<string,unknown>={})=>page.evaluate(async({name,args})=>{
  const {supabase}=await import(/* @vite-ignore */'/src/lib/supabase.ts')
  const {data,error}=await supabase.rpc(name,args);return {data,error:error?{message:error.message,code:error.code}:null}
 },{name,args}) as Promise<{data:T;error:null|{message:string;code:string}}>
 const profile=async(page:Page,id:string)=>{
  const r=await rpc<DishProfile>(page,'read_restaurant_dishes',{p_establishment:id});expect(r.error).toBeNull();return r.data
 }
 const capture=async(page:Page,name:string,anchor?:Locator)=>{
  if(anchor)await anchor.scrollIntoViewIfNeeded()
  await page.evaluate(()=>document.fonts.ready)
  const size=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}))
  expect(size.scroll).toBeLessThanOrEqual(size.viewport)
  await page.screenshot({path:folder+'/'+name+'.png',fullPage:false})
  captures.push(name+'.png');dimensions.push({name,...size});record()
 }
 const addMenu=async(id:string,placeId:string,raw:unknown[],result:unknown,runId:string)=>{
  await rows("insert into public.rainminer_menu_jobs(establishment_id,place_id,request_id,status,run_id,raw,result,retrieved_at) values($1,$2,$3,'completed',$4,$5,$6,clock_timestamp())",[id,placeId,crypto.randomUUID(),runId,JSON.stringify(raw),JSON.stringify(result)])
 }
 const openEditor=async(page:Page,vi:boolean)=>{
  const button=page.getByRole('button',{name:vi?'Xác nhận hoặc sửa món ăn':'Confirmer ou corriger les plats',exact:true})
  if(await button.getAttribute('aria-expanded')!=='true')await button.click()
  return page.locator('.dish-editor')
 }
 const association=(editor:Locator,page:Page,name:string)=>editor.locator('li').filter({has:page.getByText(name,{exact:true})})
 try{
  expect((await rows("select current_setting('cron.launch_active_jobs') v"))[0].v).toBe('off')
  expect((await rows('select automatic_enabled,launches_enabled from private.rainminer_menu_config'))[0]).toEqual({automatic_enabled:false,launches_enabled:false})
  await rows('insert into private.shared_restaurant_pilot_places(place_id,verification_evidence) values($1,$2)',[saved.placeId,'Isolated saved-menu fixture only; no production activation'])
  for(let i=0;i<2;i++){
   const u=fixture.users[i],lang=i===0?'fr':'vi'
   await rows('update public.profiles set preferred_language=$2 where user_id=$1',[u.id,lang])
   const e=(await rows("insert into public.establishments(organization_id,name,google_id,place_id,collection_language,initialized_at,last_sync_at,sync_status,rating,total_reviews,address) values($1,$2,'saved-banh-fixture',$3,$4,now(),now(),'ok',4.3,0,'Nha Trang — validation isolée') returning id",[u.organizationId,saved.establishment,saved.placeId,lang]))[0].id
   establishments.push(e)
   const r=(await rows('select public.subscribe_verified_shared_restaurant($1,$2,$3,$4,$5,$6) id',[saved.placeId,saved.establishment,'https://www.google.com/maps?query_place_id='+saved.placeId,u.organizationId,u.id,lang]))[0].id
   await rows('insert into private.shared_restaurant_establishments(establishment_id,restaurant_id,organization_id) values($1,$2,$3)',[e,r,u.organizationId])
   privateEstablishments.push((await rows("insert into public.establishments(organization_id,name,google_id,initialized_at) values($1,$2,$3,now()) returning id",[u.organizationId,'Privé '+lang,'private-dish-'+i]))[0].id)
  }
  await addMenu(establishments[0],saved.placeId,saved.raw,saved.result,saved.runId)
  const phoIds:string[]=[]
  for(const [index,label] of ['Phở','Phở gà','Phở bò'].entries()){
   const placeId='ChIJIsolatedPho'+index
   const id=(await rows("insert into public.establishments(organization_id,name,google_id,place_id,initialized_at) values($1,$2,$3,$4,now()) returning id",[fixture.users[0].organizationId,['Phở générique — test','Bistro poulet — test','Bistro bœuf — test'][index],'pho-fixture-'+index,placeId]))[0].id
   phoIds.push(id);await addMenu(id,placeId,[{placeId,name:label,category:'Food'}],{references:[]},'isolated-pho-'+index)
  }
  for(let i=0;i<2;i++){
   const p=await contexts[i].newPage();pages.push(p)
   await p.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort('blockedbyclient'))
   await p.addLocatorHandler(p.getByRole('dialog',{name:/Restez informé|Luôn cập nhật/}),()=>p.getByRole('button',{name:/^(Plus tard|Để sau)$/}).click())
   await p.goto('/')
   const identity=await p.evaluate(async({email,password})=>{
    const {supabase}=await import(/* @vite-ignore */'/src/lib/supabase.ts')
    const signed=await supabase.auth.signInWithPassword({email,password});if(signed.error)throw Error(signed.error.message)
    const verified=await supabase.auth.getUser();if(verified.error)throw Error(verified.error.message);return verified.data.user.id
   },{email:fixture.users[i].email,password:fixture.users[i].password})
   expect(identity).toBe(fixture.users[i].id)
   await p.goto('/etablissements/'+establishments[i])
   await expect(p.locator('.dish-specialty')).toHaveText(new RegExp(i===0?'Spécialité : Bánh căn.*Proposée':'Đặc sản : Bánh căn.*Đề xuất'))
   await expect(p.locator('.dish-details>summary')).toHaveText(i===0?'Plats et variantes (11)':'Món ăn và biến thể (11)')
   await expect(p.getByText(/11 spécialités|11 đặc sản/i)).toHaveCount(0)
   const s=await profile(p,establishments[i]);expect(s.shared).toBe(true);expect(s.associations).toHaveLength(11)
   expect(s.associations.filter(a=>a.parentName==='Bánh căn')).toHaveLength(10)
   await capture(p,'specialty-'+(i===0?'fr':'vi'),p.locator('.est-detail-copy h2'))
   const forbidden=await rpc(p,'read_restaurant_dishes',{p_establishment:establishments[1-i]});expect(forbidden.error?.message).toContain('DISH_FORBIDDEN')
   const privateDenied=await rpc(p,'read_restaurant_dishes',{p_establishment:privateEstablishments[1-i]});expect(privateDenied.error?.message).toContain('DISH_FORBIDDEN')
  }
  mark('two-real-auth-sessions-read-scope-and-shared-fr-vi')
  // Confirm the same source-backed association through each localized UI.
  for(let i=0;i<2;i++){
   const p=pages[i],vi=i===1,name=i===0?'Bánh căn · TRỨNG GÀ':'Bánh căn · TRỨNG CÚT'
   if(i===1){await p.reload();await expect(p.locator('.dish-specialty')).toBeVisible()}
   const editor=await openEditor(p,vi),item=association(editor,p,name)
   await item.getByRole('button',{name:vi?'Xác nhận':'Confirmer',exact:true}).click()
   await expect(item.getByText(vi?'Đã xác nhận · Thủ công':'Confirmée · Manuelle',{exact:true})).toBeVisible()
   await capture(p,'confirmation-'+(vi?'vi':'fr'),item)
  }
  await pages[1].reload();await expect(pages[1].locator('.dish-specialty')).toBeVisible()
  const both=await profile(pages[1],establishments[1]);expect(both.associations.find(a=>a.name==='Bánh căn · TRỨNG GÀ')?.origin).toBe('manual')
  mark('manual-confirmation-shared-across-languages')
  // Explicit test correction: withdraw two associations, without deleting raw rows.
  const removed:string[]=[]
  for(let i=0;i<2;i++){
   const p=pages[i],vi=i===1,name=i===0?'Bánh căn · THẬP CẨM':'Bánh căn · TRỨNG GÀ + BÒ'
   await p.reload();await expect(p.locator('.dish-specialty')).toBeVisible()
   const editor=await openEditor(p,vi),before=await profile(p,establishments[i])
   removed.push(before.associations.find(a=>a.name===name)!.id)
   await association(editor,p,name).getByRole('button',{name:vi?'Bỏ liên kết':'Retirer l’association',exact:true}).click()
   await expect(association(editor,p,name)).toHaveCount(0)
   await expect(p.locator('.dish-details>summary')).toHaveText((vi?'Món ăn và biến thể':'Plats et variantes')+' ('+(10-i)+')')
   await capture(p,'correction-'+(vi?'vi':'fr'),editor.getByLabel(vi?'Chọn món có sẵn':'Choisir un plat existant'))
  }
  const beforeReplay=await profile(pages[0],establishments[0])
  const replayRun='isolated-replay-'+saved.runId
  await addMenu(establishments[0],saved.placeId,saved.raw,{...saved.result,provenance:{...saved.result.provenance,runId:replayRun,fixtureReplayOf:saved.runId}},replayRun)
  for(let i=0;i<2;i++){
   await pages[i].reload();await expect(pages[i].locator('.dish-specialty')).toBeVisible()
   const after=await profile(pages[i],establishments[i])
   expect(after.associations.some(a=>removed.includes(a.id))).toBe(false)
   expect(after.associations.filter(a=>a.origin==='manual').map(a=>a.id).sort()).toEqual(beforeReplay.associations.filter(a=>a.origin==='manual').map(a=>a.id).sort())
   expect(after.specialty?.name).toBe('Bánh căn');expect(after.associations).toHaveLength(9)
  }
  expect((await rows('select raw,result from rainminer_menu_jobs where run_id=$1',[saved.runId]))[0]).toEqual({raw:saved.raw,result:saved.result})
  mark('manual-correction-survives-reprocessing-raw-preserved')
  // Actual membership is read on each server RPC, including direct requests.
  await rows("update organization_members set role='viewer' where user_id=$1 and organization_id=$2",[fixture.users[1].id,fixture.users[1].organizationId])
  await pages[1].reload();await expect(pages[1].locator('.dish-specialty')).toBeVisible()
  await expect(pages[1].getByRole('button',{name:'Xác nhận hoặc sửa món ăn',exact:true})).toHaveCount(0)
  const viewer=await profile(pages[1],establishments[1]);expect(viewer.canEdit).toBe(false)
  expect((await rpc(pages[1],'edit_restaurant_dishes',{p_establishment:establishments[1],p_revision:viewer.revision,p_action:'specialty',p_dish:null})).error?.message).toContain('DISH_FORBIDDEN')
  const anonymous=await fetch(status.API_URL+'/rest/v1/rpc/read_restaurant_dishes',{method:'POST',headers:{apikey:status.ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_establishment:establishments[0]})})
  expect([401,403]).toContain(anonymous.status)
  const grants=await rows("select has_table_privilege('authenticated','private.restaurant_dishes','select') r,has_table_privilege('authenticated','private.dish_edit_history','select') h")
  expect(grants).toEqual([{r:false,h:false}]);mark('viewer-anonymous-direct-rpc-and-private-tables-denied')
  // Normalized exact concepts and descendants, never substring matches.
  await pages[0].goto('/etablissements?plat=pho')
  await expect(pages[0].getByRole('status')).toHaveText('3 restaurant(s)')
  await expect(pages[0].getByText('Propositions à confirmer',{exact:false})).toBeVisible()
  const general=await rpc<DishMatch[]>(pages[0],'search_restaurants_by_dish',{p_query:'pho'})
  expect(general.data.map(m=>m.establishmentId).sort()).toEqual([...phoIds].sort())
  expect(general.data.every(m=>m.status==='proposed')).toBe(true)
  await capture(pages[0],'search-pho-fr',pages[0].getByRole('searchbox'))
  await pages[0].getByRole('searchbox').fill('phở gà')
  await expect(pages[0].getByRole('status')).toHaveText('1 restaurant(s)')
  await expect(pages[0].getByRole('heading',{name:'Phở générique — test'})).toHaveCount(0)
  const precise=await rpc<DishMatch[]>(pages[0],'search_restaurants_by_dish',{p_query:'PHỞ GÀ'})
  expect(precise.data.map(m=>m.establishmentId)).toEqual([phoIds[1]])
  await capture(pages[0],'search-pho-ga-fr',pages[0].getByRole('searchbox'))
  await pages[1].goto('/etablissements?plat=banh%20can')
  await expect(pages[1].getByRole('status')).toHaveText('1 nhà hàng')
  await expect(pages[1].getByText('Đề xuất cần xác nhận',{exact:false})).toBeVisible()
  const viMatches=await rpc<DishMatch[]>(pages[1],'search_restaurants_by_dish',{p_query:'banh can'})
  expect(viMatches.data.map(m=>m.establishmentId)).toEqual([establishments[1]])
  await capture(pages[1],'search-banh-can-vi',pages[1].getByRole('searchbox'))
  expect((await rpc<DishMatch[]>(pages[0],'search_restaurants_by_dish',{p_query:'pho mai'})).data).toEqual([])
  mark('normalized-general-precise-search-proposals-not-availability')
  expect((await rows("select count(*)::int n from rainminer_menu_jobs where status<>'completed'"))[0].n).toBe(0)
  const providers=await(await fetch('http://127.0.0.1:4411/control/status')).json()
  expect(providers.runs).toHaveLength(0);expect(providers.menuRuns).toHaveLength(0);expect(providers.aiCalls).toBe(0)
  expect((await rows('select automatic_enabled,launches_enabled from private.rainminer_menu_config'))[0]).toEqual({automatic_enabled:false,launches_enabled:false})
  mark('zero-provider-calls-and-no-production-access')
 }finally{await Promise.all(contexts.map(c=>c.close()));await db.end()}
})
