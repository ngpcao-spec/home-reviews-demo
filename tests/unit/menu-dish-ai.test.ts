// @vitest-environment node
import { afterAll, beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { PGlite } from '@electric-sql/pglite'
import Ajv from 'ajv'
import { dishDatabase, ORG, ORG2, USER, USER2, savedMenu } from '../fixtures/dish-associations-database'
import { advanceMenuDishAi, CONTRACT, menuAiRequest, validateMenuClassification, type MenuClassification, type MenuItem, type MenuPacket } from '../../supabase/functions/_shared/menu-dish-ai'
import type { DishProfile, DishMatch } from '../../src/lib/restaurant-dishes'
import bun from '../fixtures/bun-bo-huong-giang-menu-saved.json'

let db:PGlite
beforeAll(async()=>{
 db=await dishDatabase()
 // PGlite lacks pg_cron and pg_net. The production worker entry point uses
 // the existing scheduler token; exercise its actual claim and finish SQL.
 const migration=readFileSync('supabase/migrations/20261125141350_classify_saved_menus_with_ai.sql','utf8')
 await db.exec(migration.replace(/select cron\.schedule\([\s\S]*?\$cron\$\);/,''))
 await db.exec(readFileSync('supabase/migrations/20261126023212_route_menu_dish_ai_v7.sql','utf8'))
 await db.exec(readFileSync('supabase/migrations/20261126151340_route_menu_dish_ai_v8.sql','utf8'))
},30000)
afterAll(async()=>{await db?.close()})
beforeEach(async()=>{await db.exec("begin;update private.menu_dish_ai_settings set enabled=true,enabled_since='1970-01-01'")})
afterEach(async()=>{await db.exec('rollback')})

const item=(kind:MenuItem['kind'],row:number,name:string|null=null):MenuItem=>({kind,row,name})
const unknownProfile:MenuClassification['menu_profile']={value:'unknown',rows:[],sections:[]}
const unknownType:MenuClassification['restaurant_type']={value:'unknown',name_evidence:null,rows:[]}
const bunResult:MenuClassification={
 items:[item('drink',4),item('drink',5),item('drink',6),item('drink',7)],
 specialty:{name:'Bún bò',rows:[1,2]},
 menu_profile:{value:'specialized',rows:[1,2],sections:[]},
 restaurant_type:unknownType,
}
const banhResult:MenuClassification={
 items:[item('drink',2),item('drink',3),item('drink',4),item('drink',16),item('non_food',15)],
 specialty:{name:'Bánh căn',rows:[1,5,6]},
 menu_profile:{value:'specialized',rows:[1,5,6],sections:[]},
 restaurant_type:unknownType,
}
const asUser=async(user=USER)=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[user])
const read=async(id:string)=>(await db.query<{v:DishProfile}>('select public.read_restaurant_dishes($1) v',[id])).rows[0].v
const search=async(query:string)=>(await db.query<{v:DishMatch[]}>('select public.search_restaurants_by_dish($1) v',[query])).rows[0].v
const add=async(name:string,place:string,org=ORG)=>{
 const id=crypto.randomUUID()
 await db.query('insert into public.establishments(id,name,organization_id,place_id) values($1,$2,$3,$4)',[id,name,org,place])
 return id
}
const save=async(id:string,place:string,run:string,raw:unknown[],drinks:number[])=>db.query(
 "insert into public.rainminer_menu_jobs(establishment_id,place_id,request_id,run_id,status,raw,result,retrieved_at) values($1,$2,$3,$4,'completed',$5,$6,clock_timestamp())",
 [id,place,crypto.randomUUID(),run,raw,{placeId:place,references:[],excludedDrinks:drinks.map(sourceRow=>({sourceRow}))}],
)
const workerRpc=async(name:string,args:Record<string,unknown>)=>{
 const keys=Object.keys(args)
 try {
  if (!['claim_menu_dish_ai','finish_menu_dish_ai'].includes(name)) throw Error('UNEXPECTED_RPC')
  const fn='public.'+name+'('+keys.map((k,i)=>k+'=> $'+(i+1)).join(',')+')'
  const response=await db.query<{v:unknown}>(name==='claim_menu_dish_ai'?'select * from '+fn:'select '+fn+' v',Object.values(args))
  return {data:name==='claim_menu_dish_ai'?response.rows:response.rows[0].v,error:null}
 } catch(error) { return {data:null,error} }
}
const fakeAi=(result:unknown)=>{
 const call=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  expect(String(url)).toBe('https://api.openai.com/v1/responses')
  expect(init?.method).toBe('POST')
  return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(result)}]}],
   usage:{input_tokens:1000,output_tokens:450}})
 })
 return {call,run:()=>advanceMenuDishAi(workerRpc,'simulated-credential',call)}
}

