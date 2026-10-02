import { expect,test } from '@playwright/test'
import type { resumeHarness } from './fixtures/resume-supabase'
import type { readAppCache,purgeAppCache } from '../../src/lib/app-cache'
declare global {interface Window {resumeHarness:typeof resumeHarness;readAppCache:typeof readAppCache;purgeAppCache:typeof purgeAppCache}}
const url='/tests/e2e/fixtures/resume.html'
const report='/analyses?establishment=place-account-a&mode=historical'
test.beforeEach(async({page})=>{
  await page.route(/https:\/\/.*/,route=>route.abort()) // No production/provider/AI requests, ever.
})
test('cached cold boot restores report, selection and scroll while offline reads fail; deep-link wins',async({page})=>{
  await page.goto(`${url}#${report}`)
  await expect(page.getByText('Cached historical summary').first()).toBeVisible()
  await page.evaluate(()=>scrollTo(0,650))
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(500)
  await expect.poll(()=>page.evaluate(async()=>Boolean((await window.readAppCache('account-a'))?.analytics))).toBe(true)
  await page.waitForTimeout(200)
  await page.evaluate(()=>localStorage.setItem('resume-offline','true'))
  await page.goto('about:blank') // Destroy the document/React tree, not just its hash.
  await page.goto(`${url}#/`)
  await expect(page).toHaveURL(new RegExp('establishment=place-account-a&mode=historical'))
  await expect(page.getByText('Cached historical summary').first()).toBeAttached()
  await expect(page.locator('.route-loading')).toHaveCount(0)
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(500)
  expect(await page.evaluate(()=>window.resumeHarness.invocations.filter(name=>name!=='get-historical-report-status'))).toEqual([])
  await page.goto('about:blank')
  await page.goto(`${url}#/etablissements/place-account-a`)
  await expect(page).toHaveURL(/#\/etablissements\/place-account-a$/)
  await expect(page.getByText('Artisan Cafe & Eatery').first()).toBeVisible()
  await expect(page.locator('.route-loading')).toHaveCount(0)
})
test('foreground events are single-flight/cooldown, token refresh does not reset UI, online revalidates',async({page,context})=>{
  await page.goto(`${url}#${report}`)
  await expect(page.getByText('Cached historical summary').first()).toBeVisible()
  const initial=await page.evaluate(()=>window.resumeHarness.queries.filter(t=>t==='establishments').length)
  await page.evaluate(()=>{
    window.resumeHarness.emit('TOKEN_REFRESHED')
    dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(200)
  expect(await page.evaluate(()=>window.resumeHarness.queries.filter(t=>t==='establishments').length)).toBe(initial)
  await page.clock.install()
  await page.clock.fastForward(31_000)
  await page.evaluate(()=>{window.resumeHarness.delay=2000;dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));dispatchEvent(new Event('focus'))})
  await expect(page.locator('.route-loading')).toHaveCount(0)
  await expect(page.getByText('Cached historical summary').first()).toBeAttached()
  await page.clock.fastForward(2500)
  expect(await page.evaluate(()=>window.resumeHarness.queries.filter(t=>t==='establishments').length)).toBe(initial+1)
  await context.setOffline(true)
  await page.evaluate(()=>dispatchEvent(new Event('offline')))
  await expect(page.locator('.offline-banner')).toBeVisible()
  await page.clock.fastForward(180_000)
  await page.evaluate(()=>dispatchEvent(new Event('focus')))
  await page.clock.fastForward(2500)
  await expect(page.getByText('Cached historical summary').first()).toBeAttached()
  await expect(page.locator('.route-loading')).toHaveCount(0)
  await context.setOffline(false)
  await page.clock.fastForward(2500)
  await expect(page.locator('.offline-banner')).toHaveCount(0)
  expect(await page.evaluate(()=>window.resumeHarness.invocations.filter(name=>name!=='get-historical-report-status'))).toEqual([])
})
test('account switch purges persisted account data and ignores stale in-flight responses',async({page})=>{
  await page.goto(`${url}#/etablissements`)
  await expect(page.getByText('Artisan Cafe & Eatery')).toBeVisible()
  await expect.poll(()=>page.evaluate(async()=>Boolean(await window.readAppCache('account-a')))).toBe(true)
  const before=await page.evaluate(()=>window.resumeHarness.queries.filter(t=>t==='establishments').length)
  await page.evaluate(()=>{window.resumeHarness.delay=1200;dispatchEvent(new Event('online'))})
  await expect.poll(()=>page.evaluate(()=>window.resumeHarness.queries.filter(t=>t==='establishments').length)).toBeGreaterThan(before)
  await page.evaluate(()=>{window.resumeHarness.emit('SIGNED_OUT');window.resumeHarness.emit('SIGNED_IN','account-b')})
  await expect(page.getByText('Artisan Cafe & Eatery')).toHaveCount(0)
  await expect(page.getByText('Other account restaurant')).toBeVisible()
  await expect(page.getByText('Artisan Cafe & Eatery')).toHaveCount(0)
  expect(await page.evaluate(()=>window.readAppCache('account-a'))).toBeUndefined()
  expect(await page.evaluate(()=>localStorage.getItem('home-reviews:last-route'))).not.toContain('account-a')
})

test('historical run survives leaving the route then resumes with the same generation and no force',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('resume-run',JSON.stringify({establishment_id:'place-account-a',preferred_language:'vi',generation_id:'khouse-existing',status:'running',progress:3,total_steps:5,resumable:true,error_code:null})))
  await page.goto(`${url}#${report}`)
  await expect(page.getByRole('button',{name:'Đang phân tích'})).toBeVisible()
  await expect.poll(()=>page.evaluate(()=>window.resumeHarness.stepCalls.length)).toBe(1)
  await page.evaluate(()=>{location.hash='/etablissements'})
  await expect(page.getByText('Artisan Cafe & Eatery').first()).toBeVisible()
  await page.waitForTimeout(2200)
  expect(await page.evaluate(()=>window.resumeHarness.stepCalls.length)).toBe(1)
  expect(await page.evaluate(()=>window.resumeHarness.run?.progress)).toBe(4)
  await page.evaluate(()=>{location.hash='/analyses'})
  await expect.poll(()=>page.evaluate(()=>window.resumeHarness.run?.status)).toBe('completed')
  await expect(page.getByText('Không thể tạo báo cáo. Vui lòng thử lại.')).toHaveCount(0)
  expect(await page.evaluate(()=>window.resumeHarness.stepCalls)).toEqual([
    {establishment_id:'place-account-a',preferred_language:'vi',generation_id:'khouse-existing'},
    {establishment_id:'place-account-a',preferred_language:'vi',generation_id:'khouse-existing'},
  ])
})

