// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import type {PGlite} from '@electric-sql/pglite'
import {advanceRainminerMenu,rainminerPricing} from '../../supabase/functions/_shared/rainminer-menu-worker'
import {importRainminerMenu} from '../../supabase/functions/_shared/rainminer-menu.mjs'
import {menuDatabase,configureMenus,newImport,finalizeMenuImport,menuAdmin,PLACE,ORG2,USER,USER2,ACTOR,pricing} from '../fixtures/rainminer-menu-database'

let db:PGlite
beforeAll(async()=>{db=await menuDatabase()},30000)
afterAll(async()=>db?.close())
beforeEach(async()=>{await db.exec('begin');await configureMenus(db)})
afterEach(async()=>{await db.exec('rollback');vi.restoreAllMocks()})
const jobs=async()=> (await db.query<Record<string,unknown>>('select * from rainminer_menu_jobs order by created_at,id')).rows
const read=async(est:string,user=USER)=>(await db.query<{v:Record<string,unknown>}>('select read_rainminer_menu($1,$2) v',[est,user])).rows[0].v
const start=async(est:string,request=crypto.randomUUID(),user=USER)=>(await db.query<{id:string}>('select enqueue_rainminer_menu($1,$2,$3) id',[est,request,user])).rows[0].id
const run=()=>({id:'menu-run',actId:ACTOR,status:'SUCCEEDED',defaultDatasetId:'menu-data',defaultKeyValueStoreId:'menu-input',buildNumber:'fixture',startedAt:'2026-11-24T01:00:00Z',finishedAt:'2026-11-24T01:01:00Z',usageTotalUsd:.03,
 options:{maxTotalChargeUsd:.5,isMaxTotalChargeUsdSetByUser:true,restartOnError:false},pricingInfo:{pricingModel:'PAY_PER_EVENT',isPPEPlatformUsagePaidByUser:false}})
