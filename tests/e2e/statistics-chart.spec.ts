import {test, expect} from '@playwright/test'
test.beforeEach(async({page})=>{await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort())})

for(const language of ['fr','vi'])for(const tablet of [false,true])test(`sparse chart ${language} ${tablet?'iPad':'iPhone'}`,async({page})=>{
 if(tablet)await page.setViewportSize({width:820,height:1180})
 await page.goto(`/tests/e2e/fixtures/analysis-mobile.html?tab=statistics&state=sparse-chart&language=${language}`)
 await expect(page.locator('.statistics-metrics button').first().locator('strong')).toHaveText('78')
 const chart=page.locator('.statistics-chart')
 await expect(chart.locator('circle')).toHaveCount(10) // ten actual observations, no zero placeholders
 await expect(chart.locator('.statistics-line')).toHaveCount(7) // no connection over empty weeks
 await expect(chart.locator('.statistics-chart-gap')).toHaveCount(3) // including the last empty week
 await expect(page.locator('.statistics-gap-legend')).toHaveText(language==='fr'?'Zones grisées : aucun avis conservé.':'Vùng tô xám: không có đánh giá được lưu.')
 expect(await chart.locator('.statistics-y-label').allTextContents()).toEqual(['1','2','3','4','5'])
 expect(await chart.locator('.statistics-x-label').first().getAttribute('data-date')).toBe('2026-08-19')
 expect(await chart.locator('.statistics-x-label').last().getAttribute('data-date')).toBe('2026-11-19')
 const panel=page.locator('.statistics-panel').filter({has:chart})
 await panel.evaluate(node=>node.scrollIntoView({block:'center'}))
 const boxes=await chart.locator('text').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {text:n.textContent,x:r.x,y:r.y,w:r.width,h:r.height}}))
 for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
  const a=boxes[i],b=boxes[j]
  expect(a.x>=b.x+b.w||b.x>=a.x+a.w||a.y>=b.y+b.h||b.y>=a.y+a.h,JSON.stringify([a,b])).toBe(true)
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 const panelBox=await panel.boundingBox(),navBox=await page.locator('.bottom-nav').boundingBox()
 expect(panelBox!.y+panelBox!.height).toBeLessThanOrEqual(navBox!.y)
 await page.screenshot({path:`test-results/chart-fixed-${language}-${tablet?'ipad':'iphone'}.png`,scale:'css'})
 await page.getByText(language==='fr'?'Valeurs du graphique':'Số liệu biểu đồ',{exact:true}).click()
 const table=page.locator('.statistics-values table')
 await expect(table.locator('tbody tr')).toHaveCount(10)
 const first=await table.locator('tbody tr').first().textContent()
 expect(first).toContain('19');expect(first).toContain('23');expect(first).not.toContain('17')
 expect((await table.locator('tbody td:last-child').allTextContents()).reduce((n,v)=>n+Number(v),0)).toBe(78)
 await page.locator('.statistics-help').scrollIntoViewIfNeeded()
 const help=await page.locator('.statistics-help summary').boundingBox(),nav=await page.locator('.bottom-nav').boundingBox()
 expect(help!.y+help!.height).toBeLessThanOrEqual(nav!.y)
})