test('hidden page pauses steps, double foreground resumes once without a red error',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('resume-run',JSON.stringify({establishment_id:'place-account-a',preferred_language:'vi',generation_id:'khouse-existing',status:'running',progress:3,total_steps:5,resumable:true,error_code:null})))
  await page.goto(`${url}#${report}`)
  await expect.poll(()=>page.evaluate(()=>window.resumeHarness.stepCalls.length)).toBe(1)
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))})
  await page.waitForTimeout(2300)
  expect(await page.evaluate(()=>window.resumeHarness.stepCalls.length)).toBe(1)
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));dispatchEvent(new Event('focus'));dispatchEvent(new Event('focus'))})
  await expect.poll(()=>page.evaluate(()=>window.resumeHarness.run?.status)).toBe('completed')
  expect(await page.evaluate(()=>window.resumeHarness.stepCalls.length)).toBe(2)
  await expect(page.locator('.historical-feedback.error')).toHaveCount(0)
})

test('lost response remains neutral; completion elsewhere is read without a new AI call',async({page})=>{
  await page.goto(`${url}#${report}`)
  await expect(page.getByText('Cached historical summary').first()).toBeVisible()
  await page.evaluate(()=>{
    window.resumeHarness.loseResponse=true
    window.resumeHarness.run={establishment_id:'place-account-a',preferred_language:'vi',generation_id:'khouse-existing',status:'running',progress:3,total_steps:5,resumable:true,error_code:null}
  })
  await page.waitForTimeout(1100)
  await page.evaluate(()=>dispatchEvent(new Event('focus')))
  await expect.poll(()=>page.evaluate(()=>window.resumeHarness.run?.progress)).toBe(4)
  await expect(page.locator('.historical-feedback.error')).toHaveCount(0)
  await page.evaluate(()=>{const run=window.resumeHarness.run!;window.resumeHarness.run={...run,status:'completed',resumable:false}})
  await page.waitForTimeout(1100)
  await page.evaluate(()=>dispatchEvent(new Event('focus')))
  await expect(page.getByRole('button',{name:'Tạo lại phân tích'})).toBeEnabled()
  expect(await page.evaluate(()=>window.resumeHarness.stepCalls.length)).toBe(1)
})

test('confirmed failed backend run alone displays generation failure',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('resume-run',JSON.stringify({establishment_id:'place-account-a',preferred_language:'vi',generation_id:'khouse-existing',status:'failed',progress:3,total_steps:5,resumable:false,error_code:'REPORT_FAILED'})))
  await page.goto(`${url}#${report}`)
  await expect(page.getByText('Không thể tạo báo cáo. Vui lòng thử lại.')).toBeVisible()
  expect(await page.evaluate(()=>window.resumeHarness.stepCalls.length)).toBe(0)
})