const raw=(place=PLACE)=>[
 {placeId:place,name:'Steak au café',category:'Food',description:'Sauce au vin',price:null},
 {placeId:place,name:'Steak au café',category:'Food',description:'Sauce au vin',price:null},
 {placeId:place,name:'Special 8',category:'Chef',price:null},
 {placeId:place,name:'Green Tea',category:'Tea - Coffee',price:20},
]
function provider(rows=raw(),runPatch:Record<string,unknown>={}){
 const calls:{method:string;url:string;body:unknown}[]=[]
 const fake=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  const path=new URL(String(url)),method=init?.method??'GET'
  calls.push({method,url:String(url),body:init?.body?JSON.parse(String(init.body)):null})
  let value:unknown
  if(path.pathname.endsWith('/runs'))value={data:{...run(),...runPatch}}
  else if(path.pathname.endsWith('/menu-input/records/INPUT'))value={placeIds:[PLACE],maxMenuImages:10,maxItems:100}
  else if(path.pathname.endsWith('/menu-data/items'))value=rows.slice(Number(path.searchParams.get('offset')),Number(path.searchParams.get('offset'))+100)
  else if(path.pathname.endsWith('/menu-data'))value={data:{itemCount:rows.length}}
  else if(path.pathname.includes('/actor-runs/'))value={data:{...run(),...runPatch}}
  else value={data:{id:ACTOR,notice:'NONE',pricingInfos:[{startedAt:'2020-01-01',pricingModel:'PAY_PER_EVENT',minimalMaxTotalChargeUsd:0}]}}
  return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}})
 })
 return {calls,fetch:fake as typeof fetch}
}
it('finalizes the real import, queues automatically and persists food, ambiguous items, duplicates and provenance without a browser',async()=>{
 const item=await newImport(db);expect(await finalizeMenuImport(db,item)).toBe(true)
 const j=(await jobs())[0];expect(j.status).toBe('queued')
 const e=(await db.query('select active,last_review_id,next_sync_at from establishments where id=$1',[item.est])).rows[0]
 expect(e.active).toBe(true);expect(e.last_review_id).toBe('review-head');expect(e.next_sync_at).toBeTruthy()
 const fake=provider()
 expect(await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})).toEqual({status:'running'})
 expect((await jobs())[0].reserved_cost_usd).toBe('0.500000')
 expect((await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})).status).toBe('completed')
 const completed=(await jobs())[0]
 expect(completed.raw).toEqual(raw());expect(completed.actual_cost_usd).toBe('0.03');expect(completed.retrieved_at).toBeTruthy()
 const result=(await read(item.est)).result as ReturnType<typeof importRainminerMenu>
 expect(result.counts).toMatchObject({received:4,excludedDrinks:1,retained:3,review:1})
 expect(result.references[0].row.price).toBeNull();expect(result.references[1].row).toEqual(result.references[0].row)
 expect(result.provenance.runId).toBe('menu-run')
 expect(fake.calls.filter(c=>c.method==='POST')).toHaveLength(1)
 await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})
 expect(fake.calls.filter(c=>c.method==='POST')).toHaveLength(1)
})
it('multiple restaurants may queue, with only one global paid extraction',async()=>{
 const a=await newImport(db),b=await newImport(db,{place:PLACE+'B'})
 await Promise.all([finalizeMenuImport(db,a),finalizeMenuImport(db,b)])
 expect(await jobs()).toHaveLength(2)
 const fake=provider()
 await Promise.all([advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch}),advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})])
 expect(fake.calls.filter(c=>c.method==='POST')).toHaveLength(1)
 expect((await jobs()).map(j=>j.status).sort()).toEqual(['queued','running'])
})
it('two organizations adding the same Place ID join one job and see only their authorized menu',async()=>{
 const a=await newImport(db),b=await newImport(db,{org:ORG2,user:USER2})
 await Promise.all([finalizeMenuImport(db,a),finalizeMenuImport(db,b)])
 expect(await jobs()).toHaveLength(1);expect((await db.query('select * from private.rainminer_menu_requests')).rows).toHaveLength(2)
 const fake=provider();await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch});await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})
 expect((await read(a.est)).result).toEqual((await read(b.est,USER2)).result)
 await db.exec('savepoint denied')
 await expect(read(b.est,USER)).rejects.toThrow('MENU_FORBIDDEN')
 await db.exec('rollback to savepoint denied')
})
it('uses a saved shared menu without a new provider call',async()=>{
 const r=crypto.randomUUID(),rawRows=raw(),result=importRainminerMenu(rawRows,{actor:{name:'rainminer/google-maps-menu-scraper'},runId:'saved',datasetId:'saved-data',input:{placeIds:[PLACE]}},PLACE)
 await db.query('insert into private.shared_restaurants values($1,$2)',[r,PLACE])
 await db.query('insert into private.shared_restaurant_pilot_places values($1)',[PLACE])
 await db.query("insert into private.shared_restaurant_menu_versions values($1,'saved',now(),$2,$3,'{}')",[r,rawRows,result])
 const a=await newImport(db);await finalizeMenuImport(db,a)
 expect((await jobs())[0]).toMatchObject({status:'completed',reused_run_id:'saved',raw:rawRows,result})
 const fake=provider();await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch});expect(fake.calls).toHaveLength(0)
})
it.each([null,'not-a-place'])('records missing/invalid Place ID %s without failing the review import',async place=>{
 const item=await newImport(db,{place});expect(await finalizeMenuImport(db,item)).toBe(true)
 expect((await jobs())[0]).toMatchObject({status:'failed',error_code:'MENU_PLACE_ID_REQUIRED'})
 const fake=provider();await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch});expect(fake.calls).toHaveLength(0)
})
it('does not backfill historical establishments, reloads, failed or partial imports',async()=>{
 const old=await newImport(db,{old:true});await finalizeMenuImport(db,old)
 const reload=await newImport(db,{kind:'reload'});await finalizeMenuImport(db,reload)
 const partial=await newImport(db);await finalizeMenuImport(db,partial,20)
 await newImport(db) // Still running.
 expect(await jobs()).toHaveLength(0)
})
it('default configuration is off and disabling automation does not stop polling an accepted run',async()=>{
 await db.exec('update private.rainminer_menu_config set automatic_enabled=false')
 const skipped=await newImport(db);await finalizeMenuImport(db,skipped);expect(await jobs()).toHaveLength(0)
 await configureMenus(db)
 const a=await newImport(db);await finalizeMenuImport(db,a)
 const fake=provider();await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})
 await db.exec('update private.rainminer_menu_config set automatic_enabled=false,launches_enabled=false')
 expect((await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})).status).toBe('completed')
 expect(fake.calls.filter(c=>c.method==='POST')).toHaveLength(1)
})
it('returns an explicit completed empty menu without inventing food',async()=>{
 const a=await newImport(db);await finalizeMenuImport(db,a)
 const fake=provider([]);await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch});await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})
 expect(((await read(a.est)).result as ReturnType<typeof importRainminerMenu>).counts.retained).toBe(0)
 expect((await jobs())[0].raw).toEqual([])
})
it('fetches all dataset pages without deduplication',async()=>{
 const a=await newImport(db);await finalizeMenuImport(db,a)
 const rows=Array.from({length:205},()=>raw()[0]),fake=provider(rows)
 await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch});await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})
 expect(((await read(a.est)).result as ReturnType<typeof importRainminerMenu>).counts.retained).toBe(205)
 expect(fake.calls.filter(c=>c.url.includes('/items?'))).toHaveLength(3)
})
it('a failed provider run is terminal, and a second organization cannot automatically retry it',async()=>{
 const a=await newImport(db);await finalizeMenuImport(db,a)
 const fake=provider();await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})
 fake.fetch=vi.fn(async()=>new Response(JSON.stringify({data:{...run(),status:'FAILED'}}))) as typeof fetch
 expect((await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})).status).toBe('failed')
 const b=await newImport(db,{org:ORG2,user:USER2});await finalizeMenuImport(db,b)
 expect(await jobs()).toHaveLength(1)
 expect(await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})).toEqual({claimed:0})
 const id=await start(a.est);expect(id).not.toBe((await jobs())[0].id);expect(await jobs()).toHaveLength(2)
})
it('lost POST response holds its cost and execution slot, without retrying',async()=>{
 const a=await newImport(db),b=await newImport(db,{place:PLACE+'B'})
 await finalizeMenuImport(db,a);await finalizeMenuImport(db,b)
 const fake=provider(),readFetch=fake.fetch
 fake.fetch=vi.fn(async(url,init)=>{if(init?.method==='POST')throw new TypeError('synthetic accepted but response lost');return readFetch(url,init)}) as typeof fetch
 expect((await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})).error).toBe('START_OUTCOME_UNKNOWN')
 for(let i=0;i<3;i++)expect(await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})).toEqual({claimed:0})
 expect((await jobs()).map(j=>j.status).sort()).toEqual(['queued','unknown'])
 expect((await db.query('select private.rainminer_budget_used() cost')).rows[0].cost).toBe('0.500000')
 expect(await start(a.est)).toBe((await jobs()).find(j=>j.status==='unknown')!.id)
})
it('an interrupted preflight can resume; an interrupted reserved start cannot',async()=>{
 const a=await newImport(db);await finalizeMenuImport(db,a)
 await db.query('select * from claim_rainminer_menu()')
 await db.exec("update rainminer_menu_jobs set lease_until=now()-interval '1 minute'")
 let j=(await db.query<Record<string,unknown>>('select * from claim_rainminer_menu()')).rows[0]
 expect(j.status).toBe('starting')
 await db.query('select authorize_rainminer_start($1,$2,$3,$4)',[j.id,j.lease_until,{placeIds:[PLACE],maxMenuImages:10,maxItems:100},pricing])
 await db.exec("update rainminer_menu_jobs set lease_until=now()-interval '1 minute'")
 expect((await db.query('select * from claim_rainminer_menu()')).rows).toHaveLength(0)
 j=(await jobs())[0];expect(j.status).toBe('unknown')
})
it('atomically gates budget before POST, including a configuration change after claim',async()=>{
 await configureMenus(db,true,.5)
 const a=await newImport(db),b=await newImport(db,{place:PLACE+'B'});await finalizeMenuImport(db,a);await finalizeMenuImport(db,b)
 const fake=provider();await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch});await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})
 expect(await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})).toEqual({claimed:0})
 expect((await jobs()).find(j=>j.status==='queued')!.error_code).toBe('MENU_BUDGET_LIMIT')
 await configureMenus(db,true,1)
 const j=(await db.query<Record<string,unknown>>('select * from claim_rainminer_menu()')).rows[0]
 await db.exec('update private.rainminer_menu_config set automatic_enabled=false')
 const answer=await db.query<{v:{authorized:boolean;reason:string}}>('select authorize_rainminer_start($1,$2,$3,$4) v',[j.id,j.lease_until,{placeIds:[PLACE+'B'],maxMenuImages:10,maxItems:100},pricing])
 expect(answer.rows[0].v).toEqual({authorized:false,reason:'MENU_AUTOMATIC_DISABLED'})
 expect(fake.calls.filter(c=>c.method==='POST')).toHaveLength(1)
})
it('manual request IDs survive double clicks and the original menu remains during an explicit refresh',async()=>{
 const a=await newImport(db);await finalizeMenuImport(db,a)
 const fake=provider();await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch});await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})
 const request=crypto.randomUUID()
 const [first,second]=await Promise.all([start(a.est,request),start(a.est,request)])
 expect(first).toBe(second);expect(await jobs()).toHaveLength(2);expect((await read(a.est)).result).toBeTruthy()
})
it('retains the run and budget if the source restaurant is deleted while another target waits',async()=>{
 const a=await newImport(db),b=await newImport(db,{org:ORG2,user:USER2});await finalizeMenuImport(db,a);await finalizeMenuImport(db,b)
 const fake=provider();await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})
 await db.query('delete from establishments where id=$1',[a.est])
 expect((await jobs())[0].establishment_id).toBeNull()
 await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch});expect((await read(b.est,USER2)).result).toBeTruthy()
 expect(fake.calls.filter(c=>c.method==='POST')).toHaveLength(1)
})
it('client roles cannot access private jobs, configuration or paid-launch RPCs directly',async()=>{
 const denied=(await db.query("select has_table_privilege('authenticated','rainminer_menu_jobs','select') jobs,has_table_privilege('authenticated','private.rainminer_menu_requests','select') targets,has_function_privilege('authenticated','authorize_rainminer_start(uuid,timestamptz,jsonb,jsonb)','execute') launch,has_function_privilege('service_role','enqueue_rainminer_menu_before_sharing(uuid,uuid,uuid)','execute') bypass")).rows[0]
 expect(denied).toEqual({jobs:false,targets:false,launch:false,bypass:false})
})
it('a saved run ID after a checkpoint error resumes only reads of that run',async()=>{
 const a=await newImport(db);await finalizeMenuImport(db,a)
 const real=menuAdmin(db),fake=provider();let writes=0
 const admin={rpc:async(name:string,args:Record<string,unknown>={})=>{
  if(name==='checkpoint_rainminer_menu'&&++writes===1)return {data:null,error:{message:'synthetic database disconnect'}}
  return real.rpc(name,args)
 }} as typeof real
 expect((await advanceRainminerMenu(admin,'synthetic',{fetch:fake.fetch})).error).toBe('START_OUTCOME_UNKNOWN')
 expect((await jobs())[0]).toMatchObject({status:'unknown',run_id:'menu-run'})
 expect((await db.query('select private.rainminer_menu_work_due() due')).rows[0].due).toBe(true)
 expect((await advanceRainminerMenu(real,'synthetic',{fetch:fake.fetch})).status).toBe('completed')
 expect(fake.calls.filter(c=>c.method==='POST')).toHaveLength(1)
})
it('the Cron does not wake an isolated unknown start without a saved run ID',async()=>{
 const a=await newImport(db);await finalizeMenuImport(db,a)
 await db.exec("update rainminer_menu_jobs set status='unknown',provider_start_attempted_at=now(),reserved_cost_usd=.5")
 expect((await db.query('select private.rainminer_menu_work_due() due')).rows[0].due).toBe(false)
})
it('an HTTP read failure resumes the dataset, never the paid run',async()=>{
 const a=await newImport(db);await finalizeMenuImport(db,a)
 const fake=provider();await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})
 expect((await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:async()=>new Response('',{status:503})})).error).toBe('APIFY_HTTP_503')
 expect((await jobs())[0].status).toBe('running')
 expect((await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})).status).toBe('completed')
 expect(fake.calls.filter(c=>c.method==='POST')).toHaveLength(1)
})
it('failed menu enqueue is recorded without undoing import success',async()=>{
 const a=await newImport(db)
 await db.exec("create function pg_temp.fail_menu_fixture() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_QUEUE_FAILURE';end$$;create trigger fail_menu before insert on rainminer_menu_jobs for each row execute function pg_temp.fail_menu_fixture()")
 expect(await finalizeMenuImport(db,a)).toBe(true)
 expect((await db.query('select status from initial_import_jobs where id=$1',[a.id])).rows[0].status).toBe('completed')
 expect((await read(a.est)).job).toMatchObject({status:'failed',error_code:'MENU_ENQUEUE_FAILED'})
 expect((await db.query('select sqlstate from private.rainminer_menu_enqueue_errors')).rows[0].sqlstate).toBe('P0001')
})
it('refuses actor substitution, unsupported pricing and unbounded platform charges',()=>{
 const actor={id:ACTOR,notice:'NONE',pricingInfos:[{startedAt:'2020-01-01',pricingModel:'PAY_PER_EVENT'}]}
 expect(rainminerPricing(actor).actorId).toBe(ACTOR)
 for(const change of [{id:'wrong'},{notice:'UNDER_MAINTENANCE'},{pricingInfos:[{startedAt:'2020-01-01',pricingModel:'PRICE_PER_DATASET_ITEM'}]},{pricingInfos:[{startedAt:'2020-01-01',pricingModel:'PAY_PER_EVENT',isPPEPlatformUsagePaidByUser:true}]},{pricingInfos:[{startedAt:'2020-01-01',pricingModel:'PAY_PER_EVENT',minimalMaxTotalChargeUsd:1}]}])
 expect(()=>rainminerPricing({...actor,...change})).toThrow('MENU_ACTOR_PRICING_UNSUPPORTED')
})