it('recognizes a new Bún bò, shares a single AI call, retains raw data and accent-insensitive search',async()=>{
 expect((await db.query("select id from private.dish_names where key='bun bo'")).rowCount).toBe(0)
 const first=await add(bun.establishment,bun.placeId), second=await add(bun.establishment,bun.placeId,ORG2)
 await Promise.all([
  save(first,bun.placeId,bun.runId,bun.raw,[4,5,6,7]),
  save(second,bun.placeId,'same-content-other-run',bun.raw.map(row=>({...row,scrapedAt:'different'})),[4,5,6,7]),
 ])
 await asUser()
 expect((await read(first)).classification).toMatchObject({state:'queued',stale:false})
 expect(await search('bun bo')).toEqual([])
 const ai=fakeAi({...bunResult,items:[
  ...bunResult.items, item('non_food',1), item('dish',4,'CocaCola'), item('dish',9,'Plats inventés'),
  item('dish',999,'Phở'), item('dish',8,'Bún với thịt bò (gân bò)'),
 ]})
 const work=await Promise.all([ai.run(),ai.run()])
 expect(work).toContainEqual({claimed:1,status:'succeeded'})
 expect(ai.call).toHaveBeenCalledTimes(1)
 const payload=JSON.parse(String(ai.call.mock.calls[0][1]?.body))
 const packet=JSON.parse(payload.input) as MenuPacket
 expect(packet.restaurant).toBe(bun.establishment)
 expect(packet.lines).toHaveLength(12)
 expect(packet.lines[1]).toMatchObject({section:bun.raw[1].category,price:bun.raw[1].price,priceText:bun.raw[1].priceText})
 expect(payload.text.format.strict).toBe(true)

 const profile=await read(first)
 expect(profile).toMatchObject({menuProfile:'specialized',restaurantType:'unknown'})
 const stored=(await db.query('select raw_response,result from private.menu_dish_ai_runs')).rows[0]
 expect(JSON.parse(stored.raw_response).output[0].content[0].text).toContain('Bún bò')
 expect(profile).not.toHaveProperty('raw_response')
 expect(profile.specialty).toMatchObject({name:'Bún bò',status:'proposed',evidence:{rows:[1,2]}})
 expect(profile.classification?.specialtyNeedsConfirmation).toBe(false)
 expect(profile.associations.find(a=>a.name==='Bún bò')).toMatchObject({status:'proposed',evidence:[
  {sourceRow:1,name:'Bún bò'},{sourceRow:2,name:'Bún bò giò'},
 ]})
 expect(profile.unresolved).toHaveLength(5)
 expect(profile.unresolved).toEqual(expect.arrayContaining([
  expect.objectContaining({name:'Đặc biệt',reason:'other'}),
  expect.objectContaining({name:'BÒ (GÂN)',reason:'other'}),
 ]))
 for(const term of ['bun bo','Bún bò'])
  expect(await search(term)).toMatchObject([{establishmentId:first,dish:'Bún bò',kind:'specialty'}])
 expect(await search('Bún bò giò')).toEqual([])
 expect(await search('Bún với thịt bò (gân bò)')).toMatchObject([{establishmentId:first,kind:'menu'}])
 expect(await search('CocaCola')).toEqual([])
 expect(await search('Plats inventés')).toEqual([])
 await asUser(USER2)
 expect((await read(second)).associations.map(a=>a.id)).toEqual(profile.associations.map(a=>a.id))
 expect((await search('bún bò')).map(m=>m.establishmentId)).toEqual([second])
 await asUser()
 await save(first,bun.placeId,'unchanged-seen-again',bun.raw,[4,5,6,7])
 expect((await read(first)).classification).toMatchObject({state:'succeeded',sourceRun:'unchanged-seen-again',stale:false})
 expect(await ai.run()).toEqual({claimed:0})
 expect(ai.call).toHaveBeenCalledTimes(1)
 expect((await db.query('select raw from public.rainminer_menu_jobs where run_id=$1',[bun.runId])).rows[0].raw).toEqual(bun.raw)
})

