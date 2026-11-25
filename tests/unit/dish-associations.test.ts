// @vitest-environment node
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest'
import type {PGlite} from '@electric-sql/pglite'
import {dishDatabase,savedMenu,ORG,ORG2,USER,USER2,PHO_MIGRATION,CONTEXT_MIGRATION,CONTEXT_IDENTITY_MIGRATION} from '../fixtures/dish-associations-database'
import {readFileSync} from 'node:fs'
let db:PGlite
beforeAll(async()=>{db=await dishDatabase()},30000)
afterAll(async()=>{await db?.close()})
beforeEach(async()=>{await db.exec('begin');await asUser(USER)})
afterEach(async()=>{await db.exec('rollback')})
const asUser=async(user:string)=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[user])
const rpc=async(name:string,args:unknown[]=[]) => (await db.query<{v:any}>('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args)).rows[0].v // eslint-disable-line @typescript-eslint/no-explicit-any
const read=(id:string)=>rpc('read_restaurant_dishes',[id])
const find=(q:string)=>rpc('search_restaurants_by_dish',[q])
async function est(name='Tiệm Bánh Căn Tháng Năm',org=ORG,place=savedMenu.placeId){
 const id=crypto.randomUUID();await db.query('insert into establishments(id,name,organization_id,place_id) values($1,$2,$3,$4)',[id,name,org,place]);return id
}
async function menu(id:string,rows=savedMenu.raw,run=crypto.randomUUID()){
 const p=(await db.query<{place_id:string}>('select place_id from establishments where id=$1',[id])).rows[0].place_id
 await db.query("insert into rainminer_menu_jobs(establishment_id,place_id,request_id,status,run_id,raw,result,retrieved_at) values($1,$2,$3,'completed',$4,$5,$6,clock_timestamp())",[id,p,crypto.randomUUID(),run,rows,{placeId:p,references:[]}]);return run
}
const row=(name:string,category:string|null=null)=>({placeId:savedMenu.placeId,name,category,description:'Sauce au vin et café',menuImageUrl:'https://example.test/menu.jpg'})
it('reprocesses a saved numbered phở menu and preserves source lines and manual edits', async () => {
 const isolated = await dishDatabase(undefined,'original')
 try {
  const id = crypto.randomUUID()
  const raw = [
   ...['19.Phở Tái + Nạm','20.Phở Đuôi Bò','21.Phở Steak + Đuôi','23.Phở Tái, Nạm, Gẫu, Gân',
    '7. Phở Bò Tái + Bò Chín','9. Phở Tái + Lõi','105. Phở Tái + Gầu','13.Phở Đuôi Bò',
    '107.Phở Sườn Bò','2. Phở Tái','3. Phở Nạm','4. Phở Chín','5. Phở Gầu','6. Phở Sốt Vang'].map(name => row(name)),
   row('51.Đuôi Bò', 'GỌI THÊM'),
   row('52. Phở tái', 'GỌI THÊM'),
   row('30. Trà đá'),
   row('39.Mì Xào Bò Rau Cải'),
   row('11.Phô mai'),
  ]
  await isolated.query('insert into establishments(id,name,organization_id,place_id) values($1,$2,$3,$4)', [id,'Phở Thìn',ORG,savedMenu.placeId])
  await isolated.query("insert into rainminer_menu_jobs(establishment_id,place_id,request_id,status,run_id,raw,result) values($1,$2,$3,'completed','saved-pho',$4,'{}')", [id,savedMenu.placeId,crypto.randomUUID(),raw])
  await isolated.query("select set_config('request.jwt.claim.sub',$1,false)", [USER])
  const readProfile = async () => (await isolated.query<{p:{revision:number;specialty:unknown;associations:{name:string;parentName:string}[]}}>(
   'select public.read_restaurant_dishes($1) p', [id],
  )).rows[0].p
  const before = await readProfile()
  expect(before.specialty).toBeNull()
  expect(before.associations).toEqual([])
  await isolated.exec(readFileSync('supabase/migrations/'+PHO_MIGRATION,'utf8'))
  await isolated.query('update private.restaurant_dish_profiles set source_run=null where scope=private.dish_scope($1)',[id])
  await isolated.query('select private.refresh_restaurant_dishes($1)',[id])
  let after = await readProfile()
  expect(after.specialty).toMatchObject({name:'Phở',status:'proposed'})
  expect(after.associations).toHaveLength(13)
  expect(after.associations).toContainEqual(expect.objectContaining({name:'Phở Đuôi Bò',parentName:'Phở bò'}))
  expect(after.associations).toContainEqual(expect.objectContaining({name:'Phở Tái',parentName:'Phở'}))
  for (const query of ['pho','phở bò','phở gà','pho mai']) {
   const matches = (await isolated.query<{m:{establishmentId:string}[]}>('select public.search_restaurants_by_dish($1) m',[query])).rows[0].m
   expect(matches.map(match=>match.establishmentId)).toEqual(query==='pho'||query==='phở bò'?[id]:[])
  }
  const evidence = (await isolated.query<{original:unknown;decision:string}>('select original,decision from private.dish_menu_evidence where run_id=$1 order by source_row',['saved-pho'])).rows
  expect(evidence.map(e=>e.original)).toEqual(raw)
  expect(evidence.map(e=>e.decision)).toEqual([...Array(14).fill('associated'),'review','review','excluded','review','review'])
  expect((await isolated.query('select raw from rainminer_menu_jobs where run_id=$1',['saved-pho'])).rows[0].raw).toEqual(raw)
  await isolated.query('select public.edit_restaurant_dishes($1,$2,$3,null)',[id,after.revision,'specialty'])
  await isolated.query('update private.restaurant_dish_profiles set source_run=null where scope=private.dish_scope($1)',[id])
  await isolated.query('select private.refresh_restaurant_dishes($1)',[id])
  after = await readProfile()
  expect(after.specialty).toBeNull()
  const revision = after.revision
  await isolated.query('select private.refresh_restaurant_dishes($1)',[id])
  expect((await readProfile()).revision).toBe(revision)
 } finally { await isolated.close() }
}, 30000)
it('replays all 16 saved raw rows, proposes bánh căn and ten contextual variants, excludes four drinks and tissue',async()=>{
 const id=await est();await menu(id)
 const p=await read(id)
 expect(p.specialty).toMatchObject({name:'Bánh căn',status:'proposed',origin:'automatic'})
 expect(p.associations).toHaveLength(11)
 expect(p.associations.filter((x:{parentName:string})=>x.parentName==='Bánh căn')).toHaveLength(10)
 expect(p.associations.some((x:{name:string})=>x.name==='TRỨNG GÀ')).toBe(false)
 const decisions=(await db.query('select decision,reason,count(*) n from private.dish_menu_evidence group by decision,reason')).rows
 expect(decisions).toContainEqual({decision:'excluded',reason:'beverage',n:4})
 expect(decisions).toContainEqual({decision:'excluded',reason:'non_food',n:1})
 expect((await db.query('select raw from rainminer_menu_jobs')).rows[0].raw).toEqual(savedMenu.raw)
 expect((await find('BANH CAN'))[0]).toMatchObject({establishmentId:id,kind:'specialty',dish:'Bánh căn',status:'proposed'})
 expect(p.associations[0].evidence[0]).toHaveProperty('runId')
})
it('does not globally convert eggs/assortment into dishes or infer availability from descriptions',async()=>{
 const id=await est('Mixed Bistro');await menu(id,[row('Trứng gà'),row('Thập cẩm'),row('Unknown','Other')])
 const p=await read(id);expect(p.specialty).toBeNull();expect(p.associations).toEqual([]);expect(p.unresolved).toHaveLength(3)
})
it('uses a precise dish heading for different cuisines, keeping the original label and context', async () => {
 const pho = await est('Phở Hát Giang')
 await menu(pho, [
  row('PHỞ BÒ HÁT GIANG'), row('Tai','PHO BO'), row('Gan','PHO BO'), row('Bo Vien','PHO BO'),
  row('Nạm','PHỞ NAM / BẮC'), row('Tai','CHICKEN SOUP'), row('Phở gà','PHO BO'),
  row('Phở bò','PHỞ GÀ'), row('Extra Bo Vien','PHO BO'), row('Phở Tái','GỌI THÊM'),
 ])
 const phoProfile = await read(pho)
 expect(phoProfile.specialty).toMatchObject({name:'Phở',status:'proposed'})
 expect(phoProfile.associations.map(({name}:{name:string})=>name).sort()).toEqual(
  ['Phở bò · Bo Vien','Phở bò · Gan','Phở bò · Tai','Phở · Nạm'].sort(),
 )
 expect(phoProfile.associations.find(({name}:{name:string})=>name==='Phở bò · Tai').evidence[0]).toMatchObject({
  name:'Tai',section:'PHO BO',reason:'explicit_menu_context',
 })
 expect(phoProfile.unresolved).toHaveLength(6)
 expect((await find('pho bo')).map((match:{establishmentId:string})=>match.establishmentId)).toEqual([pho])
 expect(await find('phở gà')).toEqual([])

 const other = await est('Bistro')
 await menu(other, [
  row('CONTADINA','GOURMET PIZZA'), row('TUNA','GOURMET PIZZA'), row('Extra cheese','GOURMET PIZZA'),
  row('Phở Tái','GOURMET PIZZA'), row('Menu','GOURMET PIZZA'), row('-Spaghetti tomato sauce','Spaghetti'),
  row('Bolognese','PASTA'), row('French fries','STARTER'), row('Bò','Beef'),
 ])
 const otherProfile = await read(other)
 expect(otherProfile.specialty).toBeNull()
 expect(otherProfile.associations.map(({name}:{name:string})=>name).sort()).toEqual(
  ['Pizza · CONTADINA','Pizza · TUNA','Spaghetti tomato sauce'].sort(),
 )
 expect(otherProfile.unresolved).toHaveLength(6)
 expect((await find('spaghetti')).map((match:{establishmentId:string})=>match.establishmentId)).toEqual([other])
})
it('keeps the UUID of a previously recognized pizza whose original label already starts with Pizza', async () => {
 const isolated = await dishDatabase(undefined,'numbered')
 try {
  const id = crypto.randomUUID()
  const raw = [row('Pizza Táo/Gorgonzola Pizza','CLASSIC PIZZA')]
  await isolated.query('insert into establishments(id,name,organization_id,place_id) values($1,$2,$3,$4)',
   [id,'Pizzeria',ORG,savedMenu.placeId])
  await isolated.query("insert into rainminer_menu_jobs(establishment_id,place_id,request_id,status,run_id,raw,result) values($1,$2,$3,'completed','existing-pizza',$4,'{}')",
   [id,savedMenu.placeId,crypto.randomUUID(),raw])
  const enabled = async () => (await isolated.query(
   'select a.dish_id,n.name from private.restaurant_dishes a join private.dish_names n on n.id=a.dish_id where a.scope=$1 and a.enabled',
   ['establishment:'+id],
  )).rows
  const before = await enabled()
  expect(before).toMatchObject([{name:'Pizza · Pizza Táo/Gorgonzola Pizza'}])
  for (const migration of [CONTEXT_MIGRATION,CONTEXT_IDENTITY_MIGRATION])
   await isolated.exec(readFileSync('supabase/migrations/'+migration,'utf8'))
  await isolated.query('update private.restaurant_dish_profiles set source_run=null where scope=private.dish_scope($1)',[id])
  await isolated.query('select private.refresh_restaurant_dishes($1)',[id])
  expect(await enabled()).toEqual(before)
  expect((await isolated.query('select raw from rainminer_menu_jobs where run_id=$1',['existing-pizza'])).rows[0].raw).toEqual(raw)
 } finally { await isolated.close() }
},30000)
it('normalizes accents/case, general searches include variants, precise searches never expand to generic or sibling dishes',async()=>{
 const generic=await est('Phở House'),ga=await est('Mixed Restaurant'),bo=await est('Phở Shop')
 await menu(generic,[row('Phở')]);await menu(ga,[row('Phở gà')]);await menu(bo,[row('Phở bò')])
 expect((await find('pHo')).map((x:{establishmentId:string})=>x.establishmentId).sort()).toEqual([generic,ga,bo].sort())
 expect((await find('PHỞ GÀ')).map((x:{establishmentId:string})=>x.establishmentId)).toEqual([ga])
 expect((await find('pho bo')).map((x:{establishmentId:string})=>x.establishmentId)).toEqual([bo])
 expect(await find('pho mai')).toEqual([]);expect(await find('ph')).toEqual([]);expect(await find('telephone')).toEqual([])
 expect((await find('pho'))[0].kind).toBe('specialty')
})
it('keeps several dishes without forcing a specialty, and distinguishes pizza variants from ingredients',async()=>{
 const id=await est('Bistro');await menu(id,[row('Bò bít tết'),row('Phở bò'),row('STEAK','CLASSIC PIZZA'),row('Beef steak','Pizza')])
 const p=await read(id);expect(p.specialty).toBeNull();expect(p.associations).toHaveLength(4)
 expect(p.associations.find((x:{name:string})=>x.name==='Pizza · STEAK').parentName).toBe('Pizza')
 expect(p.associations.find((x:{name:string})=>x.name==='Pizza · Beef steak').parentName).toBe('Pizza')
 expect(p.associations.find((x:{name:string})=>x.name==='Bò bít tết').evidence[0].reason).toBe('exact_menu_name')
})
it('a manual association without evidence in the current menu does not invent an automatic specialty',async()=>{
 const id=await est('Phở Bistro');const catalog=await rpc('list_dish_names')
 await rpc('edit_restaurant_dishes',[id,0,'add',catalog.find((n:{name:string})=>n.name==='Phở').id])
 await menu(id,[row('Xíu mại')]);const p=await read(id)
 expect(p.specialty).toBeNull();expect(p.associations).toHaveLength(2)
})
it('rejects a null revision and a null action on direct authenticated calls',async()=>{
 const id=await est();await menu(id)
 for(const [revision,action,message] of [[null,'specialty','DISH_CONFLICT'],[1,null,'DISH_INVALID_ACTION']]){
  await db.exec('savepoint invalid')
  await expect(rpc('edit_restaurant_dishes',[id,revision,action,null])).rejects.toThrow(message as string)
  await db.exec('rollback to savepoint invalid')
 }
 expect((await read(id)).specialty.status).toBe('proposed')
})
it('reuses the existing drink exclusions without changing the original menu classification',async()=>{
 const id=await est('Bistro'),run=crypto.randomUUID(),raw=[row('Phở'),row('Phở','Tea - Coffee')]
 const result={references:[{sourceRow:1,classification:'food',row:raw[0]}],excludedDrinks:[{sourceRow:2,classification:'drink',row:raw[1]}]}
 await db.query("insert into rainminer_menu_jobs(establishment_id,place_id,request_id,status,run_id,raw,result) values($1,$2,$3,'completed',$4,$5,$6)",[id,savedMenu.placeId,crypto.randomUUID(),run,raw,result])
 expect((await read(id)).associations[0].evidence).toHaveLength(1)
 expect((await db.query('select result from rainminer_menu_jobs where run_id=$1',[run])).rows[0].result).toEqual(result)
})
it('attaches already saved shared menus on subscription without a provider job and keeps local non-pilot data separate',async()=>{
 const a=await est(),b=await est('Nom FR',ORG2),r=crypto.randomUUID()
 await db.query('insert into private.shared_restaurants values($1,$2)',[r,savedMenu.placeId])
 await db.query('insert into private.shared_restaurant_pilot_places values($1)',[savedMenu.placeId])
 await db.query('insert into private.shared_restaurant_subscriptions values($1,$2,$3)',[r,ORG,'vi'])
 await db.query('insert into private.shared_restaurant_establishments values($1,$2,$3)',[a,r,ORG])
 await menu(a)
 await db.query('insert into private.shared_restaurant_subscriptions values($1,$2,$3)',[r,ORG2,'fr'])
 await db.query('insert into private.shared_restaurant_establishments values($1,$2,$3)',[b,r,ORG2])
 await asUser(USER2);expect((await read(b)).associations).toHaveLength(11)
 expect((await db.query('select count(*) n from rainminer_menu_jobs')).rows[0].n).toBe(1)
 await db.query('delete from private.shared_restaurant_pilot_places')
 expect((await read(b)).associations).toEqual([])
})
it('captures a completed menu reused through the existing target request without a new provider call',async()=>{
 const a=await est(),b=await est('Second account',ORG2),run=await menu(a)
 const job=(await db.query<{id:string}>('select id from rainminer_menu_jobs where run_id=$1',[run])).rows[0].id
 await db.query('insert into private.rainminer_menu_requests(job_id,establishment_id,request_id,place_id) values($1,$2,$3,$4)',[job,b,crypto.randomUUID(),savedMenu.placeId])
 await asUser(USER2);expect((await read(b)).associations).toHaveLength(11)
 expect((await db.query('select count(*) n from rainminer_menu_jobs')).rows[0].n).toBe(1)
})
it('preserves manual corrections, removals and all historical evidence after a new menu and idempotent replay',async()=>{
 const id=await est();await menu(id);let p=await read(id)
 const first=p.associations[0].id
 p=await rpc('edit_restaurant_dishes',[id,p.revision,'remove',first])
 p=await rpc('edit_restaurant_dishes',[id,p.revision,'specialty',null])
 const run=await menu(id)
 let after=await read(id);expect(after.specialty).toBeNull();expect(after.associations.some((x:{id:string})=>x.id===first)).toBe(false)
 expect((await db.query('select count(*) n from private.dish_menu_evidence')).rows[0].n).toBe(32)
 const revision=after.revision
 await db.query('update rainminer_menu_jobs set status=status where run_id=$1',[run]);after=await read(id)
 expect(after.revision).toBe(revision)
 expect((await db.query('select count(*) n from private.dish_edit_history')).rows[0].n).toBe(2)
})
it('shares one language-independent specialty only through the verified pilot/subscription gate, denies foreign accounts and stale edits',async()=>{
 const a=await est(),b=await est('Nom FR',ORG2),r=crypto.randomUUID()
 await db.query('insert into private.shared_restaurants values($1,$2)',[r,savedMenu.placeId])
 await db.query('insert into private.shared_restaurant_pilot_places values($1)',[savedMenu.placeId])
 for(const [id,org] of [[a,ORG],[b,ORG2]]){
  await db.query('insert into private.shared_restaurant_establishments values($1,$2,$3)',[id,r,org])
  await db.query('insert into private.shared_restaurant_subscriptions values($1,$2,$3)',[r,org,org===ORG?'vi':'fr'])
 }
 await menu(a);let p=await read(a)
 const updated=await rpc('edit_restaurant_dishes',[a,p.revision,'specialty',p.specialty.id])
 expect(updated.specialty.status).toBe('confirmed')
 await db.exec('savepoint forbidden');await expect(read(b)).rejects.toThrow('DISH_FORBIDDEN');await db.exec('rollback to savepoint forbidden')
 await asUser(USER2);p=await read(b);expect(p.specialty).toEqual(updated.specialty);expect(p.shared).toBe(true)
 await db.exec('savepoint conflict');await expect(rpc('edit_restaurant_dishes',[b,0,'specialty',null])).rejects.toThrow('DISH_CONFLICT');await db.exec('rollback to savepoint conflict')
 expect((await find('banh can')).map((x:{establishmentId:string})=>x.establishmentId)).toEqual([b])
 await db.query('update establishments set active=false where id=$1',[b]);expect(await find('banh can')).toEqual([])
 await asUser(USER);expect((await read(a)).specialty.status).toBe('confirmed')
})
it('authenticated members read only their own scope, viewers cannot edit, anonymous callers and table reads are denied',async()=>{
 const id=await est();await menu(id)
 await db.exec('set local role authenticated');expect((await read(id)).associations.length).toBe(11)
 await db.exec('savepoint denied');await expect(db.query('select * from private.restaurant_dishes')).rejects.toThrow();await db.exec('rollback to savepoint denied;reset role')
 await db.query("update organization_members set role='viewer' where user_id=$1",[USER])
 expect((await read(id)).canEdit).toBe(false)
 await db.exec('savepoint denied');await expect(rpc('edit_restaurant_dishes',[id,1,'specialty',null])).rejects.toThrow('DISH_FORBIDDEN');await db.exec('rollback to savepoint denied')
 await asUser('');await db.exec('savepoint denied');await expect(find('pho')).rejects.toThrow('DISH_FORBIDDEN');await db.exec('rollback to savepoint denied')
})
it('adds missing normalized names and explicit variants manually without overwriting catalog meanings',async()=>{
 const id=await est('Bistro');let p=await read(id)
 p=await rpc('edit_restaurant_dishes',[id,p.revision,'add',null,'Bún bò Huế'])
 expect(p.associations[0]).toMatchObject({name:'Bún bò Huế',status:'confirmed',origin:'manual'})
 expect((await find('BUN BO HUE'))[0].establishmentId).toBe(id)
 await db.exec('savepoint denied');await expect(rpc('edit_restaurant_dishes',[id,p.revision,'add',null,'Trà đá'])).rejects.toThrow('DISH_PRECISE_FOOD_NAME_REQUIRED');await db.exec('rollback to savepoint denied')
})
it('reuses a known translated alias instead of creating a language-dependent duplicate dish',async()=>{
 const id=await est('Bistro');const before=await rpc('list_dish_names')
 const p=await rpc('edit_restaurant_dishes',[id,0,'add',null,'Beef Steak'])
 expect(p.associations[0]).toMatchObject({name:'Bò bít tết',status:'confirmed'})
 expect(await rpc('list_dish_names')).toHaveLength(before.length)
 expect((await find('beef steak'))[0].establishmentId).toBe(id)
})
it('keeps conflicting food and beverage section evidence for examination',async()=>{
 const id=await est('Bistro');await menu(id,[row('Coffee cake','Drinks'),row('Beef Steak','Boissons')])
 const p=await read(id)
 expect(p.associations).toEqual([]);expect(p.unresolved).toHaveLength(2)
 expect(p.unresolved.every((x:{reason:string})=>x.reason==='food_beverage_context_conflict')).toBe(true)
})
it('seeds existing saved menus once and rolls back only the feature without deleting source or derived data',async()=>{
 const id=crypto.randomUUID()
 const isolated=await dishDatabase(async testDb=>{
  await testDb.query('insert into establishments(id,name,organization_id,place_id) values($1,$2,$3,$4)',[id,savedMenu.establishment,ORG,savedMenu.placeId])
  await testDb.query("insert into rainminer_menu_jobs(establishment_id,place_id,request_id,status,run_id,raw,result) values($1,$2,$3,'completed',$4,$5,$6)",[id,savedMenu.placeId,crypto.randomUUID(),savedMenu.runId,savedMenu.raw,savedMenu.result])
 })
 try{
  expect((await isolated.query('select count(*) n from private.dish_menu_evidence')).rows[0].n).toBe(16)
  const before=(await isolated.query('select raw,result from rainminer_menu_jobs')).rows
  await isolated.exec(readFileSync('scripts/rollback-restaurant-dishes.sql','utf8'))
  expect((await isolated.query('select raw,result from rainminer_menu_jobs')).rows).toEqual(before)
  expect((await isolated.query('select count(*) n from private.restaurant_dishes')).rows[0].n).toBe(11)
  await isolated.exec('set role authenticated')
  await expect(isolated.query('select public.read_restaurant_dishes($1)',[id])).rejects.toThrow(/permission denied/)
 }finally{await isolated.close()}
},30000)
