import { test, expect, type Locator, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
})

async function observationGeometry(chart: Locator) {
  const points = await chart.locator('circle').evaluateAll(nodes => nodes.map(node => ({
    date: node.getAttribute('data-date'), x: Number(node.getAttribute('cx')), y: Number(node.getAttribute('cy')),
  })))
  expect(points.map(p => p.date)).toEqual(points.map(p => p.date).sort())
  const lines = await chart.locator('.statistics-line').evaluateAll(nodes => nodes.map(node => ({
    x1: Number(node.getAttribute('x1')), y1: Number(node.getAttribute('y1')),
    x2: Number(node.getAttribute('x2')), y2: Number(node.getAttribute('y2')),
  })))
  expect(lines).toHaveLength(Math.max(0, points.length - 1))
  for (let i = 0; i < lines.length; i++) {
    expect(lines[i]).toEqual({ x1: points[i].x, y1: points[i].y, x2: points[i + 1].x, y2: points[i + 1].y })
  }
  const left = Number(await chart.locator('.statistics-grid').first().getAttribute('x1'))
  const right = Number(await chart.locator('.statistics-grid').first().getAttribute('x2'))
  if (points.length > 1) {
    expect(points[0].x).toBe(left)
    expect(points.at(-1)!.x).toBe(right)
    for (let i = 1; i < points.length; i++) expect(points[i].x - points[i - 1].x).toBeCloseTo((right - left) / (points.length - 1))
  } else if (points.length === 1) expect(points[0].x).toBe((left + right) / 2)
  const tickDates = await chart.locator('.statistics-x-label').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-date')))
  for (const date of tickDates) expect(points.map(p => p.date)).toContain(date)
  expect(tickDates[0]).toBe(points[0].date)
  expect(tickDates.at(-1)).toBe(points.at(-1)!.date)
  await expect(chart.locator('.statistics-chart-gap')).toHaveCount(0)
  await expect(chart.locator('rect')).toHaveCount(0)
  return points
}

async function captureChart(page: Page, name: string) {
  const chart = page.locator('.statistics-chart')
  const panel = page.locator('.statistics-panel').filter({ has: chart })
  await panel.evaluate(node => node.scrollIntoView({ block: 'center' }))
  const boxes = await chart.locator('text').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect(); return { text: node.textContent, x: r.x, y: r.y, w: r.width, h: r.height }
  }))
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j]
    expect(a.x >= b.x + b.w || b.x >= a.x + a.w || a.y >= b.y + b.h || b.y >= a.y + a.h, JSON.stringify([a, b])).toBe(true)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const panelBox = await panel.boundingBox(), navBox = await page.locator('.bottom-nav').boundingBox()
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(navBox!.y)
  await expect(page.locator('.statistics-gap-legend')).toHaveCount(0)
  await page.screenshot({ path: `test-results/${name}.png`, scale: 'css' })
  await panel.screenshot({ path: `test-results/${name}-chart.png`, scale: 'css' })
}

for (const language of ['fr', 'vi']) for (const tablet of [false, true]) {
  const device = tablet ? 'ipad' : 'iphone'
  test(`TITO 3 months ${language} ${device}: sorted observations joined through 1.5`, async ({ page }) => {
    await page.setViewportSize(tablet ? { width: 820, height: 1180 } : { width: 390, height: 844 })
    await page.goto(`/tests/e2e/fixtures/analysis-mobile.html?tab=statistics&state=sparse-chart&language=${language}&period=3m`)
    await expect(page.locator('.statistics-restaurant')).toHaveText('TITO restaurant')
    // Allow the isolated PostgreSQL fixture to finish its first cold start.
    await expect(page.locator('.statistics-metrics button').first().locator('strong')).toHaveText('78', { timeout: 15_000 })
    await expect(page.getByRole('button', { name: language === 'fr' ? '3 mois' : '3 tháng', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.statistics-dates strong')).toHaveText(language === 'fr' ? '19 août 2026 – 19 nov. 2026' : '19/08/2026 – 19/11/2026')
    const chart = page.locator('.statistics-chart')
    await expect(chart.locator('circle')).toHaveCount(10)
    const points = await observationGeometry(chart)
    expect(points.map(p => p.date)).toEqual(['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-19', '2026-10-26', '2026-11-09'])
    expect(points.map(p => p.y)).toEqual([5, 5, 4.5, 5, 4, 4.6, 5, 2, 5, 1.5].map(mean => 166 - 138 * (mean - 1) / 4))
    expect(await chart.locator('.statistics-y-label').allTextContents()).toEqual(['1', '2', '3', '4', '5'])
    await captureChart(page, `tito-3m-${language}-${device}`)
    await page.getByText(language === 'fr' ? 'Valeurs du graphique' : 'Số liệu biểu đồ', { exact: true }).click()
    const table = page.locator('.statistics-values table')
    await expect(table.locator('tbody tr')).toHaveCount(10)
    const first = await table.locator('tbody tr').first().textContent()
    expect(first).toContain('19'); expect(first).toContain('23'); expect(first).not.toContain('17')
    expect((await table.locator('tbody td:last-child').allTextContents()).reduce((n, v) => n + Number(v), 0)).toBe(78)
    await page.locator('.statistics-help').scrollIntoViewIfNeeded()
    const help = await page.locator('.statistics-help summary').boundingBox(), nav = await page.locator('.bottom-nav').boundingBox()
    expect(help!.y + help!.height).toBeLessThanOrEqual(nav!.y)
  })

  test(`Green Home 6 months ${language} ${device}: two fives span the observation axis`, async ({ page }) => {
    await page.setViewportSize(tablet ? { width: 820, height: 1180 } : { width: 390, height: 844 })
    await page.goto(`/tests/e2e/fixtures/analysis-mobile.html?tab=statistics&state=two-point-chart&language=${language}&period=6m`)
    await expect(page.locator('.statistics-restaurant')).toHaveText('Nhà hàng Green Home')
    await expect(page.locator('.statistics-metrics button').first().locator('strong')).toHaveText('30')
    await expect(page.getByRole('button', { name: language === 'fr' ? '6 mois' : '6 tháng', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.statistics-dates strong')).toHaveText(language === 'fr' ? '19 mai 2026 – 19 nov. 2026' : '19/05/2026 – 19/11/2026')
    const chart = page.locator('.statistics-chart')
    await expect(chart.locator('circle')).toHaveCount(2)
    expect(await observationGeometry(chart)).toEqual([{ date: '2026-10-01', x: 44, y: 28 }, { date: '2026-11-01', x: 340, y: 28 }])
    await captureChart(page, `green-home-6m-${language}-${device}`)
  })
}

for (const language of ['fr', 'vi']) test(`zero and one observation ${language}: no invented value or line`, async ({ page }) => {
  await page.goto(`/tests/e2e/fixtures/analysis-mobile.html?tab=statistics&state=one-point-chart&language=${language}`)
  const chart = page.locator('.statistics-chart')
  await expect(chart.locator('circle')).toHaveCount(1)
  const points = await observationGeometry(chart)
  expect(points[0].date).toBe('2026-11-09')
  expect(points[0].y).toBe(166 - 138 * 0.5 / 4)
  await page.goto(`/tests/e2e/fixtures/analysis-mobile.html?tab=statistics&state=zero-point-chart&language=${language}`)
  const empty = language === 'fr' ? 'Aucun avis sur cette période' : 'Không có đánh giá trong khoảng thời gian này'
  await expect(page.getByText(empty, { exact: true })).toBeVisible()
  await expect(page.locator('.statistics-chart')).toHaveCount(0)
})