it('uses menu headings to find Bánh căn, retains other rows and preserves manual decisions',async()=>{
 const id=await add(savedMenu.establishment,savedMenu.placeId)
 await asUser()
 await save(id,savedMenu.placeId,savedMenu.runId,savedMenu.raw,[2,3,4,16])
 const mislabeled={...banhResult,items:banhResult.items.map(entry=>entry.row===15?item('dish',15,'KHĂN LẠNH'):entry)}
 expect(await fakeAi(mislabeled).run()).toEqual({claimed:1,status:'succeeded'})
 const original=await read(id)
 expect(original.specialty).toMatchObject({name:'Bánh căn',evidence:{rows:[1,5,6]}})
 expect(original.associations).toHaveLength(1)
 expect(original.associations[0].evidence.map(e=>e.sourceRow)).toEqual([1,5,6])
 const archived=await db.query<{source_row:number;reason:string;original:unknown}>(
  'select source_row,reason,original from private.dish_menu_evidence where run_id=$1 order by source_row',[savedMenu.runId])
 expect(archived.rows.map(r=>r.original)).toEqual(savedMenu.raw)
 expect(archived.rows.filter(r=>r.reason==='beverage').map(r=>r.source_row)).toEqual([2,3,4,16])
 expect(archived.rows.filter(r=>r.reason==='non_food').map(r=>r.source_row)).toEqual([15])
 expect(original.unresolved).toHaveLength(8)
 expect(original.unresolved).toContainEqual(expect.objectContaining({sourceRow:14,name:'XÍU MẠI',reason:'other'}))
 expect(await search('xiu mai')).toEqual([])
 expect(await search('Khan lanh')).toEqual([])
 expect(await search('tra da')).toEqual([])
 for(const term of ['banh can','Bánh căn'])
  expect(await search(term)).toMatchObject([{establishmentId:id,dish:'Bánh căn',kind:'specialty'}])
 await db.query("select public.edit_restaurant_dishes($1,$2,'specialty',$3)",[id,original.revision,original.specialty!.id])
 const changed=savedMenu.raw.map((r:Record<string,unknown>,i:number)=>i===0?{...r,price:60000}:r)
 await save(id,savedMenu.placeId,'new-prices',changed,[2,3,4,16])
 expect((await read(id)).classification).toMatchObject({state:'queued',stale:true})
 expect((await search('banh can'))[0].stale).toBe(true)
 const updated={...banhResult,specialty:null}
 expect(await fakeAi(updated).run()).toEqual({claimed:1,status:'succeeded'})
 const valid=await read(id)
 expect(valid.specialty).toMatchObject({name:'Bánh căn',origin:'manual',status:'confirmed'})
 expect(valid.classification?.specialtyNeedsConfirmation).toBe(false)
 const newer=changed.map((r:Record<string,unknown>,i:number)=>i===0?{...r,price:65000}:r)
 await save(id,savedMenu.placeId,'unverified-prices',newer,[2,3,4,16])
 const ai=fakeAi({unexpected:'missing specialty field'})
 expect(await ai.run()).toMatchObject({claimed:1,status:'failed',error:'MENU_AI_INVALID_RESULT'})
 const rejected=await read(id)
 expect(rejected.associations).toEqual(valid.associations)
 expect(rejected.specialty).toEqual(valid.specialty)
 expect(rejected.classification).toMatchObject({state:'failed',stale:true,sourceRun:'unverified-prices'})
 expect(rejected).toMatchObject({menuProfile:'specialized',restaurantType:'unknown'})
 const failure=(await db.query("select error_code,raw_response from private.menu_dish_ai_runs where status='failed'")).rows[0]
 expect(failure.error_code).toBe('MENU_AI_INVALID_RESULT')
 expect(JSON.parse(failure.raw_response).output[0].content[0].text).toContain('missing specialty field')
 expect(await ai.run()).toEqual({claimed:0})
 expect(ai.call).toHaveBeenCalledTimes(1)
 await db.query("select public.edit_restaurant_dishes($1,$2,'remove',$3)",[id,rejected.revision,original.specialty!.id])
 await save(id,savedMenu.placeId,'new-prices-after-removal',newer.map((r,i)=>i===0?{...r,price:70000}:r),[2,3,4,16])
 expect(await fakeAi(banhResult).run()).toMatchObject({status:'succeeded'})
 const manuallyRemoved=await read(id)
 expect(manuallyRemoved.specialty).toBeNull()
 expect(manuallyRemoved.associations).toEqual([])
 expect(manuallyRemoved.classification?.specialtyNeedsConfirmation).toBe(false)
 expect(await search('banh can')).toEqual([])
})

