import { expect,test } from '@playwright/test'
test('V3 eight fixed sections, four recommendations, no identifying header or requests',async({page})=>{
  const requests:string[]=[]
  page.on('request',request=>{if(/functions\/v1|rest\/v1/.test(request.url()))requests.push(request.url())})
  for(const language of ['fr','vi']){
    await page.goto(`/tests/e2e/fixtures/reputation.html?version=3&language=${language}`)
    await expect(page.locator('.weekly-section')).toHaveCount(8)
    await expect(page.locator('.weekly-section').last().locator('li')).toHaveCount(4)
    await expect(page.getByText('Artisan Cafe & Eatery')).toHaveCount(0)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false)
  }
  expect(requests).toHaveLength(0)
})
