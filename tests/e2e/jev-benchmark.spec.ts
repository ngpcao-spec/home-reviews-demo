import { test,expect } from '@playwright/test'
test('Jev results FR/VI on mobile and iPad: no overflow, weak axes visible, no production calls',async({page})=>{
  const calls:string[]=[]
  page.on('request',r=>{if(/api\.typesafe|api\.openai|functions\/v1|rest\/v1/.test(r.url()))calls.push(r.url())})
  for(const language of ['fr','vi']) {
    await page.goto('/tests/e2e/fixtures/jev.html?language='+language)
    await expect(page.locator('.jev-axis')).toHaveCount(4)
    await expect(page.locator('.jev-axis[data-axis="price"] .jev-warning')).toHaveCount(2)
    await expect(page.locator('.jev-axis[data-axis="atmosphere"] .jev-warning')).toHaveCount(2)
    await expect(page.locator('.jev-score>strong')).toHaveText(language==='fr'?['96,8 %','99,0 %']:['96,8 %','99,0 %'])
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false)
    expect(await page.locator('.jev-card').evaluateAll(cards=>cards.every(card=>card.scrollWidth<=card.clientWidth+1))).toBe(true)
    await page.getByText(language==='fr'?'Détails techniques':'Chi tiết kỹ thuật',{exact:true}).click()
    await expect(page.getByText('11111111-1111-4111-8111-111111111111',{exact:true})).toBeVisible()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false)
    await page.screenshot({path:`test-results/jev-${language}-${test.info().project.name}.png`,fullPage:true})
  }
  expect(calls).toEqual([])
})
test('Phase 2 themes: mobile FR/VI, expanded themes, weak axes and support, no external calls',async({page})=>{
  const calls:string[]=[]
  page.on('request',r=>{if(/api\.typesafe|api\.openai|functions\/v1|rest\/v1/.test(r.url()))calls.push(r.url())})
  for(const language of ['fr','vi']) {
    await page.goto('/tests/e2e/fixtures/jev.html?phase=2&language='+language)
    await expect(page.locator('.jev-theme-kpis>div')).toHaveCount(5)
    await expect(page.locator('.jev-theme-axis')).toHaveCount(4)
    await page.screenshot({path:`test-results/jev-phase2-summary-${language}-${test.info().project.name}.png`})
    for(const summary of await page.locator('.jev-theme-list>summary').all())await summary.click()
    await expect(page.locator('.jev-theme-detail')).toHaveCount(25)
    await expect(page.locator('[data-theme-axis="price"]>.jev-warning')).toBeVisible()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false)
    expect(await page.locator('.jev-card').evaluateAll(cards=>cards.every(card=>card.scrollWidth<=card.clientWidth+1))).toBe(true)
    await page.screenshot({path:`test-results/jev-phase2-${language}-${test.info().project.name}.png`,fullPage:true})
  }
  expect(calls).toEqual([])
})