it('does not reclaim an unknown paid attempt and keeps the service RPCs private',async()=>{
 const id=await add(bun.establishment,bun.placeId)
 await save(id,bun.placeId,bun.runId,bun.raw,[4,5,6,7])
 const claim=await workerRpc('claim_menu_dish_ai',{})
 expect(claim.data).toHaveLength(1)
 await db.exec("update private.menu_dish_ai_runs set lease_until=now()-interval '1 second'")
 const ai=fakeAi(bunResult)
 expect(await ai.run()).toEqual({claimed:0})
 expect(ai.call).not.toHaveBeenCalled()
 await asUser()
 expect((await read(id)).classification).toMatchObject({state:'failed',stale:false})
 expect((await db.query("select has_function_privilege('authenticated','public.claim_menu_dish_ai()','execute') client")).rows[0]).toEqual({client:false})
})

it('keeps pre-activation content out of the queue even when it is saved again under a new run',async()=>{
 await db.exec('update private.menu_dish_ai_settings set enabled=false')
 const id=await add(bun.establishment,bun.placeId)
 await save(id,bun.placeId,bun.runId,bun.raw,[4,5,6,7])
 await db.exec("update private.menu_dish_ai_settings set enabled=true,enabled_since=clock_timestamp()")
 await db.query('select private.refresh_restaurant_dishes($1)',[id])
 await save(id,bun.placeId,'duplicate-old-content',bun.raw,[4,5,6,7])
 const ai=fakeAi(bunResult)
 expect(await ai.run()).toEqual({claimed:0})
 expect(ai.call).not.toHaveBeenCalled()
 const changed=bun.raw.map((row,i)=>i===0?{...row,price:51000}:row)
 await save(id,bun.placeId,'new-content',changed,[4,5,6,7])
 expect(await ai.run()).toEqual({claimed:1,status:'succeeded'})
 expect(await ai.run()).toEqual({claimed:0})
 expect(ai.call).toHaveBeenCalledTimes(1)
})

it('keeps the newest menu pending when an older worker finishes late',async()=>{
 const id=await add(bun.establishment,bun.placeId)
 await save(id,bun.placeId,'first-menu',bun.raw,[4,5,6,7])
 const claim=await workerRpc('claim_menu_dish_ai',{})
 const [job]=claim.data as {id:string;lease_id:string;packet:MenuPacket}[]
 const newer=bun.raw.map((row,i)=>i===0?{...row,priceText:'Prix mis à jour'}:row)
 await save(id,bun.placeId,'newer-menu',newer,[4,5,6,7])
 expect((await workerRpc('finish_menu_dish_ai',{
  p_id:job.id,p_lease:job.lease_id,p_result:validateMenuClassification(bunResult,job.packet),p_usage:null,p_error:null,
 })).data).toBe('succeeded')
 await asUser()
 expect((await read(id)).classification).toMatchObject({sourceRun:'newer-menu',state:'queued'})
 expect(await search('bun bo')).toEqual([])
 expect(await fakeAi(bunResult).run()).toEqual({claimed:1,status:'succeeded'})
 expect((await read(id)).classification).toMatchObject({sourceRun:'newer-menu',state:'succeeded',stale:false})
})

