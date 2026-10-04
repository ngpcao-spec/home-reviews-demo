import {expect,test} from '@playwright/test'
import {readFileSync} from 'node:fs'

// Optional local-only production fixture; never commit customer review contents.
const fixture=process.env.NOTIFICATION_REVIEW_FIXTURE?JSON.parse(readFileSync(process.env.NOTIFICATION_REVIEW_FIXTURE,'utf8')):{
  name:'Restaurant de test',review:{id:'notification-review',original_text:'服务很慢',text:'服务很慢',published_at:'2026-10-03T15:31:53.227Z',
    review_translations:[{language:'vi',translated_text:'Phục vụ rất chậm'}]},
  notifications:[{id:'notice-test',review_id:'notification-review',establishment_id:'place-account-a',type:'new_negative_review',body:'服务很慢',severity:'high',created_at:'2026-10-03T20:21:07.157Z'}],
}
test('notification and review list show identical localized text and Google age',async({page},testInfo)=>{
  await page.route(/https:\/\/.*/,route=>route.abort())
  await page.clock.install({time:new Date('2026-10-03T23:00:00Z')})
  await page.addInitScript(value=>{
    localStorage.setItem('notification-review-fixture',JSON.stringify(value))
    localStorage.setItem('review-details-language','vi')
  },fixture)
  await page.goto('/tests/e2e/fixtures/resume.html#/notifications')
  const translated=fixture.review.review_translations[0].translated_text
  await expect(page.locator('.notification-item p')).toHaveText(translated)
  await expect(page.locator('.notification-meta')).toContainText('2★ · 7 giờ trước')
  await expect(page.locator('.notification-item')).toContainText(fixture.name)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:testInfo.outputPath('notifications.png'),fullPage:true})
  await page.goto('/tests/e2e/fixtures/resume.html#/avis')
  await expect(page.locator('.review-row p').first()).toHaveText(translated)
  await expect(page.locator('.review-meta').first()).toContainText('7 giờ trước')
  await page.screenshot({path:testInfo.outputPath('reviews.png'),fullPage:true})
  expect(await page.evaluate(()=> (window as unknown as {resumeHarness:{invocations:string[]}}).resumeHarness.invocations)).toEqual([])
})
