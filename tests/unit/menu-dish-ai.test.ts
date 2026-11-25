// @vitest-environment node
import { afterAll, beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { PGlite } from '@electric-sql/pglite'
import { dishDatabase, ORG, ORG2, USER, USER2, savedMenu } from '../fixtures/dish-associations-database'
import { advanceMenuDishAi, menuAiRequest, type MenuClassification, type MenuItem, type MenuPacket } from '../../supabase/functions/_shared/menu-dish-ai'
import type { DishProfile, DishMatch } from '../../src/lib/restaurant-dishes'
import bun from '../fixtures/bun-bo-huong-giang-menu-saved.json'

let db:PGlite
beforeAll(async()=>{
 db=await dishDatabase()
 // PGlite lacks pg_cron and pg_net. The production worker entry point uses
 // the existing scheduler token; exercise its actual claim and finish SQL.
 const migration=readFileSync('supabase/migrations/20261125051909_classify_saved_menus_with_ai.sql','utf8')
 await db.exec(migration.replace(/select cron\.schedule\([\s\S]*?\$cron\$\);/,''))
},30000)
afterAll(async()=>{await db?.close()})
beforeEach(async()=>{await db.exec("begin;update private.menu_dish_ai_settings set enabled=true")})
afterEach(async()=>{await db.exec('rollback')})

const item=(kind:MenuItem['kind'],rows:number[],name:string|null=null,parent:string|null=null,reason:MenuItem['reason']=null):
 MenuItem=>({kind,rows,name,parent,reason})
const bunResult:MenuClassification={
 items:[item('dish',[1],'Bún bò'),item('variant',[2],'Bún bò giò','Bún bò'),item('ambiguous',[3],null,null,'unclear_label'),
  item('drink',[4,5,6,7,12]),item('variant',[8],'Bún bò gân','Bún bò'),item('ambiguous',[9,10,11],null,null,'unclear_serving')],
 specialty:{name:'Bún bò',rows:[1,2]},
}
const banhResult:MenuClassification={
 items:[
  ...[1,5,6,7,8,9,10,11,12,13].map(n=>item('variant',[n],'Bánh căn · '+savedMenu.raw[n-1].name,'Bánh căn')),
  item('drink',[2,3,4,16]),item('extra',[14]),item('non_food',[15]),
 ],specialty:{name:'Bánh căn',rows:[1,5,6]},
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
 const ai=fakeAi(bunResult)
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
 expect(profile.specialty).toMatchObject({name:'Bún bò',status:'proposed'})
 expect(profile.associations.find(a=>a.name==='Bún bò giò')).toMatchObject({parentName:'Bún bò',status:'proposed',evidence:[{sourceRow:2,name:'Bún bò giò'}]})
 expect(profile.unresolved).toEqual(expect.arrayContaining([
  expect.objectContaining({name:'Đặc biệt',reason:'unclear_label'}),
  expect.objectContaining({name:'BÒ (GÂN)',reason:'unclear_serving'}),
 ]))
 expect((await search('bun bo')).map(m=>m.establishmentId)).toEqual([first])
 expect((await search('Bún bò giò')).map(m=>m.establishmentId)).toEqual([first])
 expect(await search('CocaCola')).toEqual([])
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

it('keeps Bánh căn variants and manual decisions, then retains the prior result on invalid AI output',async()=>{
 const id=await add(savedMenu.establishment,savedMenu.placeId)
 await asUser()
 await save(id,savedMenu.placeId,savedMenu.runId,savedMenu.raw,[2,3,4,16])
 expect(await fakeAi(banhResult).run()).toEqual({claimed:1,status:'succeeded'})
 const original=await read(id)
 expect(original.associations).toHaveLength(10)
 expect(original.associations).toEqual(expect.arrayContaining([
  expect.objectContaining({name:'Bánh căn · TRỨNG GÀ',parentName:'Bánh căn'}),
  expect.objectContaining({name:'Bánh căn · TRỨNG CÚT',parentName:'Bánh căn'}),
 ]))
 expect(await search('xiu mai')).toEqual([])
 const removed=original.associations.find(a=>a.name==='Bánh căn · TRỨNG CÚT')!
 await db.query("select public.edit_restaurant_dishes($1,$2,'remove',$3)",[id,original.revision,removed.id])
 const edited=await read(id)
 await db.query("select public.edit_restaurant_dishes($1,$2,'specialty',$3)",[id,edited.revision,original.specialty!.id])
 const changed=savedMenu.raw.map((r:Record<string,unknown>,i:number)=>i===0?{...r,price:60000}:r)
 await save(id,savedMenu.placeId,'new-prices',changed,[2,3,4,16])
 expect((await read(id)).classification).toMatchObject({state:'queued',stale:true})
 expect((await search('banh can'))[0].stale).toBe(true)
 const updated={...banhResult,specialty:null}
 expect(await fakeAi(updated).run()).toEqual({claimed:1,status:'succeeded'})
 const valid=await read(id)
 expect(valid.specialty).toMatchObject({name:'Bánh căn',origin:'manual',status:'confirmed'})
 expect(valid.associations.some(a=>a.id===removed.id)).toBe(false)
 const newer=changed.map((r:Record<string,unknown>,i:number)=>i===0?{...r,price:65000}:r)
 await save(id,savedMenu.placeId,'unverified-prices',newer,[2,3,4,16])
 const ai=fakeAi({items:[item('dish',[999],'Bánh căn')],specialty:null})
 expect(await ai.run()).toMatchObject({claimed:1,status:'failed',error:'MENU_AI_INVALID_SOURCES'})
 const rejected=await read(id)
 expect(rejected.associations).toEqual(valid.associations)
 expect(rejected.specialty).toEqual(valid.specialty)
 expect(rejected.classification).toMatchObject({state:'failed',stale:true,sourceRun:'unverified-prices'})
 expect(await ai.run()).toEqual({claimed:0})
 expect(ai.call).toHaveBeenCalledTimes(1)
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

it('keeps the newest menu pending when an older worker finishes late',async()=>{
 const id=await add(bun.establishment,bun.placeId)
 await save(id,bun.placeId,'first-menu',bun.raw,[4,5,6,7])
 const claim=await workerRpc('claim_menu_dish_ai',{})
 const [job]=claim.data as {id:string;lease_id:string}[]
 const newer=bun.raw.map((row,i)=>i===0?{...row,priceText:'Prix mis à jour'}:row)
 await save(id,bun.placeId,'newer-menu',newer,[4,5,6,7])
 expect((await workerRpc('finish_menu_dish_ai',{
  p_id:job.id,p_lease:job.lease_id,p_result:bunResult,p_usage:null,p_error:null,
 })).data).toBe('succeeded')
 await asUser()
 expect((await read(id)).classification).toMatchObject({sourceRun:'newer-menu',state:'queued'})
 expect(await search('bun bo')).toEqual([])
 expect(await fakeAi(bunResult).run()).toEqual({claimed:1,status:'succeeded'})
 expect((await read(id)).classification).toMatchObject({sourceRun:'newer-menu',state:'succeeded',stale:false})
})

it('rejects repeated source IDs, drink-to-dish conversion and unsupported specialties',async()=>{
 const {validateMenuClassification}=await import('../../supabase/functions/_shared/menu-dish-ai')
 const packet:MenuPacket={restaurant:bun.establishment,lines:bun.raw.map((r,i)=>({
  id:i+1,name:r.name,section:r.category,description:r.description,price:r.price,priceText:r.priceText,currency:r.currency,knownDrink:[4,5,6,7].includes(i+1),
 }))}
 expect(()=>validateMenuClassification({...bunResult,items:[...bunResult.items,item('dish',[1],'Phở')]},packet)).toThrow()
 expect(()=>validateMenuClassification({...bunResult,items:bunResult.items.map(i=>i.kind==='drink'?item('dish',i.rows,'Cà ri'):i)},packet)).toThrow('MENU_AI_INVALID_SOURCES')
 expect(()=>validateMenuClassification({...bunResult,specialty:{name:'Phở',rows:[2]}},packet)).toThrow('MENU_AI_INVALID_SPECIALTY')
 expect(menuAiRequest(packet,'configured-mini',1500)).toMatchObject({model:'configured-mini',store:false,max_output_tokens:1500})
})
