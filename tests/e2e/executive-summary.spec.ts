import { expect, test } from '@playwright/test'

test('fixed executive template is readable and keyboard accessible in FR and VI', async ({page}, testInfo) => {
  const requests: string[] = []
  page.on('request', request => { if (/functions\/v1|rest\/v1/.test(request.url())) requests.push(request.url()) })
  for (const language of ['fr','vi']) {
    for (const name of ['Artisan Cafe & Eatery','Green Home Restaurant','Xóm Mới Garden']) {
      await page.goto(`/tests/e2e/fixtures/reputation.html?language=${language}&name=${encodeURIComponent(name)}`)
      await expect(page.locator('.weekly-section')).toHaveCount(9)
      expect(await page.locator('.weekly-section-heading .eyebrow').allTextContents()).toEqual(['01','02','03','04','05','06','07','08','09'])
      await expect(page.locator('.executive-positive li')).toHaveCount(4)
      await expect(page.locator('.executive-negative li')).toHaveCount(4)
      const about = page.locator('.executive-about')
      await expect(about).toHaveAttribute('aria-expanded','false')
      const detail = page.locator('.executive-block .executive-toggle')
      await detail.focus()
      await page.keyboard.press('Enter')
      await expect(detail).toHaveAttribute('aria-expanded','true')
      await page.keyboard.press('Enter')
      await expect(detail).toHaveAttribute('aria-expanded','false')
      if (name === 'Artisan Cafe & Eatery') await page.locator('.weekly-section').nth(2).screenshot({path: testInfo.outputPath(`executive-${language}.png`)})
      await about.click()
      await expect(about).toHaveAttribute('aria-expanded','true')
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
      expect(await page.locator('.executive-themes li').evaluateAll(rows => rows.every(row => {
        const label = row.querySelector('span')!.getBoundingClientRect()
        const count = row.querySelector('b')!.getBoundingClientRect()
        return label.right <= count.left && count.right <= row.getBoundingClientRect().right + 1
      }))).toBe(true)
    }
  }
  expect(requests).toHaveLength(0)
})
