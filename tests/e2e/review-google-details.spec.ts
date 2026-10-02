import {expect,test} from '@playwright/test'

for(const language of ['fr','vi']){
  for(const kind of ['full','partial','empty']){
    test(`Google review details ${language} / ${kind}`,async({page},testInfo)=>{
      await page.route(/https:\/\/.*/,route=>route.abort())
      await page.addInitScript(({language,kind})=>{
        localStorage.setItem('review-details-test',kind)
        localStorage.setItem('review-details-language',language)
      },{language,kind})
      await page.goto('/tests/e2e/fixtures/resume.html#/avis/xom-review')
      await expect(page.getByText('Réponse déjà enregistrée').first()).toBeVisible()
      await expect(page.getByText('OLD SUMMARY MUST NOT APPEAR')).toHaveCount(0)
      await expect(page.getByText(/^(Résumé IA|Tóm tắt AI)$/)).toHaveCount(0)
      const cards=page.locator('.google-review-details')
      await expect(cards).toHaveCount(kind==='empty'?0:2)
      if(kind!=='empty'){
        await expect(page.locator('.google-subratings dd')).toHaveText(kind==='full'?['4 ★','1 ★','2 ★']:['3 ★'])
        await expect(page.getByRole('heading',{name:language==='fr'?'Notes détaillées':'Điểm chi tiết'})).toBeVisible()
        await expect(page.getByText(language==='fr'?'Niveau de bruit':'Độ ồn',{exact:true})).toBeAttached()
        if(kind==='full')await expect(page.getByText('700–800 k₫',{exact:true})).toBeAttached()
        await cards.first().scrollIntoViewIfNeeded()
        await page.screenshot({path:testInfo.outputPath('google-details.png'),fullPage:true})
      }
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
      expect(await page.evaluate(()=>window.resumeHarness.invocations.filter(n=>n==='analyze-review'))).toEqual([])
    })
  }
}
