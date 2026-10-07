import {test,expect} from '@playwright/test'
test('final human check FR/VI mobile: at most three themes, explicit choices, blind autosave and reopening',async({page})=>{
  const calls:string[]=[];page.on('request',r=>{if(/api\.typesafe|api\.openai|apify|functions\/v1|rest\/v1/.test(r.url()))calls.push(r.url())})
  for(const language of ['fr','vi']){
    await page.goto('/tests/e2e/fixtures/adjudication.html?language='+language)
    expect(await page.locator('[data-adjudication-theme]').count()).toBeLessThanOrEqual(3);await expect(page.locator('button[aria-pressed=true]')).toHaveCount(0)
    const next=page.getByRole('button',{name:language==='fr'?'Suivant':'Tiếp'});await expect(next).toBeDisabled()
    expect(await page.locator('body').textContent()).not.toMatch(/Gold actuel|Gold hiện tại|Sol|Jev|rating|probabilities/)
    for(const card of await page.locator('[data-adjudication-theme]').all()){await card.getByRole('button',{name:language==='fr'?'Absent':'Không có',exact:true}).click();await expect(card.locator('button[aria-pressed=true]')).toHaveCount(1)}
    await expect(next).toBeEnabled();await next.click();await page.reload();await expect(page.getByText(language==='fr'?'Contrôle 2 / 12':'Kiểm tra 2 / 12',{exact:true})).toBeVisible()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await page.screenshot({path:`test-results/adjudication-draft-${language}-${test.info().project.name}.png`,fullPage:true});await page.evaluate(()=>localStorage.clear())
  }
  expect(calls).toEqual([])
})
test('finalized check FR/VI: exact agreements, Gold mismatches and English accordions without edit buttons',async({page})=>{
  for(const language of ['fr','vi']){
    await page.goto('/tests/e2e/fixtures/adjudication.html?phase=results&language='+language)
    await expect(page.getByRole('heading',{name:language==='fr'?'Résultat du contrôle humain':'Kết quả kiểm tra thủ công'})).toBeVisible()
    await expect(page.getByText(language==='fr'?'Accord Humain / Gold':'Đồng thuận Người / Gold',{exact:true})).toBeVisible();expect(await page.getByRole('button').count()).toBe(0)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await page.screenshot({path:`test-results/adjudication-results-${language}-${test.info().project.name}.png`,fullPage:true})
  }
})
