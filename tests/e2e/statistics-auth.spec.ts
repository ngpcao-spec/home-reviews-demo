import {test,expect} from '@playwright/test'
import {readFileSync,writeFileSync} from 'node:fs'
test('statistics with two real Auth accounts, isolated restaurants and shared translations',async({browser})=>{
 test.setTimeout(120_000)
 const fixture=JSON.parse(readFileSync(process.env.CI_AUTH_FIXTURE!,'utf8'))
 const contexts=await Promise.all([0,1].map(()=>browser.newContext()))
 const passed:string[]=[]
 const mark=(name:string)=>{passed.push(name);writeFileSync('test-results/statistics-history/browser.json',JSON.stringify({passed}));console.log('STATISTICS_AUTH_PASSED',name)}
 try{
  for(let i=0;i<2;i++){
   const page=await contexts[i].newPage()
   await page.addLocatorHandler(page.locator('.notification-onboarding[role="dialog"]'),async()=>{await page.locator('.notification-onboarding .text-button').click()})
   await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort())
   await page.goto('/')
   const identity=await page.evaluate(async({email,password})=>{const {supabase}=await import(/* @vite-ignore */'/src/lib/supabase.ts');const result=await supabase.auth.signInWithPassword({email,password});if(result.error)throw result.error;return (await supabase.auth.getUser()).data.user.id},fixture.users[i])
   expect(identity).toBe(fixture.users[i].id)
   await page.goto('/analyses?tab=statistics&period=all&establishment='+fixture.establishments[i])
   await expect(page.getByRole('heading',{name:i?'Thống kê':'Statistiques',exact:true})).toBeVisible()
   const selector=page.locator('.statistics-restaurant select')
   await expect(selector.locator('option')).toHaveCount(2)
   expect(await selector.locator('option').allTextContents()).toEqual(expect.arrayContaining(['K.HOUSE Restaurant',i?'Private vi':'Private fr']))
   expect(await selector.locator('option').allTextContents()).not.toContain(i?'Private fr':'Private vi')
   const direct=await page.evaluate(async({foreign,own,shared})=>{
    const {supabase}=await import(/* @vite-ignore */'/src/lib/supabase.ts')
    const denied=await supabase.rpc('read_restaurant_statistics',{p_establishment:foreign,p_period:'all'})
    const details=await supabase.rpc('read_restaurant_statistic_reviews',{p_establishment:foreign,p_period:'all'})
    const list=await supabase.from('establishments').select('id')
    const aggregate=await supabase.rpc('read_restaurant_statistics',{p_establishment:shared,p_period:'all'})
    return {denied:denied.error?.message,detailsDenied:details.error?.message,ids:list.data?.map(x=>x.id).sort(),expected:[own,shared].sort(),count:aggregate.data?.metrics.count,barTotal:aggregate.data?.distribution.reduce((n,r)=>n+r.count,0)}
   },{foreign:fixture.privateEstablishments[1-i],own:fixture.privateEstablishments[i],shared:fixture.establishments[i]})
   expect(direct.denied).toContain('FORBIDDEN');expect(direct.detailsDenied).toContain('FORBIDDEN');expect(direct.ids).toEqual(direct.expected);expect(direct.count).toBe(158);expect(direct.barTotal).toBe(158)
   mark(i?'vi-auth-scope':'fr-auth-scope')
   await expect(page.locator('.statistics-metrics button').first().locator('strong')).toHaveText('158')
   await page.screenshot({path:`test-results/statistics-history/${i?'vi':'fr'}-statistics.png`})
   await page.locator('.statistics-metrics button').first().click()
   await expect(page.locator('.statistics-review')).toHaveCount(30)
   await expect(page.locator('.statistics-review').filter({hasText:i?'Bản dịch tiếng Việt transition-new':'Traduction française transition-new'})).toHaveCount(1)
   for(let n=0;n<5;n++)await page.getByRole('button',{name:i?'Xem thêm đánh giá':'Afficher plus d’avis',exact:true}).click()
   await expect(page.locator('.statistics-review')).toHaveCount(158)
   await expect(page.locator('.statistics-review').filter({hasText:i?'Bản dịch tiếng Việt seed-150':'Traduction française seed-150'})).toHaveCount(1)
   await page.locator('.statistics-review').last().scrollIntoViewIfNeeded()
   await page.screenshot({path:`test-results/statistics-history/${i?'vi':'fr'}-historical-detail.png`})
   mark(i?'vi-history-and-translation':'fr-history-and-translation')
  }
 }finally{await Promise.all(contexts.map(c=>c.close()))}
})