async function spent(amount:number,est:string){
 // Each synthetic historical charge respects the per-run ceiling.
 for(let rest=amount;rest>0;rest=Math.round((rest-.5)*1e6)/1e6){
  await db.query("insert into rainminer_menu_jobs(establishment_id,place_id,request_id,status,actual_cost_usd,reserved_cost_usd,created_at) values($1,$2,$3,'completed',$4,.5,'2020-01-01')",[est,PLACE,crypto.randomUUID(),Math.min(rest,.5)])
 }
}
it.each([4.500001,5])('blocks globally with $%s already spent, including old charges without monthly renewal',async amount=>{
 await configureMenus(db,true,5)
 const a=await newImport(db),b=await newImport(db,{org:ORG2,user:USER2,place:PLACE+'B'})
 await spent(amount,a.est);await finalizeMenuImport(db,a);await finalizeMenuImport(db,b)
 const fake=provider();expect(await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})).toEqual({claimed:0})
 expect(fake.calls).toHaveLength(0)
 expect((await jobs()).filter(j=>j.status==='queued')).toHaveLength(2)
 expect(Number((await db.query('select private.rainminer_budget_used() used')).rows[0].used)).toBe(amount)
})
it('two workers share the last $0.50 of the $5 budget, then verified billing exhausts it',async()=>{
 await configureMenus(db,true,5)
 const a=await newImport(db),b=await newImport(db,{org:ORG2,user:USER2,place:PLACE+'B'})
 await spent(4.5,a.est);await finalizeMenuImport(db,a);await finalizeMenuImport(db,b)
 const fake=provider(raw(),{usageTotalUsd:.5})
 await Promise.all([advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch}),advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})])
 expect(fake.calls.filter(c=>c.method==='POST')).toHaveLength(1)
 expect(Number((await db.query('select private.rainminer_budget_used() used')).rows[0].used)).toBe(5)
 // Another worker instance resumes only the known run.
 expect((await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})).status).toBe('completed')
 expect(await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})).toEqual({claimed:0})
 expect(Number((await db.query('select private.rainminer_budget_used() used')).rows[0].used)).toBe(5)
 expect(fake.calls.filter(c=>c.method==='POST')).toHaveLength(1)
})
it.each([{usageTotalUsd:undefined},{usageTotalUsd:null},{usageTotalUsd:-1},{pricingInfo:undefined},{options:{maxTotalChargeUsd:'unknown'}}])('keeps the full reservation when billing is uncertain: %j',async patch=>{
 const a=await newImport(db);await finalizeMenuImport(db,a)
 const fake=provider(raw(),patch)
 await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})
 expect((await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})).status).toBe('completed')
 expect((await jobs())[0].actual_cost_usd).toBeNull()
 expect(Number((await db.query('select private.rainminer_budget_used() used')).rows[0].used)).toBe(.5)
 await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})
 expect(fake.calls.filter(c=>c.method==='POST')).toHaveLength(1)
})
it('keeps exact small charges and closes all launch gates if the provider exceeds its ceiling',async()=>{
 const a=await newImport(db);await finalizeMenuImport(db,a)
 const fake=provider(raw(),{usageTotalUsd:.0000001})
 await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch});await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})
 expect((await jobs())[0].actual_cost_usd).toBe('0.0000001')
 const manual=await start(a.est),j=(await db.query<Record<string,unknown>>('select * from claim_rainminer_menu()')).rows[0]
 await db.query('select authorize_rainminer_start($1,$2,$3,$4)',[manual,j.lease_until,{placeIds:[PLACE],maxMenuImages:10,maxItems:100},pricing])
 const billed={...run(),id:'overrun',usageTotalUsd:.6}
 await db.query('select checkpoint_rainminer_menu($1,$2,$3)',[manual,j.lease_until,{status:'failed',run_id:'overrun',run_receipt:billed,actual_cost_usd:.6}])
 expect((await db.query('select automatic_enabled,launches_enabled,billing_ceiling_evidence from private.rainminer_menu_config')).rows[0]).toEqual({automatic_enabled:false,launches_enabled:false,billing_ceiling_evidence:null})
 expect((await jobs()).find(x=>x.id===manual)).toMatchObject({actual_cost_usd:'0.6',error_code:'MENU_COST_CEILING_BREACHED'})
})
it('refuses launches without evidence of the whole cost ceiling, even when flags are enabled',async()=>{
 await db.exec('update private.rainminer_menu_config set billing_ceiling_evidence=null')
 const a=await newImport(db);await finalizeMenuImport(db,a)
 const fake=provider();await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})
 expect(fake.calls).toHaveLength(0);expect((await jobs())[0].error_code).toBe('MENU_COST_CEILING_UNVERIFIED')
 await db.exec('savepoint cap')
 await expect(db.exec('update private.rainminer_menu_config set budget_limit_usd=5.01')).rejects.toThrow('rainminer_budget_five_dollar_max')
 await db.exec('rollback to savepoint cap')
})
it('a one-job test leaves older queued jobs alone and cannot consume a second run',async()=>{
 const other=await newImport(db,{place:PLACE+'B'}),chosen=await newImport(db)
 await finalizeMenuImport(db,other);await finalizeMenuImport(db,chosen)
 const selected=(await jobs()).find(j=>j.place_id===PLACE)!
 await db.query('update private.rainminer_menu_config set first_test_job_id=$1,automatic_enabled=false',[selected.id])
 // The future one-shot test is an explicit manual request, never automatic activation.
 await db.query("update rainminer_menu_jobs set trigger_kind='manual' where id=$1",[selected.id])
 const fake=provider();await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch});await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})
 const retry=await start(chosen.est);expect(retry).not.toBe(selected.id)
 expect(await advanceRainminerMenu(menuAdmin(db),'synthetic',{fetch:fake.fetch})).toEqual({claimed:0})
 expect(fake.calls.filter(c=>c.method==='POST')).toHaveLength(1)
 expect((await jobs()).find(j=>j.establishment_id===other.est)?.status).toBe('queued')
})
it('changing the one-job gate after claim prevents the previously claimed POST',async()=>{
 const a=await newImport(db),b=await newImport(db,{place:PLACE+'B'});await finalizeMenuImport(db,a);await finalizeMenuImport(db,b)
 const j=(await db.query<Record<string,unknown>>('select * from claim_rainminer_menu()')).rows[0]
 await db.query('update private.rainminer_menu_config set first_test_job_id=$1',[(await jobs()).find(x=>x.id!==j.id)!.id])
 const result=await db.query<{v:{authorized:boolean;reason:string}}>('select authorize_rainminer_start($1,$2,$3,$4) v',[j.id,j.lease_until,{placeIds:[PLACE],maxMenuImages:10,maxItems:100},pricing])
 expect(result.rows[0].v).toEqual({authorized:false,reason:'MENU_SINGLE_TEST_ONLY'})
 expect((await jobs()).every(j=>j.provider_start_attempted_at===null)).toBe(true)
})
it('the release migration preserves saved data and sets a disabled $5 default without enrollment',async()=>{
 let before:unknown
 const isolated=await menuDatabase(async database=>{
  const a=await newImport(database)
  await database.query("insert into rainminer_menu_jobs(establishment_id,place_id,request_id,status,raw,result) values($1,$2,$3,'completed',$4,$5)",[a.est,PLACE,crypto.randomUUID(),raw(),{placeId:PLACE,references:raw()}])
  before=(await database.query('select to_jsonb(j) row from rainminer_menu_jobs j')).rows
 })
 try{
  expect((await isolated.query('select to_jsonb(j) row from rainminer_menu_jobs j')).rows).toEqual(before)
  expect((await isolated.query('select automatic_enabled,launches_enabled,budget_limit_usd,billing_ceiling_evidence,first_test_job_id from private.rainminer_menu_config')).rows[0]).toEqual({automatic_enabled:false,launches_enabled:false,budget_limit_usd:'5.000000',billing_ceiling_evidence:null,first_test_job_id:null})
 }finally{await isolated.close()}
})
it('the first-test operator script requires authorization and permits only one explicit job without automation',async()=>{
 const isolated=await menuDatabase(),script=readFileSync('supabase/maintenance/rainminer-first-test.sql','utf8')
 try{
  await expect(isolated.exec(script)).rejects.toThrow('EXPLICIT_FIRST_TEST_AUTHORIZATION_REQUIRED')
  await isolated.exec('rollback')
  const a=await newImport(isolated);await finalizeMenuImport(isolated,a)
  for(const [key,value] of Object.entries({rainminer_first_test_authorized:'yes',rainminer_test_establishment:a.est,
   rainminer_test_user:USER,rainminer_test_request:crypto.randomUUID(),rainminer_billing_evidence:'SIMULATED_PROVIDER_ONLY: no external charges'}))
   await isolated.query('select set_config($1,$2,false)',['home.'+key,value])
  await isolated.exec(script)
  const state=(await isolated.query('select first_test_job_id,automatic_enabled,launches_enabled from private.rainminer_menu_config')).rows[0]
  expect(state.automatic_enabled).toBe(false);expect(state.launches_enabled).toBe(true);expect(state.first_test_job_id).toBeTruthy()
  expect((await isolated.query('select id,trigger_kind,status from rainminer_menu_jobs')).rows).toEqual([{id:state.first_test_job_id,trigger_kind:'manual',status:'queued'}])
  const fake=provider();await advanceRainminerMenu(menuAdmin(isolated),'synthetic',{fetch:fake.fetch});await advanceRainminerMenu(menuAdmin(isolated),'synthetic',{fetch:fake.fetch})
  await isolated.exec('update private.rainminer_menu_config set launches_enabled=false')
  await expect(isolated.exec(script)).rejects.toThrow('MENU_TEST_ALREADY_ARMED');await isolated.exec('rollback')
  expect(fake.calls.filter(c=>c.method==='POST')).toHaveLength(1)
 }finally{await isolated.close()}
})
it('both release migrations preserve legacy runs and shared raw data, including an uncertain start',async()=>{
 const select="select id,establishment_id,place_id,request_id,status,run_id,raw,result,error_code,lease_until,created_at from rainminer_menu_jobs order by id"
 let before:unknown,shared:unknown
 const isolated=await menuDatabase(undefined,async database=>{
  const a=await newImport(database),b=await newImport(database,{place:PLACE+'B'})
  await database.query("insert into rainminer_menu_jobs(establishment_id,place_id,request_id,status,run_id,raw,result) values($1,$2,$3,'completed','legacy-run',$4,$5)",[a.est,PLACE,crypto.randomUUID(),raw(),{placeId:PLACE,references:raw()}])
  await database.query("insert into rainminer_menu_jobs(establishment_id,place_id,request_id,status,error_code) values($1,$2,$3,'unknown','START_OUTCOME_UNKNOWN')",[b.est,PLACE+'B',crypto.randomUUID()])
  const restaurant=crypto.randomUUID()
  await database.query('insert into private.shared_restaurants values($1,$2)',[restaurant,PLACE])
  await database.query("insert into private.shared_restaurant_menu_versions values($1,'legacy-run',now(),$2,$3,'{}')",[restaurant,raw(),{placeId:PLACE,references:raw()}])
  before=(await database.query(select)).rows
  shared=(await database.query('select * from private.shared_restaurant_menu_versions')).rows
 })
 try{
  expect((await isolated.query(select)).rows).toEqual(before)
  expect((await isolated.query('select * from private.shared_restaurant_menu_versions')).rows).toEqual(shared)
  expect(Number((await isolated.query('select private.rainminer_budget_used() used')).rows[0].used)).toBe(.5)
  const fake=provider();expect(await advanceRainminerMenu(menuAdmin(isolated),'synthetic',{fetch:fake.fetch})).toEqual({claimed:0});expect(fake.calls).toHaveLength(0)
 }finally{await isolated.close()}
})
