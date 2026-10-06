import {test,expect} from '@playwright/test'
test('English preparation FR/VI: one explicit mock POST, durable retrieval, no real provider calls',async({page})=>{
  let posts=0,job:null|{id:string;status:string}=null
  const coverage={stored_reviews:101,reviews_with_text:95,original_english:5,english_translation_found:0,english_translation_missing:90,coverage_percent:5/95*100}
  await page.route('https://english-fixture.supabase.co/**',async route=>{
    if(route.request().url().includes('get-historical-report-status')){await route.fulfill({status:200,contentType:'application/json',body:'{"run":null}'});return}
    if(route.request().method()==='POST'){posts++;job={id:'fixture-job',status:'running'}}
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({coverage,job})})
  })
  const real:string[]=[]
  page.on('request',r=>{if(/api\.apify|api\.typesafe|api\.openai|ihuztjkblywzjdruusdj/.test(r.url()))real.push(r.url())})
  for(const language of ['fr','vi']){
    await page.goto('/tests/e2e/fixtures/english.html?language='+language)
    const button=page.getByRole('button',{name:language==='fr'?'Récupérer les versions anglaises':'Lấy phiên bản tiếng Anh'})
    await expect(button).toBeVisible()
    if(language==='fr'){expect(posts).toBe(0);await button.dblclick();await expect(button).toBeDisabled();expect(posts).toBe(1)}
    else {await expect(button).toBeDisabled();expect(posts).toBe(1)}
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false)
    await page.screenshot({path:`test-results/english-${language}-${test.info().project.name}.png`})
  }
  expect(real).toEqual([])
})
