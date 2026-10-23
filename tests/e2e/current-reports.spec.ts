import {test,expect} from '@playwright/test'
for(const language of ['fr','vi'])test(`current V2 ${language}: archived Sol, negative reviews and explicit button`,async({page})=>{
 const mutations:string[]=[];page.on('request',r=>{if(r.method()==='POST'||/api.openai|typesafe.ai|apify/.test(r.url()))mutations.push(r.url())})
 await page.goto(`/tests/e2e/fixtures/current-reports.html?language=${language}`)
 const tab=page.getByRole('tab',{name:language==='fr'?'Rapport courant · V2':'Báo cáo hiện tại · V2'})
 await expect(tab).toHaveAttribute('aria-selected','true')
 await expect(page.locator('.consultant-report').getByText('EXPLICIT UNCHANGED ACTION')).toBeVisible()
 await expect(page.getByText('LEGACY SOL PRESERVED')).not.toBeVisible()
 await expect(page.getByRole('button',{name:/Xem đánh giá nguồn|Consulter les avis sources/})).toHaveCount(0)
 const negative=page.locator('.v5-axis[data-axis=service]').getByRole('button',{name:language==='fr'?'Avis négatifs, mixtes inclus : 2 — Service':'Đánh giá tiêu cực, gồm hỗn hợp : 2 — Dịch vụ'})
 await negative.click();const panel=page.getByRole('dialog');await expect(panel).toBeVisible()
 await expect(panel.getByText('FULL NEGATIVE REVIEW OUTSIDE THE SELECTED QUOTATIONS.',{exact:true})).toBeVisible()
 await page.screenshot({path:`test-results/current-v2-${language}-${test.info().project.name}-negative.png`})
 await panel.getByRole('button',{name:language==='fr'?'Fermer et revenir au rapport':'Đóng và quay lại báo cáo'}).click()
 await expect(panel).toHaveCount(0);await expect(negative).toBeFocused()
 await page.getByRole('tab',{name:language==='fr'?'Rapports précédents':'Báo cáo trước đây'}).click()
 await expect(page.getByText('LEGACY SOL PRESERVED')).toBeVisible();await tab.click()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false)
 await page.screenshot({path:`test-results/current-v2-${language}-${test.info().project.name}.png`,fullPage:true})
 if(test.info().project.name==='desktop'){await page.setViewportSize({width:768,height:1024});expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false)}
 await page.getByRole('button',{name:'NORMAL GENERATE MOCK'}).click();await expect(page.getByRole('button',{name:'NORMAL GENERATE MOCK'})).toHaveAttribute('data-clicked','yes')
 await page.reload();await expect(tab).toHaveAttribute('aria-selected','true');expect(mutations).toEqual([])
})


