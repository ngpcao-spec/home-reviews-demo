import { test, expect, type Locator, type Page } from '@playwright/test'
import type { Statistics } from '../../src/lib/restaurant-statistics'

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
})

const scenarios = [
  { name:'stable-volume', state:'stable-volume-chart', period:'6m', total:116, size:6, barPick:3, pointPick:0,
    barPeriod:['2026-09-01','2026-09-30'], pointPeriod:['2026-06-01','2026-06-30'] },
  { name:'sparse-weeks', state:'sparse-chart', period:'3m', total:78, size:10, barPick:1, pointPick:9,
    barPeriod:['2026-08-24','2026-08-30'], pointPeriod:['2026-11-09','2026-11-15'] },
  { name:'single-period', state:'one-point-chart', period:'3m', total:3, size:1, barPick:0, pointPick:0,
    barPeriod:['2026-11-09','2026-11-15'], pointPeriod:['2026-11-09','2026-11-15'] },
]

async function openChart(page: Page, state: string, language: string, period: string) {
  const response = page.waitForResponse(r => r.url().endsWith('/__statistics') && r.request().postDataJSON().name === 'read_restaurant_statistics')
  await page.goto(`/tests/e2e/fixtures/analysis-mobile.html?tab=statistics&state=${state}&language=${language}&period=${period}`)
  const data: Statistics = (await (await response).json()).data
  await expect(page.locator('.statistics-metrics')).toBeVisible({ timeout:15_000 })
  return data
}