it('keeps an unsupported suggestion empty and defaults missing, duplicated and invalid decisions to Other',()=>{
 const packet:MenuPacket={restaurant:bun.establishment,lines:bun.raw.map((r,i)=>({
  id:i+1,name:r.name,section:r.category,description:r.description,price:r.price,priceText:r.priceText,currency:r.currency,knownDrink:[4,5,6,7].includes(i+1),
 }))}
 for(const specialty of [
  {name:'Phở',rows:[2]}, {name:'Bún bò',rows:[999]}, {name:'Bún bò',rows:[4]},
  {name:'Bún bò',rows:[]}, {name:'Bún bò',rows:[9]},
 ]) expect(validateMenuClassification({...bunResult,specialty},packet).specialty).toBeNull()
 const request=menuAiRequest(packet,'configured-mini',1500)
 expect(request).toMatchObject({model:'configured-mini',store:false,max_output_tokens:1500})
 expect(request.instructions).toContain('Le menu est clairement centré sur un seul plat et ses déclinaisons, même si le nom du restaurant ne le mentionne pas.')
 expect(request.instructions).toContain('2. PROFIL DE LA CARTE — menu_profile')
 expect(request.instructions).toContain('3. TYPE DE RESTAURANT — restaurant_type')
 const validateSchema=new Ajv().compile(request.text.format.schema)
 expect(validateSchema(bunResult)).toBe(true)
 expect(validateSchema({...bunResult,restaurant_type:{...unknownType,value:'specialized'}})).toBe(false)
 const incomplete=validateMenuClassification({specialty:bunResult.specialty,items:[
  item('dish',8,'Bún với thịt bò (gân bò)'), item('non_food',8), item('dish',999,'Phở'),
  {row:9,kind:'dish',name:42}, item('dish',5,'Trà đá'),
 ]},packet)
 expect(incomplete.specialty).toEqual(bunResult.specialty)
 expect(incomplete.menu_profile).toEqual(unknownProfile)
 expect(incomplete.restaurant_type).toEqual(unknownType)
 expect(incomplete.items).toHaveLength(12)
 expect(incomplete.items).toEqual(expect.arrayContaining([item('other',3),item('other',8),item('other',9),item('drink',5)]))
 const withoutItems=validateMenuClassification({specialty:bunResult.specialty,items:null},packet)
 expect(withoutItems.specialty).toEqual(bunResult.specialty)
 expect(withoutItems.items[0]).toEqual(item('dish',1,'Bún bò'))
 expect(()=>validateMenuClassification({specialty:null,items:null},packet)).toThrow('MENU_AI_INVALID_RESULT')
})

it('offers a clear secondary dish for a mixed menu while leaving its specialty to confirm',async()=>{
 const place='ChIJmixed-menu'
 const id=await add('Bistro du marché',place)
 const menu=[
  {placeId:place,placeName:'Bistro du marché',name:'Bún bò',category:'Plats'},
  {placeId:place,placeName:'Bistro du marché',name:'Pizza Margherita',category:'Pizzas'},
  {placeId:place,placeName:'Bistro du marché',name:'Option du jour',category:'Suppléments'},
  {placeId:place,placeName:'Bistro du marché',name:'Formule famille pour quatre',category:'À partager'},
 ]
 await save(id,place,'mixed-menu',menu,[])
 const menu_profile={value:'varied',rows:[1,2],sections:[]}
 const restaurant_type={value:'family_dining',name_evidence:null,rows:[4]}
 expect(await fakeAi({
  specialty:{name:'Bún bò',rows:[1]},menu_profile,restaurant_type,
  items:[item('dish',1,'Bún bò'),item('dish',2,'Pizza Margherita')],
 }).run()).toMatchObject({status:'succeeded'})
 await asUser()
 const profile=await read(id)
 expect(profile.specialty).toBeNull()
 expect(profile.classification?.specialtyNeedsConfirmation).toBe(true)
 expect(profile.unresolved).toEqual(expect.arrayContaining([expect.objectContaining({sourceRow:3,name:'Option du jour',reason:'other'})]))
 expect(await search('bun bo')).toMatchObject([{establishmentId:id,kind:'menu'}])
 expect(await search('Option du jour')).toEqual([])
 expect((await db.query('select result from private.menu_dish_ai_runs')).rows[0].result).toMatchObject({menu_profile,restaurant_type})
})

