import {test,expect} from '@playwright/test'
for(const language of ['fr','vi'])for(const state of ['none','fresh','new','running','failed'])test(`${language} ${state}`,async({page})=>{
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort())
 await page.goto(`/tests/e2e/fixtures/analysis-mobile.html?language=${language}&state=${state}`)
 await expect(page.getByRole('heading',{name:language==='fr'?'Analyse des avis':'Phân tích đánh giá'})).toBeVisible()
 await expect(page.locator('#weekly-establishment')).toHaveCount(0)
 if(state!=='none'){
  const summary=page.locator('.report-summary');await expect(summary).toBeVisible()
  expect((await summary.boundingBox())!.y).toBeLessThan(600)
  await expect(page.getByRole('button',{name:state==='failed'?(language==='fr'?'Réessayer':'Thử lại'):state==='running'?(language==='fr'?'Analyse en cours':'Đang phân tích'):(language==='fr'?'Mettre à jour le rapport':'Cập nhật báo cáo')})).toBeVisible()
 }else await expect(page.getByRole('button',{name:language==='fr'?'Créer un rapport':'Tạo báo cáo'})).toBeVisible()
 await expect(page.locator('.report-details').first()).not.toHaveAttribute('open','')
 await page.addStyleTag({content:'* { scroll-behavior: auto !important; }'})
 await page.evaluate(()=>{document.querySelectorAll('*').forEach(e=>{e.scrollTop=0});window.scrollTo({top:0,behavior:'instant'})})
 await expect(page.locator('.brand-header')).toBeInViewport()
 await page.screenshot({path:`test-results/analysis-${language}-${state}.png`})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy()
 await page.locator('.analysis-report-first > details').last().scrollIntoViewIfNeeded()
 const end=await page.locator('.analysis-report-first > details').last().boundingBox(),nav=await page.locator('.bottom-nav').boundingBox()
 expect(end!.y+end!.height).toBeLessThanOrEqual(nav!.y)

})
