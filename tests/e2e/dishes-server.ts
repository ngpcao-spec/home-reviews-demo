import type {Plugin} from 'vite'
import {dishDatabase,savedMenu,ORG,ORG2,USER,USER2} from '../fixtures/dish-associations-database'
export const dishTestIds={banh:'30000000-0000-4000-8000-000000000001',shared:'30000000-0000-4000-8000-000000000002',pho:'30000000-0000-4000-8000-000000000003',chicken:'30000000-0000-4000-8000-000000000004'}
export function dishesServer():Plugin{
 const ready=(async()=>{
  const db=await dishDatabase(),r=crypto.randomUUID()
  await db.query('insert into private.shared_restaurants values($1,$2)',[r,savedMenu.placeId])
  await db.query('insert into private.shared_restaurant_pilot_places values($1)',[savedMenu.placeId])
  for(const [id,org,name] of [[dishTestIds.banh,ORG,savedMenu.establishment],[dishTestIds.shared,ORG2,savedMenu.establishment],[dishTestIds.pho,ORG,'Phở générique — test'],[dishTestIds.chicken,ORG,'Bistro Phở gà — test']]){
   await db.query('insert into establishments(id,name,organization_id,place_id) values($1,$2,$3,$4)',[id,name,org,savedMenu.placeId])
   if([dishTestIds.banh,dishTestIds.shared].includes(id)){
    await db.query('insert into private.shared_restaurant_establishments values($1,$2,$3)',[id,r,org])
    await db.query('insert into private.shared_restaurant_subscriptions values($1,$2,$3)',[r,org,org===ORG?'fr':'vi'])
   }
  }
  for(const [id,raw] of [[dishTestIds.banh,savedMenu.raw],[dishTestIds.pho,[{name:'Phở',placeId:savedMenu.placeId}]],[dishTestIds.chicken,[{name:'Phở gà',placeId:savedMenu.placeId}]]] as const)
   await db.query("insert into rainminer_menu_jobs(establishment_id,place_id,request_id,status,run_id,raw,result,retrieved_at) values($1,$2,$3,'completed',$4,$5,$6,now())",[id,savedMenu.placeId,crypto.randomUUID(),id===dishTestIds.banh?savedMenu.runId:crypto.randomUUID(),raw,{placeId:savedMenu.placeId,references:[]}])
  return db
 })()
 let serial=Promise.resolve()
 return {name:'isolated-dishes',configureServer(server){
  server.middlewares.use('/__dishes',(req,res)=>{
   let body='';req.on('data',c=>{body+=c});req.on('end',()=>{
    serial=serial.then(async()=>{
     const db=await ready
     try{
      const {name,args={},user}=JSON.parse(body)
      if(!['read_restaurant_dishes','list_dish_names','edit_restaurant_dishes','search_restaurants_by_dish'].includes(name))throw Error('TEST_RPC_FORBIDDEN')
      if(Object.keys(args).some(k=>!/^p_[a-z_]+$/.test(k)))throw Error('INVALID_ARGS')
      await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user==='b'?USER2:USER]);await db.exec('set local role authenticated')
      const result=await db.query('select public.'+name+'('+Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')+') value',Object.values(args))
      await db.exec('commit');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:result.rows[0].value,error:null}))
     }catch(e){await db.exec('rollback');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:null,error:{message:e instanceof Error?e.message:String(e)}}))}
    })
   })
  })
 },closeBundle:async()=>{await (await ready).close()}}
}
