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
  const {supabase}=await import(/* @vite-ignore */'/src/lib/supabase.ts');const {data,error}=await supabase.functions.invoke(name,{body});if(error){const detail=error.context instanceof Response?await error.context.json():null;throw Error(name+': '+JSON.stringify(detail??error.message))}return data
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
  for(const page of pages){
   // Complete the real onboarding acknowledgement, so a later visit to Add
   // does not resume this still-unacknowledged successful import screen.
   await page.getByRole('button',{name:'Retour aux établissements',exact:true}).click()
  }
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
   await pages[i].goto('/analyses?mode=historical&establishment='+establishments[i].id);await expect(pages[i].locator('[data-report-id="'+report.id+'"]')).toBeVisible()
  }
  expect((await provider()).runs).toHaveLength(1);expect((await provider()).aiCalls).toBe(0)
  await pages[1].goto('/plus');await pages[1].locator('#preferred-language').selectOption('vi')
  await expect.poll(async()=>(await rows('select preferred_language from profiles where user_id=$1',[fixture.users[1].id]))[0].preferred_language).toBe('vi')
  await pages[1].goto('/analyses?mode=historical&establishment='+establishments[1].id)
  await pages[1].getByRole('combobox',{name:'Báo cáo có sẵn của cơ sở'}).selectOption(report.id)
  await expect(pages[1].locator('[data-report-id="'+report.id+'"]')).toBeVisible()
  expect((await provider()).aiCalls).toBe(0)
  await pages[1].goto('/plus');await pages[1].locator('#preferred-language').selectOption('fr')
  await expect.poll(async()=>(await rows('select preferred_language from profiles where user_id=$1',[fixture.users[1].id]))[0].preferred_language).toBe('fr')
  expect(Number((await rows("select count(*) n from notifications where type='new_negative_review'"))[0].n)).toBe(0)
  mark('existing-data-and-proofs')
  await fetch('http://127.0.0.1:4411/control/negative',{method:'POST'})
  await rows("update private.shared_restaurant_establishments set subscribed_at='2026-11-01'")
  await rows("update organizations set monitoring_interval_hours=case when id=$1 then 3 else 12 end",[fixture.users[0].organizationId])
  // Advance the common collection's clock, not just its private projections:
  // the real scheduler recomputes their deadlines from this successful collection.
  await rows("update private.shared_restaurant_collections set last_success_at=now()-interval '4 hours' where restaurant_id=$1",[restaurant])
  await rows("update establishments set next_sync_at=now()-interval '1 minute'")
  await Promise.all([worker('schedule-google-reviews'),worker('schedule-google-reviews')])
  expect(Number((await rows("select count(*) n from review_sync_jobs where status='queued'"))[0].n)).toBe(1)
  await Promise.all([worker('process-review-sync-jobs'),worker('process-review-sync-jobs')])
  expect((await provider()).runs).toHaveLength(2)
  // The worker checkpoints the run and yields before polling it. Continue that
  // existing run only; do not retry a failed job or clear its provider identity.
  await rows("update review_sync_jobs set available_at=now() where status='queued' and apify_run_id is not null")
  await worker('process-review-sync-jobs')
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
  await expect.poll(async()=>(await rows("select draft_text from review_reply_drafts where review_id=$1 and language='fr'",[reviews[0].id]))[0].draft_text).toBe('Brouillon privé de la première organisation.')
  expect((await rows("select draft_text from review_reply_drafts where review_id=$1 and language='fr'",[reviews[1].id]))[0].draft_text).not.toBe('Brouillon privé de la première organisation.')
  const forbidden=await pages[1].evaluate(async id=>{const {supabase}=await import(/* @vite-ignore */'/src/lib/supabase.ts');return (await supabase.from('review_reply_drafts').select('review_id,draft_text').eq('review_id',id)).data},reviews[0].id)
  expect(forbidden).toEqual([])
  for(let i=0;i<2;i++){await pages[i].goto('/notifications');await expect(pages[i].getByText('Le repas était froid et le service très lent.',{exact:true})).toBeVisible()}
  await pages[0].locator('button.notification-item').filter({hasText:'Le repas était froid'}).click()
  await expect.poll(async()=>(await rows('select read_at from notifications where review_id=$1',[reviews[0].id]))[0].read_at).not.toBeNull()
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
  // Representative real archive shapes: an original plus a single Apify target
  // language, and a publication whose disposable analysis was already retired.
  // No customer text, real identity or provider response is exported into CI.
  const extraUsers=[]
  for(let i=0;i<2;i++){
   const email=`pilot-vi-${i}@example.test`,password=crypto.randomUUID()+'Aa1!'
   const response=await fetch(status.API_URL+'/auth/v1/admin/users',{method:'POST',headers:{apikey:status.SERVICE_ROLE_KEY,Authorization:'Bearer '+status.SERVICE_ROLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password,email_confirm:true})})
   expect(response.ok).toBe(true);const user=await response.json()
   await rows("update profiles set preferred_language='vi' where user_id=$1",[user.id])
   const org=(await rows('select organization_id from organization_members where user_id=$1',[user.id]))[0].organization_id
   const context=await browser.newContext();contexts.push(context);const page=await context.newPage();pages.push(page)
   await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort())
   await page.goto('/')
   await page.evaluate(async credentials=>{const {supabase}=await import(/* @vite-ignore */'/src/lib/supabase.ts');const r=await supabase.auth.signInWithPassword(credentials);if(r.error)throw r.error},{email,password})
   extraUsers.push({id:user.id,organizationId:org,page})
  }
  const addBody={confirmed:true,query:`https://www.google.com/maps?query_place_id=${placeId}`,expectedGoogleId:'10272778536914778056',candidate:{name:'K.HOUSE Restaurant',placeId}}
  const additions=await Promise.all(extraUsers.map(u=>invoke(u.page,'add-establishment',addBody)))
  expect(additions.every(a=>a.status==='queued')).toBe(true)
  await Promise.all([worker('process-initial-import-jobs'),worker('process-initial-import-jobs')])
  await rows("update initial_import_jobs set available_at=now() where status in ('queued','retry') and provider_start_attempted_at is null")
  await worker('process-initial-import-jobs')
  const viEst=await Promise.all(extraUsers.map(async u=>(await rows('select * from establishments where organization_id=$1',[u.organizationId]))[0]))
  expect(viEst.every(e=>e?.review_collection_status==='complete'&&e.collection_language==='vi')).toBe(true)
  expect((await provider()).runs).toHaveLength(3)
  expect((await provider()).runs.filter((r:{input:{language:string}})=>r.input.language==='vi')).toHaveLength(1)
  for(let i=0;i<2;i++){
   const ids=(await rows('select id from reviews where establishment_id=$1 order by external_review_id',[viEst[i].id])).map((r:{id:string})=>r.id)
   const display=await extraUsers[i].page.evaluate(async ids=>{const {supabase}=await import(/* @vite-ignore */'/src/lib/supabase.ts');const r=await supabase.rpc('read_review_display',{p_reviews:ids});if(r.error)throw r.error;return r.data},ids)
   expect(display.every((r:{status:string;language:string})=>r.status==='translated'&&r.language==='vi')).toBe(true)
   expect(display.map((r:{translated_text:string})=>r.translated_text).sort()).toEqual(['Bữa ăn nguội và phục vụ chậm.','Đón tiếp tốt.'].sort())
  }
  expect(Number((await rows('select count(*) n from private.shared_restaurants'))[0].n)).toBe(1)
  expect(Number((await rows('select count(*) n from private.shared_restaurant_reviews where restaurant_id=$1',[restaurant]))[0].n)).toBe(2)
  expect((await rows('select language from private.shared_restaurant_collections where restaurant_id=$1 order by language',[restaurant])).map(r=>r.language)).toEqual(['fr','vi'])
  // Same-language later subscription: real remove/add endpoints, no new run.
  await extraUsers[1].page.evaluate(async id=>{const {supabase}=await import(/* @vite-ignore */'/src/lib/supabase.ts');const r=await supabase.rpc('remove_establishment_subscription',{p_establishment:id});if(r.error)throw r.error},viEst[1].id)
  const rejoined=await invoke(extraUsers[1].page,'add-establishment',addBody)
  expect(rejoined.status).toBe('completed');expect(rejoined.establishmentId).toBe(viEst[1].id)
  expect((await provider()).runs).toHaveLength(3);expect((await provider()).aiCalls).toBe(1)
  expect(Number((await rows("select count(*) n from notifications where organization_id=any($1::uuid[]) and type='new_negative_review'",[extraUsers.map(u=>u.organizationId)]))[0].n)).toBe(0)
  // A lagging VI checkpoint must not advance when FR distributes the same review.
  await rows("update establishments set last_review_id='fixture-old',last_review_at='2026-11-01T10:00:00Z' where id=any($1::uuid[])",[viEst.map(e=>e.id)])
  await rows("update private.shared_restaurant_collections set last_success_at=case when language='fr' then now()-interval '4 hours' else now() end where restaurant_id=$1",[restaurant])
  await worker('schedule-google-reviews');await worker('process-review-sync-jobs')
  await rows("update review_sync_jobs set available_at=now() where status in ('queued','retry')")
  await worker('process-review-sync-jobs')
  expect((await provider()).runs).toHaveLength(4)
  expect((await rows('select last_review_id from establishments where id=any($1::uuid[])',[viEst.map(e=>e.id)])).every(e=>e.last_review_id==='fixture-old')).toBe(true)
  await rows("update private.shared_restaurant_collections set last_success_at=now()-interval '25 hours' where restaurant_id=$1 and language='vi'",[restaurant])
  await Promise.all([worker('schedule-google-reviews'),worker('schedule-google-reviews')])
  await Promise.all([worker('process-review-sync-jobs'),worker('process-review-sync-jobs')])
  await rows("update review_sync_jobs set available_at=now() where status in ('queued','retry')")
  await worker('process-review-sync-jobs')
  expect((await provider()).runs).toHaveLength(5)
  expect((await rows('select last_review_id from establishments where id=any($1::uuid[])',[viEst.map(e=>e.id)])).every(e=>e.last_review_id==='fixture-negative')).toBe(true)
  for(const e of viEst)expect(Number((await rows('select count(*) n from reviews where establishment_id=$1',[e.id]))[0].n)).toBe(2)
  mark('language-provider-reuse')

  const archivedId=crypto.randomUUID(),sourceRun=crypto.randomUUID(),dated='2026-10-28T04:15:34.709276Z'
  const sources=Array.from({length:150},(_,i)=>({id:crypto.randomUUID(),rating:2,published_at:'2026-10-01T00:00:00Z',original_language:'en',analysis_language:'vi',analysis_source:'apify',analysis_text_sha256:i.toString(16).padStart(64,'0'),original_text_sha256:(i+150).toString(16).padStart(64,'0'),review_context:{mealType:'Dinner'},review_detailed_rating:{Food:2},translation_provenance:{provider:'apify',language:'vi'}}))
  const evidence=Array.from({length:32},(_,i)=>({evidence_id:`binding-${i}`,review_id:sources[i].id,category:'service',polarity:'negative',quote_sha256:(i+300).toString(16).padStart(64,'0')}))
  const oldReport={...parallelPresentationRow('vi'),id:archivedId,generated_at:dated,current_source_run_id:sourceRun,source_reviews:[],original_report:null,raw_response:null,corrections:null,controls:{technical_checks_passed:true,dated_publication:true}}
  const doc=(await rows('select private.publication_generated_report($1::jsonb) doc',[JSON.stringify(oldReport)]))[0].doc
  await rows(`insert into current_report_publications(establishment_id,organization_id,language,report_id,source_run_id,source_created_at,generated_at,scope,document,source_bindings,evidence_bindings,stale,stale_reason)
   values($1,$2,'vi',$3,$4,$5,$5,$6,$7,$8,$9,true,'CORPUS_CHANGED')`,[viEst[0].id,extraUsers[0].organizationId,archivedId,sourceRun,dated,JSON.stringify({review_count:150,stale:true}),JSON.stringify(doc),JSON.stringify(sources),JSON.stringify(evidence)])
  expect(Number((await rows('select count(*) n from analysis_parallel_reports where id=$1',[archivedId]))[0].n)).toBe(0)
  // Replay capture and repair the exact prior incomplete-archive shape.
  await rows("update private.shared_restaurant_report_versions set evidence=evidence-'evidence_bindings' where report_id=$1",[archivedId])
  await rows('select archive_shared_restaurant_reports($1)',[viEst[0].id])
  await rows('select archive_shared_restaurant_reports($1)',[viEst[0].id])
  const stored=(await rows('select * from private.shared_restaurant_report_versions where report_id=$1',[archivedId]))[0]
  expect(stored.document).toEqual(doc);expect(stored.language).toBe('vi')
  expect(stored.evidence.source_bindings).toEqual(sources);expect(stored.evidence.evidence_bindings).toEqual(evidence)
  expect(stored.evidence.source_reviews).toEqual([]);expect(stored.evidence.source_available).toBe(false)
  for(const u of extraUsers){
   const e=viEst[extraUsers.indexOf(u)]
   const result=await invoke(u.page,'parallel-reports',{action:'read_current',establishment_id:e.id,shared_report_id:archivedId})
   expect(result.experimental.id).toBe(archivedId);expect(Date.parse(result.experimental.generated_at)).toBe(Date.parse(dated))
   expect(result.experimental.derived_report).toEqual(doc.derived_report)
   expect(result.experimental.source_bindings).toEqual(sources);expect(result.experimental.evidence_bindings).toEqual(evidence)
   expect(result.experimental.controls.evidence).toEqual(evidence);expect(result.experimental.controls.source_available).toBe(false)
   expect(result.retention.scope.stale).toBe(true);expect(result.retention.scope.stale_reason).toBe('CORPUS_CHANGED')
   await u.page.goto('/analyses?mode=historical&establishment='+e.id)
   await expect(u.page.locator('[data-report-id="'+archivedId+'"]')).toBeVisible()
  }
  // Dated VI version is not silently reused as a FR report.
  await rows('set role service_role')
  expect((await rows('select read_shared_report_version($1,$2,$3,$4) result',[establishments[0].id,'fr',fixture.users[0].id,archivedId]))[0].result).toBeNull()
  await rows('reset role')
  expect((await provider()).runs).toHaveLength(5);expect((await provider()).aiCalls).toBe(1)
  mark('publication-only-evidence')
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
  expect((await provider()).runs).toHaveLength(5);expect((await provider()).aiCalls).toBe(1)
  mark('disable-and-rollback')
 }finally{await Promise.allSettled(contexts.map(c=>c.close()));await db.end()}
})
