import {expect,test} from '@playwright/test';
for(const language of ['fr','vi'] as const){
 test.describe(language,()=>{
 const search=language==='fr'?'Proposer des restaurants':'Đề xuất nhà hàng';
 test.beforeEach(async({page})=>{
  await page.route(/https:\/\/.*/,route=>route.abort());
  await page.addInitScript(language=>{localStorage.setItem('recommendation-test-fixture','true');localStorage.setItem('review-details-language',language);},language);
 });
 test(`private menu, no-criteria results, sources and restaurant link ${language}`,async({page},testInfo)=>{
  await page.goto('/tests/e2e/fixtures/resume.html#/plus');
  await page.getByRole('link',{name:new RegExp(language==='fr'?'Tester les recommandations':'Thử đề xuất nhà hàng')}).click();
  await page.getByRole('button',{name:search,exact:true}).click();
  await expect(page.locator('.recommendation-card')).toHaveCount(3);
  await expect(page.locator('.recommendation-freshness')).toHaveCount(1);
  await expect(page.getByText(language==='fr'?'Scores internes pondérés de 0 à 6, distincts des étoiles Google.':'Điểm nội bộ có trọng số từ 0 đến 6, khác với sao Google.')).toBeVisible();
  await expect(page.locator('.recommendation-card').first().getByText(language==='fr'?'par personne':'mỗi người',{exact:false}).first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('.recommendation-card').first().screenshot({path:testInfo.outputPath('recommendation-card.png')});
  await page.locator('.recommendation-details').first().getByText(language==='fr'?'Détails et sources':'Chi tiết và nguồn',{exact:true}).click();
  await expect(page.locator('.recommendation-details').first()).toContainText('report-place-account-a');
  await page.locator('.recommendation-open').first().click();await expect(page).toHaveURL(/etablissements\/place-account-a/);
 });
 test(`confirmed budget, empty results and explicit filter removal ${language}`,async({page})=>{
  await page.goto('/tests/e2e/fixtures/resume.html#/plus/recommandations');
  await page.getByText(language==='fr'?'Critères facultatifs':'Tiêu chí tùy chọn',{exact:true}).click();
  const budget=page.getByRole('spinbutton');await budget.fill('200000');await page.getByRole('button',{name:search,exact:true}).click();
  await expect(page.locator('.recommendation-card')).toHaveCount(1);
  await budget.fill('1');await page.getByRole('button',{name:search,exact:true}).click();await expect(page.locator('.recommendation-card')).toHaveCount(0);
  await page.getByRole('button',{name:language==='fr'?'Retirer le filtre budget':'Bỏ bộ lọc ngân sách'}).click();
  await expect(page.locator('.recommendation-card')).toHaveCount(3);await expect(budget).toHaveValue('');
 });
 test(`documented cuisine and service priority ${language}`,async({page})=>{
  await page.goto('/tests/e2e/fixtures/resume.html#/plus/recommandations');
  await page.getByText(language==='fr'?'Critères facultatifs':'Tiêu chí tùy chọn',{exact:true}).click();
  await page.getByRole('checkbox',{name:language==='fr'?'Priorité au service':'Ưu tiên phục vụ',exact:true}).check();
  await page.getByRole('button',{name:search,exact:true}).click();await expect(page.locator('.recommendation-card').first()).toContainText('Restaurant témoin 2');
  await page.getByLabel(language==='fr'?'Type de cuisine':'Loại ẩm thực',{exact:true}).selectOption('indian');
  await page.getByRole('button',{name:search,exact:true}).click();await expect(page.locator('.recommendation-card')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });
 test(`does not fill a one-result catalogue ${language}`,async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('recommendation-case','limited'));
  await page.goto('/tests/e2e/fixtures/resume.html#/plus/recommandations');await page.getByRole('button',{name:search,exact:true}).click();
  await expect(page.locator('.recommendation-card')).toHaveCount(1);
 });
 test(`localized access refusal without private results ${language}`,async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('recommendation-case','forbidden'));
  await page.goto('/tests/e2e/fixtures/resume.html#/plus/recommandations');
  await expect(page.getByRole('alert')).toContainText(language==='fr'?'Votre compte ne dispose pas des droits nécessaires':'Tài khoản của bạn chưa có quyền');
  await expect(page.locator('.recommendation-card')).toHaveCount(0);
 });
 test(`signed-out users cannot remain on the private page ${language}`,async({page})=>{
  await page.goto('/tests/e2e/fixtures/resume.html#/plus/recommandations');
  await expect(page.getByRole('button',{name:search,exact:true})).toBeVisible();
  await page.evaluate(()=>window.resumeHarness.emit('SIGNED_OUT'));
  await expect(page).toHaveURL(/connexion/);await expect(page.locator('.recommendation-card')).toHaveCount(0);
 });
 });
}