async function combinedGeometry(page: Page, data: Statistics, language: string) {
  const chart = page.locator('.statistics-chart')
  const rows = [...data.series].filter(row => row.count > 0).sort((a,b)=>a.date.localeCompare(b.date))
  const points = await chart.locator('.statistics-rating-point').evaluateAll(nodes => nodes.map(node=>({
    date:node.getAttribute('data-date'), x:Number(node.getAttribute('cx')), y:Number(node.getAttribute('cy')),
  })))
  const bars = await chart.locator('.statistics-volume-bar').evaluateAll(nodes => nodes.map(node=>({
    date:node.getAttribute('data-date'), count:Number(node.getAttribute('data-count')), x:Number(node.getAttribute('x')),
    y:Number(node.getAttribute('y')), width:Number(node.getAttribute('width')), height:Number(node.getAttribute('height')),
  })))
  expect(points).toHaveLength(rows.length)
  expect(bars).toHaveLength(rows.length)
  expect(bars.reduce((sum,bar)=>sum+bar.count,0)).toBe(data.metrics.count)
  expect(Number((await page.locator('.statistics-metrics button').first().locator('strong').innerText()).replace(/\D/g,''))).toBe(data.metrics.count)
  const distributionTotal = (await page.locator('.statistics-distribution button strong').allTextContents()).reduce((sum,value)=>sum+Number(value.replace(/\D/g,'')),0)
  expect(distributionTotal).toBe(data.metrics.count)

  const bottom = Number(await chart.locator('.statistics-grid').first().getAttribute('y1'))
  const top = Number(await chart.locator('.statistics-grid').last().getAttribute('y1'))
  const left = Number(await chart.locator('.statistics-grid').first().getAttribute('x1'))
  const right = Number(await chart.locator('.statistics-grid').first().getAttribute('x2'))
  const countTicks = await chart.locator('.statistics-count-label').evaluateAll(nodes=>nodes.map(node=>Number(node.getAttribute('data-count'))))
  expect(countTicks[0]).toBe(0)
  expect(countTicks.every(Number.isInteger)).toBe(true)
  expect(new Set(countTicks).size).toBe(countTicks.length)
  const ceiling = countTicks.at(-1)!
  const maximum = Math.max(...rows.map(row=>row.count))
  expect(ceiling).toBeGreaterThanOrEqual(maximum)
  expect(ceiling).toBeLessThanOrEqual(maximum*2)
  expect(await chart.locator('.statistics-count-label').allTextContents()).toEqual(countTicks.map(n=>n.toLocaleString(language==='fr'?'fr-FR':'vi-VN')))
  expect(await chart.locator('.statistics-y-label').allTextContents()).toEqual(['1 ★','2 ★','3 ★','4 ★','5 ★'])

  for (let i=0;i<rows.length;i++) {
    expect(points[i].date).toBe(rows[i].date)
    expect(bars[i].date).toBe(rows[i].date)
    expect(bars[i].count).toBe(rows[i].count)
    expect(bars[i].x+bars[i].width/2).toBeCloseTo(points[i].x,8)
    expect(points[i].y).toBeCloseTo(bottom-(bottom-top)*(rows[i].average-1)/4,8)
    expect(bars[i].height).toBeCloseTo((bottom-top)*rows[i].count/ceiling,8)
    expect(bars[i].y+bars[i].height).toBeCloseTo(bottom,8)
    expect(bars[i].width).toBeGreaterThan(0)
  }
  if (points.length>1) {
    expect(bars[0].x).toBeCloseTo(left,8)
    expect(bars.at(-1)!.x+bars.at(-1)!.width).toBeCloseTo(right,8)
    for(let i=1;i<points.length;i++) expect(points[i].x-points[i-1].x).toBeCloseTo((points.at(-1)!.x-points[0].x)/(points.length-1),8)
    await expect(chart.locator('polyline.statistics-line')).toHaveCount(1)
    const vertices = (await chart.locator('.statistics-line').getAttribute('points'))!.split(' ').map(value=>value.split(',').map(Number))
    expect(vertices).toEqual(points.map(point=>[point.x,point.y]))
    expect(await chart.locator('.statistics-volume-bars').evaluate(el=>Boolean(el.compareDocumentPosition(el.parentElement!.querySelector('.statistics-line')!)&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true)
  } else {
    expect(points[0].x).toBe((left+right)/2)
    await expect(chart.locator('.statistics-line')).toHaveCount(0)
  }
  const tickDates = await chart.locator('.statistics-x-label').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-date')))
  for (const value of tickDates) expect(rows.map(row=>row.date)).toContain(value)
  expect(tickDates[0]).toBe(rows[0].date)
  expect(tickDates.at(-1)).toBe(rows.at(-1)!.date)
  await expect(chart.locator('.statistics-chart-gap')).toHaveCount(0)
  await expect(page.locator('.statistics-gap-legend')).toHaveCount(0)
  return {rows,bottom,top}
}

async function capture(page: Page, name: string) {
  const panel=page.locator('.statistics-combined-panel'), chart=page.locator('.statistics-chart')
  await panel.evaluate(node=>node.scrollIntoView({block:'center'}))
  const boxes = await chart.locator('text').evaluateAll(nodes=>nodes.map(node=>{
    const r=node.getBoundingClientRect();return {text:node.textContent,x:r.x,y:r.y,w:r.width,h:r.height}
  }))
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const a=boxes[i],b=boxes[j]
    expect(a.x>=b.x+b.w||b.x>=a.x+a.w||a.y>=b.y+b.h||b.y>=a.y+a.h,JSON.stringify([a,b])).toBe(true)
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  const box=await panel.boundingBox(),nav=await page.locator('.bottom-nav').boundingBox()
  expect(box!.y+box!.height).toBeLessThanOrEqual(nav!.y)
  await page.screenshot({path:`test-results/combined-${name}.png`,scale:'css'})
  await panel.screenshot({path:`test-results/combined-${name}-chart.png`,scale:'css'})
}

async function tap(page: Page, target: Locator) {
  await page.locator('.statistics-combined-panel').evaluate(node=>node.scrollIntoView({block:'center'}))
  const box=await target.boundingBox()
  await page.touchscreen.tap(box!.x+box!.width/2,box!.y+box!.height/2)
}

async function selection(page: Page, row: Statistics['series'][number], period: string[], language: string) {
  const locale=language==='fr'?'fr-FR':'vi-VN'
  const date=(s:string)=>new Date(s+'T00:00:00Z').toLocaleDateString(locale,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'})
  const detail=page.locator('.statistics-chart-selection [role=status]')
  await expect(detail.locator('strong')).toHaveText(period.map(date).join(' – '))
  await expect(detail).toContainText(`${row.count.toLocaleString(locale)} ${language==='fr'?'avis':'đánh giá'}`)
  await expect(detail).toContainText(row.average.toLocaleString(locale,{minimumFractionDigits:1,maximumFractionDigits:1})+' / 5')
}

for(const language of ['fr','vi'])for(const scenario of scenarios)test(`combined ${scenario.name} ${language} iPhone: paired counts, true means and touch`,async({page})=>{
  await page.setViewportSize({width:390,height:844})
  let requests=0
  page.on('request',r=>{if(r.url().endsWith('/__statistics'))requests++})
  const data=await openChart(page,scenario.state,language,scenario.period)
  expect(data.metrics.count).toBe(scenario.total)
  await expect(page.locator('.statistics-combined-panel h2')).toHaveText(language==='fr'?'Note moyenne et nombre d’avis':'Điểm trung bình và số đánh giá')
  await expect(page.locator('.statistics-chart-legend>span')).toHaveCount(2)
  const {rows,top,bottom}=await combinedGeometry(page,data,language)
  expect(rows).toHaveLength(scenario.size)
  if(scenario.name==='stable-volume')expect(new Set(rows.map(row=>row.average)).size).toBe(1)
  if(scenario.name==='sparse-weeks'){
    expect(rows.at(-1)!.average).toBe(1.5)
    expect(rows.map(row=>row.date)).not.toContain('2026-10-05')
  }
  if(scenario.name==='single-period'){
    const plotted=Number(await page.locator('.statistics-rating-point').getAttribute('cy'))
    expect(plotted).not.toBeCloseTo(bottom-(bottom-top)*(3.3-1)/4,4)
  }
  const distribution=await page.locator('.statistics-distribution').innerHTML()
  await capture(page,`${scenario.name}-${language}-iphone`)
  const requestCount=requests
  await tap(page,page.locator('.statistics-volume-bar').nth(scenario.barPick))
  await selection(page,rows[scenario.barPick],scenario.barPeriod,language)
  await page.getByRole('button',{name:language==='fr'?'Fermer le détail':'Đóng chi tiết',exact:true}).tap()
  await expect(page.locator('.statistics-chart-selection')).toHaveCount(0)
  await tap(page,page.locator('.statistics-rating-point').nth(scenario.pointPick))
  await selection(page,rows[scenario.pointPick],scenario.pointPeriod,language)
  await capture(page,`${scenario.name}-${language}-iphone-touch`)
  expect(await page.locator('.statistics-distribution').innerHTML()).toBe(distribution)
  expect(requests).toBe(requestCount) // inspecting a period is entirely local
  await page.getByText(language==='fr'?'Valeurs du graphique':'Số liệu biểu đồ',{exact:true}).click()
  const table=page.locator('.statistics-values table')
  await expect(table.locator('tbody tr')).toHaveCount(rows.length)
  expect((await table.locator('tbody td:last-child').allTextContents()).reduce((sum,value)=>sum+Number(value.replace(/\D/g,'')),0)).toBe(scenario.total)
})

for(const language of ['fr','vi'])test(`combined empty and keyboard access ${language}`,async({page})=>{
  await openChart(page,'one-point-chart',language,'3m')
  const button=page.locator('.statistics-observation')
  await button.focus()
  await expect(page.locator('.statistics-chart-selection')).toBeVisible()
  await button.press('Escape')
  await expect(page.locator('.statistics-chart-selection')).toHaveCount(0)
  await button.press('Enter')
  await expect(page.locator('.statistics-chart-selection')).toBeVisible()
  await openChart(page,'zero-point-chart',language,'3m')
  await expect(page.locator('.statistics-chart')).toHaveCount(0)
  await expect(page.locator('.statistics-chart-selection')).toHaveCount(0)
  await expect(page.getByText(language==='fr'?'Aucun avis sur cette période':'Không có đánh giá trong khoảng thời gian này',{exact:true})).toBeVisible()
})

for(const language of ['fr','vi'])test(`combined chart ${language} iPad`,async({page})=>{
  await page.setViewportSize({width:820,height:1180})
  const data=await openChart(page,'stable-volume-chart',language,'6m')
  await combinedGeometry(page,data,language)
  await capture(page,`stable-volume-${language}-ipad`)
})

test('real isolated RPC totals remain consistent for 3 months and all retained history',async({page})=>{
  const data=await openChart(page,'fresh','fr','3m')
  await combinedGeometry(page,data,'fr')
  const next=page.waitForResponse(r=>r.url().endsWith('/__statistics'))
  await page.getByRole('button',{name:'Tout',exact:true}).click()
  const all: Statistics=(await (await next).json()).data
  await expect(page.locator('.statistics-metrics button').first()).toContainText('1 205')
  await combinedGeometry(page,all,'fr')
})
