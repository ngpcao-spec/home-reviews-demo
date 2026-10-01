import { expect,test } from '@playwright/test'
test('V3 summary second, nine fixed sections, compact details and no generation requests',async({page})=>{
  const requests:string[]=[]
  page.on('request',request=>{if(/functions\/v1|rest\/v1/.test(request.url()))requests.push(request.url())})
  for(const language of ['fr','vi']){
    await page.goto(`/tests/e2e/fixtures/reputation.html?version=3&language=${language}`)
    await expect(page.locator('.weekly-section')).toHaveCount(9)
    await expect(page.locator('.weekly-section').nth(1)).toHaveClass(/consultant-synthesis/)
    await expect(page.locator('.consultant-axis-tile')).toHaveCount(4)
    await expect(page.locator('.consultant-total')).toContainText('501')
    await expect(page.locator('.consultant-sentiments dd')).toHaveText(['458','43'])
    await expect(page.locator('.consultant-axis-tile dd')).toHaveText(['184','19','339','48','31','42','292','16'])
    await expect(page.locator('.consultant-summary-themes').first().locator('li')).toHaveCount(5)
    await expect(page.locator('.consultant-summary-themes').first().locator('strong')).toHaveText(['106','105','104','103','102'])
    await expect(page.locator('.weekly-section').nth(6).locator('li')).toHaveCount(7)
    await expect(page.locator('.consultant-positive-details strong')).toHaveText(['100','101','102','103','104','105','106'])
    const spacing=await page.locator('.consultant-positive-details').evaluate(el=>el.querySelector('article')!.getBoundingClientRect().top-el.querySelector('.weekly-section-heading')!.getBoundingClientRect().bottom)
    expect(spacing).toBeGreaterThanOrEqual(18)
    await expect(page.locator('.weekly-section').nth(7).locator('li')).toHaveCount(7)
    await expect(page.getByText('EXPLANATION_HIDDEN')).toHaveCount(0)
    expect(await page.locator('.consultant-axis-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(2)
    await expect(page.locator('.weekly-section').last().locator('li')).toHaveCount(4)
    await expect(page.getByText('Artisan Cafe & Eatery')).toHaveCount(0)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false)
  }
  await page.locator('.consultant-synthesis').screenshot({path:`test-results/consultant-summary-${test.info().project.name}.png`})
  await page.locator('.consultant-positive-details').screenshot({path:`test-results/consultant-positive-${test.info().project.name}.png`})
  expect(requests).toHaveLength(0)
})
