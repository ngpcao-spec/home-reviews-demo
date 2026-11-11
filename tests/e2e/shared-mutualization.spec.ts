import {test,expect,type Page} from '@playwright/test'
import {readFileSync,writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {join} from 'node:path'
import {parallelPresentationRow} from '../fixtures/parallel-presentation'
import {importRainminerMenu} from '../../supabase/functions/_shared/rainminer-menu.mjs'
const placeId='ChIJTQBISo9ncDERyPcP3aY9kI4'
test('complete mutualization with real browser Auth database and workers',async({browser})=>{
 test.setTimeout(240_000)
 const fixture=JSON.parse(readFileSync(process.env.CI_AUTH_FIXTURE!,'utf8'))
 const status=JSON.parse(readFileSync(process.env.CI_SUPABASE_STATUS!,'utf8'))
 const require=createRequire(join(process.env.CI_PG_PACKAGE!,'package.json'))
 const db=new (require('pg').Client)({connectionString:status.DB_URL});await db.connect()
 const rows=async(sql:string,args:unknown[]=[]) => (await db.query(sql,args)).rows
 const passed:string[]=[]
 const mark=(name:string)=>{passed.push(name);writeFileSync(process.env.CI_BROWSER_RECEIPT!,JSON.stringify({passed}));console.log('BROWSER_SCENARIO_PASSED',name)}
 const contexts=await Promise.all([0,1].map(()=>browser.newContext())),pages:Page[]=[]
 const provider=async()=>await (await fetch('http://127.0.0.1:4411/control/status')).json()
 const worker=async(name:string,body:unknown={},header='x-home-reviews-scheduler')=>{
  const r=await fetch(status.API_URL+'/functions/v1/'+name,{method:'POST',headers:{'Content-Type':'application/json',[header]:header==='x-home-reviews-scheduler'?fixture.scheduler:fixture.webhook},body:JSON.stringify(body)})
  const data=await r.json();expect(r.status,JSON.stringify(data)).toBeLessThan(300);return data
 }
 const invoke=async(page:Page,name:string,body:unknown)=>page.evaluate(async({name,body})=>{
  const {supabase}=await import(/* @vite-ignore */'/src/lib/supabase.ts');const {data,error}=await supabase.functions.invoke(name,{body});if(error)throw Error(error.message);return data
 },{name,body})
 try{
  for(let i=0;i<2;i++){
   const page=await contexts[i].newPage();pages.push(page)
   await page.addLocatorHandler(page.getByRole('dialog',{name:'Restez informé des nouveaux avis'}),async()=>{
    await page.getByRole('button',{name:'Plus tard',exact:true}).click()
   })
   await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort())
   await page.goto('/')
   const id=await page.evaluate(async user=>{const {supabase}=await import(/* @vite-ignore */'/src/lib/supabase.ts');const r=await supabase.auth.signInWithPassword(user);if(r.error)throw r.error;return (await supabase.auth.getUser()).data.user.id},{email:fixture.users[i].email,password:fixture.users[i].password})
   expect(id).toBe(fixture.users[i].id)
   await page.goto('/etablissements/ajouter')
   await page.getByRole('textbox').fill(`https://www.google.com/maps?query_place_id=${placeId}`)
   await page.getByRole('button',{name:'Rechercher l’établissement',exact:true}).click()
   await expect(page.getByRole('button',{name:'Ajouter cet établissement',exact:true})).toBeVisible()
  }
  mark('real-auth')
  await Promise.all(pages.map(p=>p.getByRole('button',{name:'Ajouter cet établissement',exact:true}).click()))
  await expect.poll(async()=>Number((await rows('select count(*) n from initial_import_jobs'))[0].n)).toBe(2)
  const imports=Promise.all([worker('process-initial-import-jobs'),worker('process-initial-import-jobs')])
  await expect.poll(async()=>(await provider()).runs.length).toBe(1)
  await expect(rows('delete from private.shared_restaurant_pilot_places where place_id=$1',[placeId])).rejects.toThrow(/SHARED_PILOT_REQUIRES_DRAIN/)
  await imports
  // Only resume the same waiting job; never retry a failed or unknown attempt.
  await rows("update initial_import_jobs set available_at=now() where status in ('queued','retry') and provider_start_attempted_at is null")
  await worker('process-initial-import-jobs')
  const jobs=await rows('select status,error_code from initial_import_jobs')
  expect(jobs,JSON.stringify(jobs)).toEqual([{status:'completed',error_code:null},{status:'completed',error_code:null}])
  expect((await provider()).runs).toHaveLength(1)
  const establishments=await Promise.all(fixture.users.map(async(user:{organizationId:string})=>(await rows('select * from establishments where organization_id=$1',[user.organizationId]))[0]))
  expect(establishments.every((e:{id:string;place_id:string})=>e.place_id===placeId)).toBe(true)
  expect(establishments[0].id).not.toBe(establishments[1].id)
  for(const e of establishments)expect(Number((await rows('select count(*) n from reviews where establishment_id=$1',[e.id]))[0].n)).toBe(1)
  mark('simultaneous-add')
  const raw=[{name:'Riz aux légumes',category:'Food',price:null,placeId},{name:'Riz aux légumes',category:'Food',price:null,placeId},{name:'Green tea',category:'Tea - Coffee',placeId}]
  const menu=importRainminerMenu(raw,{actor:{name:'rainminer/google-maps-menu-scraper'},runId:'fixture-menu',datasetId:'fixture-menu-data',input:{placeIds:[placeId]}},placeId)
  await rows("insert into rainminer_menu_jobs(establishment_id,place_id,request_id,status,run_id,raw,result) values($1,$2,$3,'completed','fixture-menu',$4,$5)",[establishments[0].id,placeId,crypto.randomUUID(),JSON.stringify(raw),JSON.stringify(menu)])
  const restaurant=(await rows('select restaurant_id from private.shared_restaurant_establishments where establishment_id=$1',[establishments[0].id]))[0].restaurant_id
  const report={...parallelPresentationRow('fr'),id:crypto.randomUUID()}
  // Saved successful archive fixture; production read paths and access rules remain real.
  await rows("insert into private.shared_restaurant_report_versions(restaurant_id,report_id,language,generated_at,document,evidence) values($1,$2,'fr',$3,$4,$5)",[restaurant,report.id,report.generated_at,JSON.stringify({...report,source_reviews:[]}),JSON.stringify({source_reviews:report.source_reviews,evidence:report.controls.evidence,scope:{review_count:7},source_available:true})])
  for(let i=0;i<2;i++){
   await pages[i].goto('/etablissements/'+establishments[i].id)
   await expect(pages[i].getByText('Riz aux légumes',{exact:true})).toHaveCount(2)
   const saved=await invoke(pages[i],'parallel-reports',{action:'read_current',establishment_id:establishments[i].id})
   expect(saved.experimental.id).toBe(report.id);expect(saved.experimental.controls.evidence).toEqual(report.controls.evidence)
   await pages[i].goto('/analyses');await expect(pages[i].locator('[data-report-id="'+report.id+'"]')).toBeVisible()
  }
  expect((await provider()).runs).toHaveLength(1);expect((await provider()).aiCalls).toBe(0)
  expect(Number((await rows("select count(*) n from notifications where type='new_negative_review'"))[0].n)).toBe(0)
  mark('existing-data-and-proofs')
  await fetch('http://127.0.0.1:4411/control/negative',{method:'POST'})
  await rows("update private.shared_restaurant_establishments set subscribed_at='2026-11-01'")
  await rows("update organizations set monitoring_interval_hours=case when id=$1 then 3 else 12 end",[fixture.users[0].organizationId])
  await rows("update establishments set next_sync_at=now()-interval '1 minute'")
  await Promise.all([worker('schedule-google-reviews'),worker('schedule-google-reviews')])
  expect(Number((await rows("select count(*) n from review_sync_jobs where status='queued'"))[0].n)).toBe(1)
  await Promise.all([worker('process-review-sync-jobs'),worker('process-review-sync-jobs')])
  const syncJobs=await rows('select status,error_code from review_sync_jobs')
  expect(syncJobs,JSON.stringify(syncJobs)).toEqual([{status:'completed',error_code:null}])
  expect((await provider()).runs).toHaveLength(2)
  const reviews=await Promise.all(establishments.map(async(e:{id:string;place_id:string})=>(await rows("select * from reviews where establishment_id=$1 and external_review_id='fixture-negative'",[e.id]))[0]))
  expect(reviews.every(Boolean)).toBe(true)
  const cadence=await rows("select extract(epoch from(next_sync_at-last_sync_at))/3600 hours from establishments where active")
  expect(cadence.every((r:{hours:string})=>Number(r.hours)===3)).toBe(true)
  for(let i=0;i<2;i++){await pages[i].goto('/avis/'+reviews[i].id);await expect(pages[i].getByText('Le repas était froid et le service très lent.',{exact:true})).toBeVisible()}
  mark('shared-negative-sync')
  await Promise.all(reviews.map((r:{id:string})=>worker('analyze-review',{review_id:r.id},'x-home-reviews-webhook')))
  const operations=await rows("select key from private.shared_restaurant_operations where state='completed'")
  expect(operations).toHaveLength(1)
  for(const review of reviews)await worker('analyze-review',{review_id:review.id,shared_operation_key:operations[0].key,shared_language:'fr'},'x-home-reviews-webhook')
  expect((await provider()).aiCalls).toBe(1)
  for(let i=0;i<2;i++){await pages[i].reload();await expect(pages[i].getByRole('textbox')).toHaveValue(/Merci pour votre retour/)}
  mark('single-analysis')
  await pages[0].getByRole('textbox').fill('Brouillon privé de la première organisation.');await pages[0].getByRole('textbox').blur()
  await expect.poll(async()=>(await rows('select reply_draft_text from reviews where id=$1',[reviews[0].id]))[0].reply_draft_text).toBe('Brouillon privé de la première organisation.')
  expect((await rows('select reply_draft_text from reviews where id=$1',[reviews[1].id]))[0].reply_draft_text).not.toBe('Brouillon privé de la première organisation.')
  const forbidden=await pages[1].evaluate(async id=>{const {supabase}=await import(/* @vite-ignore */'/src/lib/supabase.ts');return (await supabase.from('reviews').select('id,reply_draft_text').eq('id',id)).data},reviews[0].id)
  expect(forbidden).toEqual([])
  for(let i=0;i<2;i++){await pages[i].goto('/notifications');await expect(pages[i].getByText('Le repas était froid et le service très lent.',{exact:true})).toBeVisible()}
  await pages[0].locator('button.notification-item').filter({hasText:'Le repas était froid'}).click()
  const notices=await rows('select organization_id,read_at from notifications where review_id=any($1::uuid[])',[reviews.map((r:{id:string})=>r.id)])
  expect(notices.find((n:{organization_id:string;read_at:string|null})=>n.organization_id===fixture.users[0].organizationId).read_at).not.toBeNull()
  expect(notices.find((n:{organization_id:string;read_at:string|null})=>n.organization_id===fixture.users[1].organizationId).read_at).toBeNull()
  mark('private-isolation')
  await pages[0].goto('/etablissements/'+establishments[0].id);await pages[0].locator('button.danger-button').click()
  await pages[0].getByRole('dialog').getByRole('button',{name:'Supprimer',exact:true}).click()
  await expect.poll(async()=>(await rows('select active from establishments where id=$1',[establishments[0].id]))[0].active).toBe(false)
  await pages[1].goto('/etablissements/'+establishments[1].id);await expect(pages[1].getByText('Riz aux légumes',{exact:true})).toHaveCount(2)
  mark('unsubscribe')
  // A later subscription joins saved content immediately, without historical alerts.
  await pages[0].goto('/etablissements/ajouter')
  await pages[0].getByRole('textbox').fill(`https://www.google.com/maps?query_place_id=${placeId}`)
  await pages[0].getByRole('button',{name:'Rechercher l’établissement',exact:true}).click()
  await pages[0].getByRole('button',{name:'Ajouter cet établissement',exact:true}).click()
  await expect.poll(async()=>(await rows('select active from establishments where id=$1',[establishments[0].id]))[0].active).toBe(true)
  expect((await provider()).runs).toHaveLength(2)
  expect(Number((await rows("select count(*) n from notifications where organization_id=$1 and type='new_negative_review'",[fixture.users[0].organizationId]))[0].n)).toBe(0)
  const outsider=await invoke(pages[0],'add-establishment',{confirmed:true,query:'https://www.google.com/maps?cid=123456',expectedGoogleId:'123456',candidate:{name:'Outside pilot',placeId:'ChIJOutsidePilotFixture'}})
  expect(outsider.importJobId).toBeTruthy()
  await rows('set role service_role')
  const reserve=(await rows("select reserve_shared_initial_import($1,'initial-latest-150-v1') result",[outsider.importJobId]))[0].result
  await rows('reset role');expect(reserve.state).toBe('legacy')
  expect(Number((await rows("select count(*) n from private.shared_restaurants where place_id='ChIJOutsidePilotFixture'"))[0].n)).toBe(0)
  mark('outside-pilot')
  const before=await rows('select id,external_review_id from reviews order by id')
  await rows('delete from private.shared_restaurant_pilot_places where place_id=$1',[placeId])
  await rows(readFileSync('supabase/maintenance/disable-shared-restaurants.sql','utf8'))
  expect(await rows('select id,external_review_id from reviews order by id')).toEqual(before)
  await pages[1].goto('/avis/'+reviews[1].id);await expect(pages[1].getByText('Le repas était froid et le service très lent.',{exact:true})).toBeVisible()
  expect((await provider()).runs).toHaveLength(2);expect((await provider()).aiCalls).toBe(1)
  mark('disable-and-rollback')
 }finally{await Promise.all(contexts.map(c=>c.close()));await db.end()}
})