it('publishes the model type from distinct dishes and checks every source reference',async()=>{
 const place='ChIJvaried-menu'
 const restaurant='Bistro du marché'
 const id=await add(restaurant,place)
 const raw=[
  {placeId:place,placeName:restaurant,name:'Tom Yum',category:'Soupes'},
  {placeId:place,placeName:restaurant,name:'Pizza Margherita',category:'Pizzas'},
  {placeId:place,placeName:restaurant,name:'Trà đá',category:'Đồ uống'},
 ]
 const menu_profile={value:'varied',rows:[1,2],sections:[]}
 const restaurant_type={value:'family_dining',name_evidence:null,rows:[1,2]}
 const response={specialty:null,menu_profile,restaurant_type,items:[item('dish',1,'Tom Yum'),item('dish',2,'Pizza Margherita')]}
 await save(id,place,'varied-menu',raw,[3])
 const ai=fakeAi(response)
 expect(await ai.run()).toMatchObject({status:'succeeded'})
 await asUser()
 expect(await read(id)).toMatchObject({menuProfile:'varied',restaurantType:'family_dining'})
 expect(await search('Tom Yum')).toMatchObject([{establishmentId:id,kind:'menu'}])
 const packet=JSON.parse(String(ai.call.mock.calls[0][1]?.body)).input
 for(const rows of [[1,99],[1,1],[1,3],[]]) {
  const result=validateMenuClassification({...response,restaurant_type:{...restaurant_type,rows}},JSON.parse(packet))
  expect(result).toMatchObject({menu_profile,restaurant_type:unknownType})
 }
 expect(validateMenuClassification({...response,restaurant_type:unknownType},JSON.parse(packet)).restaurant_type).toEqual(unknownType)
})

it('shares an exact published v6 result without requesting an extra classification in v8',async()=>{
 const first=await add(bun.establishment,bun.placeId)
 const second=await add(bun.establishment,bun.placeId,ORG2)
 await save(first,bun.placeId,bun.runId,bun.raw,[4,5,6,7])
 const ai=fakeAi(bunResult)
 expect(await ai.run()).toMatchObject({status:'succeeded'})
 await db.exec("update private.menu_dish_ai_runs set contract='menu-dish-ai-v6'")
 await save(second,bun.placeId,'v6-menu-reused',bun.raw,[4,5,6,7])
 expect(await ai.run()).toEqual({claimed:0})
 expect(ai.call).toHaveBeenCalledTimes(1)
 expect((await db.query('select contract from private.menu_dish_ai_runs')).rows).toEqual([{contract:'menu-dish-ai-v6'}])
 await asUser(USER2)
 expect(await read(second)).toMatchObject({specialty:{name:'Bún bò'},classification:{state:'succeeded'}})
})

