import {test,expect} from '@playwright/test'
const coverage={stored_reviews:101,reviews_with_text:95,original_english:8,english_translation_found:87,english_translation_missing:0,coverage_percent:100}
const counts={v6:10,v7:12,common:9,v6_only:1,v7_only:3}
const summary={generation_id:'fixture-v7',model:'gpt-6.1-sol',input_tokens:100,output_tokens:50,total_tokens:150,estimated_cost_usd:0.0007,elapsed_ms:12000,analysis_input_stats:{total_reviews:101,reviews_with_text:95,english_analysis_coverage_percent:100}}
test('manual V7 mobile: one enqueue, resume, completed comparison FR/VI, no live model calls',async({page})=>{
  let posts=0,status:string|null=null
  const real:string[]=[]
  page.on('request',r=>{if(/api\.apify|api\.typesafe|api\.openai|ihuztjkblywzjdruusdj/.test(r.url()))real.push(r.url())})
  await page.route('https://english-fixture.supabase.co/**',async route=>{
    const url=route.request().url()
    if(url.includes('generate-historical-report')){posts++;expect(route.request().postDataJSON()).toMatchObject({first_v7:true});status='running'}
    const run=status?{generation_id:'fixture-v7',status,progress:0,total_steps:6,summary}:null
    const comparison=status==='completed'?{dataset:{v6:101,v7:101,common:101,v6_only:0,v7_only:0,identical:true},sentiment:{agreement_percent:95,difference_count:5,compared:101,missing_classification_count:0},findings:counts,axes:Object.fromEntries(['service','quality','price','atmosphere'].map(x=>[x,counts])),service_themes:Object.fromEntries(['friendly_staff','attentiveness','professionalism','wait_time'].map(x=>[x,counts])),v6:{...summary,generation_id:'fixture-v6'},v7:summary,cost_difference_percent:0,tokens_difference_percent:0}:null
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url.includes('backfill-review')?{coverage,job:null}:{run,comparison})})
  })
  await page.goto('/tests/e2e/fixtures/english.html?language=fr')
  const button=page.getByRole('button',{name:'Lancer le rapport V7'})
  await expect(button).toBeEnabled();expect(posts).toBe(0);await button.dblclick()
  await expect(page.getByText('Rapport V7 en cours',{exact:true})).toBeVisible();expect(posts).toBe(1)
  await page.reload();await expect(page.getByText('Rapport V7 en cours',{exact:true})).toBeVisible();expect(posts).toBe(1)
  status='completed';await page.reload();await expect(page.getByText('Rapport V7 terminé',{exact:true})).toBeVisible()
  await expect(page.getByText('Comparaison V6 / V7',{exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false)
  await page.screenshot({path:`test-results/v7-fr-${test.info().project.name}.png`,fullPage:true})
  await page.goto('/tests/e2e/fixtures/english.html?language=vi');await expect(page.getByText('Báo cáo V7 đã hoàn thành',{exact:true})).toBeVisible()
  await expect(page.getByText('So sánh V6 / V7',{exact:true})).toBeVisible();expect(posts).toBe(1)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false)
  await page.screenshot({path:`test-results/v7-vi-${test.info().project.name}.png`,fullPage:true})
  expect(real).toEqual([])
})
