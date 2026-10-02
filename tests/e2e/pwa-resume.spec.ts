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

test('server completes while the app is closed; reopening only reads status',async({page,context})=>{
  let run={establishment_id:'place-account-a',preferred_language:'vi',generation_id:'khouse-existing',status:'running',progress:3,total_steps:5,resumable:false,error_code:null as string|null}
  await context.route('**/__test/historical-status',route=>route.fulfill({json:{run}}))
  await page.addInitScript(()=>localStorage.setItem('server-owned-report-test','true'))
  await page.goto(`${url}#${report}`)
  await expect(page.getByRole('button',{name:'Đang phân tích'})).toBeDisabled()
  expect(await page.evaluate(()=>window.resumeHarness.stepCalls.length)).toBe(0)
  await page.close()
  // The mocked server evolves outside any browser document, like worker checkpoints.
  run={...run,status:'completed',progress:5}
  const reopened=await context.newPage()
  await reopened.goto(`${url}#/`)
  await expect(reopened.getByRole('button',{name:'Tạo lại phân tích'})).toBeEnabled()
  await expect(reopened.getByText('Cached historical summary').first()).toBeVisible()
  expect(await reopened.evaluate(()=>window.resumeHarness.invocations.filter(n=>n==='generate-historical-report'))).toEqual([])
})

test('changing route and backgrounding never steps the run; foreground observes server progress',async({page,context})=>{
  let run={establishment_id:'place-account-a',preferred_language:'vi',generation_id:'khouse-existing',status:'running',progress:3,total_steps:5,resumable:false,error_code:null}
  let reads=0
  await context.route('**/__test/historical-status',route=>{reads++;return route.fulfill({json:{run}})})
  await page.addInitScript(()=>localStorage.setItem('server-owned-report-test','true'))
  await page.goto(`${url}#${report}`)
  await expect(page.getByRole('button',{name:'Đang phân tích'})).toBeDisabled()
  await page.evaluate(()=>{location.hash='/etablissements'})
  await expect(page.getByRole('button',{name:'Đang phân tích'})).toHaveCount(0)
  run={...run,progress:4}
  await page.evaluate(()=>{location.hash='/analyses'})
  await expect(page.getByText('Phân tích theo nhóm: 4 / 5')).toBeVisible()
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))})
  await page.waitForTimeout(100)
  const before=reads
  await page.waitForTimeout(5200)
  expect(reads).toBe(before)
  run={...run,status:'completed',progress:5}
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));dispatchEvent(new Event('focus'));dispatchEvent(new Event('focus'))})
  await expect(page.getByRole('button',{name:'Tạo lại phân tích'})).toBeEnabled()
  expect(reads).toBe(before+1)
  await expect(page.locator('.historical-feedback.error')).toHaveCount(0)
  expect(await page.evaluate(()=>window.resumeHarness.stepCalls.length)).toBe(0)
})

test('retry server status remains neutral and does not start client generation',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('resume-run',JSON.stringify({establishment_id:'place-account-a',preferred_language:'vi',generation_id:'khouse-existing',status:'retry',progress:3,total_steps:5,resumable:false,error_code:'OPENAI_HTTP_429'})))
  await page.goto(`${url}#${report}`)
  await expect(page.getByRole('button',{name:'Đang phân tích'})).toBeDisabled()
  await expect(page.locator('.historical-feedback.error')).toHaveCount(0)
  expect(await page.evaluate(()=>window.resumeHarness.stepCalls.length)).toBe(0)
})

test('confirmed failed backend run alone displays generation failure',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('resume-run',JSON.stringify({establishment_id:'place-account-a',preferred_language:'vi',generation_id:'khouse-existing',status:'failed',progress:3,total_steps:5,resumable:false,error_code:'REPORT_FAILED'})))
  await page.goto(`${url}#${report}`)
  await expect(page.getByText('Không thể tạo báo cáo. Vui lòng thử lại.')).toBeVisible()
  expect(await page.evaluate(()=>window.resumeHarness.stepCalls.length)).toBe(0)
})
