import {test,expect} from '@playwright/test'
test('blind explicit finding validation FR/VI, persisted answer and cursor, no overflow or provider calls',async({page})=>{
  const calls:string[]=[];page.on('request',r=>{if(/api\.typesafe|api\.openai|apify|functions\/v1|rest\/v1/.test(r.url()))calls.push(r.url())})
  for(const language of ['fr','vi']){
    await page.goto('/tests/e2e/fixtures/finding-audit.html?language='+language)
    await expect(page.locator('[data-finding-audit-theme]')).toHaveCount(1);await expect(page.locator('button[aria-pressed=true]')).toHaveCount(0)
    const next=page.getByRole('button',{name:language==='fr'?'Suivant':'Tiếp',exact:true});await expect(next).toBeDisabled();await expect(page.getByRole('button',{name:language==='fr'?'Finaliser le contrôle':'Hoàn tất kiểm tra',exact:true})).toHaveCount(0)
    expect(await page.locator('body').textContent()).not.toMatch(/V9|Jev|Sol|Gold|probabilit|rating|TEXTE ORIGINAL/)
    await page.getByRole('button',{name:/Info/}).click();await expect(page.locator('[data-finding-audit-theme] p')).toHaveCount(2)
    await page.getByRole('button',{name:language==='fr'?'Uncertain':'Không chắc',exact:true}).click();await expect(next).toBeEnabled();await page.reload();await expect(page.getByRole('button',{name:language==='fr'?'Uncertain':'Không chắc',exact:true})).toHaveAttribute('aria-pressed','true')
    await page.getByRole('button',{name:language==='fr'?'Suivant':'Tiếp',exact:true}).click();await page.reload();await expect(page.getByText(language==='fr'?'Contrôle 2 / 30':'Kiểm tra 2 / 30',{exact:true})).toBeVisible()
    await page.getByRole('button',{name:language==='fr'?'Précédent':'Trước',exact:true}).click();await page.getByRole('button',{name:language==='fr'?'Both':'Cả hai',exact:true}).click();await expect(page.locator('button[aria-pressed=true]')).toHaveCount(1)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await page.screenshot({path:`test-results/finding-audit-draft-${language}-${test.info().project.name}.png`,fullPage:true});await page.evaluate(()=>localStorage.clear())
  }
  expect(calls).toEqual([])
})
test('completed results reveal findings, probabilities, thresholds and stable groups FR/VI',async({page})=>{
  for(const language of ['fr','vi']){
    await page.goto('/tests/e2e/fixtures/finding-audit.html?phase=results&language='+language)
    await expect(page.getByRole('heading',{name:language==='fr'?'Résultat du contrôle des détections':'Kết quả kiểm tra phát hiện'})).toBeVisible()
    await expect(page.getByText(language==='fr'?'Seuils exploratoires':'Ngưỡng thăm dò',{exact:true})).toBeVisible();await expect(page.getByText(language==='fr'?'Findings rejetés':'Findings bị bác bỏ',{exact:true})).toBeVisible();await expect(page.getByRole('button')).toHaveCount(0)
    await expect(page.getByText(language==='fr'?'Probabilité positive':'Xác suất tích cực',{exact:true}).first()).toBeVisible()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await page.screenshot({path:`test-results/finding-audit-results-${language}-${test.info().project.name}.png`,fullPage:true})
  }
})
test('30 explicit responses required before confirmed finalization; synthetic journey only',async({page})=>{
  await page.goto('/tests/e2e/fixtures/finding-audit.html?language=fr')
  for(let i=0;i<30;i++){
    await expect(page.getByText(`Contrôle ${i+1} / 30`,{exact:true})).toBeVisible()
    await page.getByRole('button',{name:'Absent',exact:true}).click()
    if(i<29){await expect(page.getByRole('button',{name:'Finaliser le contrôle',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Suivant',exact:true}).click()}
  }
  await page.getByRole('button',{name:'Finaliser le contrôle',exact:true}).click();await expect(page.getByRole('alertdialog')).toBeVisible();await page.getByRole('button',{name:'Annuler',exact:true}).click();await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await page.getByRole('button',{name:'Finaliser le contrôle',exact:true}).click();await page.getByRole('button',{name:'Confirmer la finalisation',exact:true}).click();await expect(page.getByRole('heading',{name:'Résultat du contrôle des détections'})).toBeVisible();await expect(page.getByRole('button')).toHaveCount(0)
})