it('prefers the v8 publication when a v7 result exists for the same menu',async()=>{
 const id=await add(bun.establishment,bun.placeId)
 await save(id,bun.placeId,bun.runId,bun.raw,[4,5,6,7])
 const ai=fakeAi({...bunResult,restaurant_type:{value:'street_food',name_evidence:null,rows:[1,2]}})
 expect(await ai.run()).toMatchObject({status:'succeeded'})
 const old=await db.query<{id:string}>(`insert into private.menu_dish_ai_runs(place_id,fingerprint,model,contract,packet,status,result,finished_at)
  select place_id,fingerprint,model,'menu-dish-ai-v7',packet,status,
  jsonb_set(result,'{restaurant_type}', $1::jsonb),finished_at from private.menu_dish_ai_runs where contract=$2 returning id`,
  [unknownType,CONTRACT])
 await db.query('update private.menu_dish_ai_targets set run_id=$1,published_id=$1',[old.rows[0].id])
 await asUser()
 expect((await read(id)).restaurantType).toBe('unknown')
 await db.query('select private.refresh_restaurant_dishes($1)',[id])
 expect(await read(id)).toMatchObject({
  restaurantType:'street_food',specialty:{name:'Bún bò',status:'proposed'},classification:{state:'succeeded',stale:false},
 })
 expect(await ai.run()).toEqual({claimed:0})
 expect(ai.call).toHaveBeenCalledTimes(1)
})

it('publishes a menu-backed specialty without a restaurant name match and keeps uncertain restaurant type separate',async()=>{
 const place='ChIJspecialized-menu'
 const restaurant='Quán Hoàng Mai'
 const id=await add(restaurant,place)
 const entries=[
  ['Tôm thịt','BÁNH XÈO'],
  ['Hải sản','BÁNH XÈO'],
  ['Trà đá','Đồ uống'],
  ['Rau sống','Gọi thêm'],
 ]
 const raw=entries.map(([name,category])=>({placeId:place,placeName:restaurant,name,category}))
 const specialty={name:'Bánh xèo',rows:[1,2]}
 const menu_profile={value:'specialized',rows:[],sections:['BÁNH XÈO']}
 await save(id,place,'specialized-menu',raw,[3])
 expect(await fakeAi({
  specialty,menu_profile,restaurant_type:{value:'street_food',name_evidence:'vỉa hè',rows:[]},items:[],
 }).run()).toMatchObject({status:'succeeded'})
 await asUser()
 expect((await read(id)).specialty).toMatchObject({name:'Bánh xèo',evidence:{rows:[1,2]}})
 expect(await search('banh xeo')).toMatchObject([{establishmentId:id,kind:'specialty'}])
 expect((await db.query('select contract,result from private.menu_dish_ai_runs')).rows[0]).toMatchObject({
  contract:CONTRACT,result:{specialty,menu_profile,restaurant_type:unknownType},
 })
})

it('checks citations independently and leaves generic or unsupported specialties empty',()=>{
 const packet:MenuPacket={restaurant:'Quán vỉa hè Hoa',lines:[
  {id:1,name:'Tôm thịt',section:'Bánh xèo',description:null,price:30000,currency:'VND',priceText:null,knownDrink:false},
  {id:2,name:'Trà đá',section:'Đồ uống',description:null,price:null,currency:'VND',priceText:null,knownDrink:true},
  {id:3,name:'Rau sống',section:'Gọi thêm',description:null,price:null,currency:'VND',priceText:null,knownDrink:false},
 ]}
 const menu_profile={value:'specialized',rows:[],sections:['Bánh xèo']}
 const street={value:'street_food',name_evidence:'Quán vỉa hè',rows:[1]}
 const specialty={name:'Bánh xèo',rows:[1]}
 expect(validateMenuClassification({specialty,menu_profile,restaurant_type:street,items:[]},packet))
  .toMatchObject({specialty,menu_profile,restaurant_type:street})
 for(const wrongProfile of [
  {value:'specialized',rows:[99],sections:[]},
  {value:'specialized',rows:[2],sections:['Bánh xèo']},
  {value:'specialized',rows:[3],sections:[]},
  {value:'specialized',rows:[],sections:['Rubrique inventée']},
 ]) expect(validateMenuClassification({specialty,menu_profile:wrongProfile,restaurant_type:street,items:[]},packet))
  .toMatchObject({specialty:null,menu_profile:unknownProfile,restaurant_type:street})
 const broadPacket={...packet,restaurant:'Nouilles Hoa',lines:[{...packet.lines[0],name:'Nouilles',section:'Nouilles'}]}
 expect(validateMenuClassification({specialty:{name:'Nouilles',rows:[1]},items:[]},broadPacket).specialty).toBeNull()
 expect(validateMenuClassification({specialty,menu_profile,restaurant_type:{...street,rows:[99]},items:[]},packet))
  .toMatchObject({specialty,restaurant_type:unknownType})
})

