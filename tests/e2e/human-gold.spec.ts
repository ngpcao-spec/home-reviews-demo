import {test,expect} from '@playwright/test'
test('blind Gold FR/VI mobile: explicit choices, autosave/resume, translation replacement, no external calls',async({page})=>{
  const calls:string[]=[];page.on('request',r=>{if(/api\.typesafe|api\.openai|apify|functions\/v1|rest\/v1/.test(r.url()))calls.push(r.url())})
  for(const language of ['fr','vi']){
    await page.goto('/tests/e2e/fixtures/gold.html?language='+language)
    await expect(page.getByText(language==='fr'?'Avis 1 / 40':'Đánh giá 1 / 40',{exact:true})).toBeVisible()
    await page.getByText(language==='fr'?'Service':'Dịch vụ',{exact:true}).click()
    await page.getByRole('button',{name:language==='fr'?/^Amabilité/:/^Sự thân thiện/}).click();await page.getByRole('button',{name:language==='fr'?'Positive':'Tích cực',exact:true}).click()
    expect(await page.locator('body').textContent()).not.toMatch(/Sol|Jev|rating|original_text|probabilities|selection_bucket/)
    await page.getByRole('button',{name:language==='fr'?'Valider cet avis':'Xác nhận đánh giá này'}).click();await expect(page.getByText(language==='fr'?'1 / 40 terminés':'1 / 40 đã hoàn thành',{exact:true})).toBeVisible()
    await page.reload();await expect(page.getByText(language==='fr'?'Avis 2 / 40':'Đánh giá 2 / 40',{exact:true})).toBeVisible()
    await page.getByRole('button',{name:language==='fr'?'Traduction anglaise incorrecte':'Bản dịch tiếng Anh không chính xác'}).click();await page.getByRole('button',{name:language==='fr'?'Confirmer la finalisation':'Xác nhận hoàn tất'}).click()
    await expect(page.getByText(language==='fr'?'Avis 2 / 40':'Đánh giá 2 / 40',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false)
    await page.screenshot({path:`test-results/gold-annotation-${language}-${test.info().project.name}.png`,fullPage:true})
    await page.evaluate(()=>localStorage.clear())
  }
  expect(calls).toEqual([])
})
test('completed Gold FR/VI mobile results: axes, supports, CI, no editable labels or horizontal tables',async({page})=>{
  for(const language of ['fr','vi']){
    await page.goto('/tests/e2e/fixtures/gold.html?phase=results&language='+language)
    await expect(page.getByRole('heading',{name:'GOLD SET RESULT'})).toBeVisible();await expect(page.getByText(language==='fr'?'IC à 95 %':'Khoảng tin cậy 95%',{exact:true})).toBeVisible()
    expect(await page.getByRole('button').count()).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false)
    await page.screenshot({path:`test-results/gold-results-${language}-${test.info().project.name}.png`,fullPage:true})
  }
})
