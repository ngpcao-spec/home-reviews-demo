import { expect,test } from '@playwright/test'
test('V3 summary second, nine fixed sections, compact details and no generation requests',async({page})=>{
  const requests:string[]=[]
  page.on('request',request=>{if(/functions\/v1|rest\/v1/.test(request.url()))requests.push(request.url())})
  for(const language of ['fr','vi']){
    await page.goto(`/tests/e2e/fixtures/reputation.html?version=3&language=${language}`)
    await expect(page.locator('.weekly-section')).toHaveCount(9)
    await expect(page.locator('.weekly-section').nth(1)).toHaveClass(/consultant-synthesis/)
    await expect(page.locator('.consultant-axis-tile')).toHaveCount(4)
    await expect(page.locator('.consultant-axis-section')).toHaveCount(4)
    for(const section of await page.locator('.consultant-axis-section').all()){
      await expect(section.locator('dt')).toHaveText(language==='vi'?['Đánh giá tích cực','Đánh giá tiêu cực']:['Avis positifs','Avis négatifs'])
      const paragraph=section.locator('.consultant-axis-prose')
      // Exercise long Vietnamese/French prose with the same production layout.
      await paragraph.evaluate((el,lang)=>{el.textContent=lang==='vi'
        ? 'Khách hàng đánh giá cao sự thân thiện và thái độ chu đáo của nhân viên trong suốt bữa ăn. Một số ý kiến đề cập đến thời gian chờ đợi khi nhà hàng đông khách, cũng như việc các món ăn được phục vụ vào những thời điểm khác nhau. Những nhận xét này phản ánh trải nghiệm của các khách hàng đã để lại đánh giá.'
        : 'Les clients apprécient la disponibilité et l’accueil du personnel pendant le repas. Certains commentaires mentionnent toutefois une attente importante lors des périodes de forte fréquentation et des plats servis à des moments différents. Ces constats reflètent les expériences décrites dans les avis disponibles.'},language)
      expect(await paragraph.evaluate(el=>{
        const box=el.getBoundingClientRect(),parent=el.parentElement!,style=getComputedStyle(parent)
        const width=parent.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)
        return Math.abs(box.width-width)<1 && el.scrollWidth<=el.clientWidth && getComputedStyle(el).textAlign==='justify'
      })).toBe(true)
    }
    await expect(page.locator('.consultant-total')).toContainText('501')
    await expect(page.locator('.consultant-sentiments dd')).toHaveText(['458','43'])
    await expect(page.locator('.consultant-axis-tile dd')).toHaveText(['184','19','339','48','31','42','292','16'])
    await expect(page.locator('.consultant-summary-themes').first().locator('li')).toHaveCount(5)
    await expect(page.locator('.consultant-summary-themes').first().locator('strong')).toHaveText(['106','105','104','103','102'])
    await expect(page.locator('.weekly-section').nth(6).locator('li')).toHaveCount(7)
    await expect(page.locator('.consultant-positive-details strong')).toHaveText(['100','101','102','103','104','105','106'])
    await expect(page.locator('article > .consultant-section-banner')).toHaveCount(9)
    expect(await page.locator('.consultant-section-banner').evaluateAll(headers=>headers.every(header=>getComputedStyle(header).backgroundImage.includes('linear-gradient')))).toBe(true)
    expect(await page.locator('.weekly-section').evaluateAll(sections=>sections.slice(1).every((section,i)=>Math.abs(section.getBoundingClientRect().top-sections[i].getBoundingClientRect().bottom-16)<1))).toBe(true)
    for(const index of [2,3,4,6]){
      const dimensions=await page.locator('.weekly-section').nth(index).locator('header').evaluate(header=>{
        const badge=header.querySelector('.eyebrow')!.getBoundingClientRect()
        return {height:header.getBoundingClientRect().height,badgeWidth:badge.width,badgeHeight:badge.height,radius:getComputedStyle(header).borderTopLeftRadius}
      })
      expect(dimensions.height).toBeGreaterThanOrEqual(52)
      expect(dimensions.height).toBeLessThanOrEqual(56)
      expect(dimensions).toMatchObject({badgeWidth:38,badgeHeight:34,radius:'0px'})
    }
    expect(await page.locator('.consultant-section-card').evaluateAll(cards=>cards.every(card=>{
      const bounds=card.getBoundingClientRect(),banner=card.querySelector('header')!.getBoundingClientRect(),title=card.querySelector('h2')!.getBoundingClientRect()
      return banner.top>=bounds.top && banner.right<=bounds.right && title.right<=bounds.right && title.bottom<=banner.bottom
    }))).toBe(true)
    await expect(page.locator('.weekly-section').nth(7).locator('li')).toHaveCount(7)
    await expect(page.getByText('EXPLANATION_HIDDEN')).toHaveCount(0)
    expect(await page.locator('.consultant-axis-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(2)
    await expect(page.locator('.weekly-section').last().locator('li')).toHaveCount(4)
    await expect(page.getByText('Artisan Cafe & Eatery')).toHaveCount(0)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false)
  }
  await page.locator('.consultant-synthesis').screenshot({path:`test-results/consultant-summary-${test.info().project.name}.png`})
  await page.locator('.consultant-positive-details').screenshot({path:`test-results/consultant-positive-${test.info().project.name}.png`})
  await page.locator('.weekly-section').nth(2).screenshot({path:`test-results/consultant-service-${test.info().project.name}.png`})
  await page.locator('.weekly-section').nth(3).scrollIntoViewIfNeeded()
  await page.screenshot({path:`test-results/consultant-axes-${test.info().project.name}.png`})
  // Stress a longer localized title without changing any production wording.
  const longTitle=page.locator('.consultant-synthesis h2').first()
  await longTitle.evaluate(el=>{el.textContent='Synthèse des résultats de l’analyse'})
  const titleBounds=await longTitle.evaluate(el=>{
    const title=el.getBoundingClientRect(),header=el.closest('header')!.getBoundingClientRect()
    return {fits:title.right<=header.right && title.bottom<=header.bottom,lines:title.height/parseFloat(getComputedStyle(el).lineHeight),height:header.height}
  })
  expect(titleBounds.fits).toBe(true)
  expect(titleBounds.lines).toBeLessThanOrEqual(2.1)
  expect(titleBounds.height).toBeLessThanOrEqual(66)
  expect(requests).toHaveLength(0)
})