it('retains enough specialty evidence and records non-support and explicit contradictions separately',()=>{
 const packet:MenuPacket={restaurant:'Le Marché',lines:[
  {id:1,name:'Bánh xèo',section:'Carte',description:null,price:null,currency:null,priceText:null,knownDrink:false},
  {id:2,name:'Đặc biệt',section:'Carte',description:'Bánh xèo',price:null,currency:null,priceText:null,knownDrink:false},
  {id:3,name:'Trà đá',section:'Boissons',description:null,price:null,currency:null,priceText:null,knownDrink:true},
  {id:4,name:'Tom Yum',section:'Bánh xèo',description:null,price:null,currency:null,priceText:null,knownDrink:false},
 ]}
 const proposed={
  menu_profile:{value:'specialized',rows:[1],sections:['Carte','Section inexistante']},
  restaurant_type:unknownType,items:[item('dish',4,'Tom Yum')],
 }
 expect(validateMenuClassification({...proposed,specialty:{name:'Bánh xèo',rows:[1,2,1,9]}},packet)).toMatchObject({
  specialty:{name:'Bánh xèo',rows:[1]},
  menu_profile:{value:'specialized',rows:[1],sections:['Carte']},
  rejections:expect.arrayContaining([
   {field:'menu_profile',reason:'invalid_section',section:'Section inexistante'},
   {field:'specialty',reason:'unusable_row',row:2},
   {field:'specialty',reason:'duplicate_reference',row:1},
   {field:'specialty',reason:'invalid_reference',row:9},
  ]),
 })
 for(const [row,reason] of [[3,'excluded_or_option'],[4,'different_dish']] as const) {
  expect(validateMenuClassification({...proposed,specialty:{name:'Bánh xèo',rows:[1,row]}},packet)).toMatchObject({
   specialty:null,rejections:expect.arrayContaining([{field:'specialty',reason,row}]),
  })
 }
 expect(validateMenuClassification({...proposed,specialty:{name:'Bánh xèo',rows:[2]}},packet)).toMatchObject({
  specialty:null,rejections:expect.arrayContaining([{field:'specialty',reason:'insufficient_evidence'}]),
 })
})

it('only indexes complete names and keeps labels from explicit option sections in Other',async()=>{
 const place='ChIJmixed-secondary-labels'
 const restaurant='Bistro des Halles'
 const id=await add(restaurant,place)
 const entries=[
  ['Đặc biệt (lớn)','Plats'],
  ['Thập cẩm','Món chính'],
  ['Assortiment de la maison','Carte'],
  ['Mixed platter, large','Main courses'],
  ['Combo A','Carte'],
  ['Crevettes grillées','Garnitures'],
  ['Tofu croustillant','Món ăn kèm / Side dishes'],
  ['Assortiment de fromages','Entrées'],
  ['Pizza Margherita spéciale','Plats'],
  ['Tom Yum','Main courses'],
  ['Crêpe au caramel','Desserts du jour'],
 ]
 const raw=entries.map(([name,category])=>({placeId:place,placeName:restaurant,name,category}))
 const items=raw.map((line,i)=>item('dish',i+1,line.name))
 await save(id,place,'mixed-secondary-labels',raw,[])
 expect(await fakeAi({specialty:null,items}).run()).toEqual({claimed:1,status:'succeeded'})
 await asUser()
 const profile=await read(id)
 expect(profile.unresolved.map(row=>row.sourceRow).sort((a,b)=>a-b)).toEqual([1,2,3,4,5,6,7])
 for(const [name] of entries.slice(0,7)) expect(await search(name)).toEqual([])
 for(const [name] of entries.slice(7)) expect(await search(name)).toMatchObject([{establishmentId:id,kind:'menu'}])
 expect(await search('crepe au caramel')).toMatchObject([{establishmentId:id,kind:'menu'}])
})
