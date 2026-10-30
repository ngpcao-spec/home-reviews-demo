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
  await expect(page.locator('.recommendation-freshness')).toHaveText(language==='fr'?'À actualiser : le corpus a évolué depuis ce rapport.':'Cần cập nhật: tập đánh giá đã thay đổi từ khi lập báo cáo.');
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
 test(`explicit AI comparison only, two selections and mobile sources ${language}`,async({page},testInfo)=>{
  await page.goto('/tests/e2e/fixtures/resume.html#/plus/recommandations');
  const compare=language==='fr'?'Comparer avec l’IA':'So sánh với AI',preference=language==='fr'?'Qu’est-ce qui compte pour vous ?':'Điều gì quan trọng với bạn?';
  await expect(page.getByRole('button',{name:compare,exact:true})).toBeVisible();
  const text=language==='fr'?'Pas forcément calme, mais sans musique en direct.':'Không nhất thiết yên tĩnh, nhưng không có nhạc sống.';
  await page.getByLabel(preference,{exact:true}).fill(text);
  await expect(page.getByText(language==='fr'?/Votre demande complète, négations et nuances comprises/:/Chỉ gửi toàn bộ yêu cầu, gồm phủ định và sắc thái/)).toBeVisible();
  await expect(page.locator('.recommendation-ai')).toHaveCount(0);
  await page.getByRole('button',{name:search,exact:true}).click();await expect(page.locator('.recommendation-ai')).toHaveCount(0);
  await page.getByRole('button',{name:compare,exact:true}).click();await expect(page.locator('.recommendation-ai .recommendation-card')).toHaveCount(2);
  await expect(page.locator('.recommendation-ai')).toContainText(language==='fr'?'Score interne':'Điểm nội bộ');
  await expect(page.locator('[data-recommendation-origin="completed"]')).toBeVisible();
  await expect(page.getByLabel(preference,{exact:true})).toHaveValue(text);
  await expect(page.locator('.recommendation-ai')).not.toContainText(language==='fr'?'Préférences reconnues':'Mong muốn đã nhận diện');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('.recommendation-ai .recommendation-card').first().screenshot({path:testInfo.outputPath('ai-selection-card.png')});
 });
 test(`exact saved reason, matching caution and distinct Google/report sources ${language}`,async({page},testInfo)=>{
  await page.addInitScript(()=>localStorage.setItem('recommendation-ai-case','sources'));
  await page.goto('/tests/e2e/fixtures/resume.html#/plus/recommandations');
  await page.getByRole('button',{name:language==='fr'?'Comparer avec l’IA':'So sánh với AI',exact:true}).click();
  const card=page.locator('.recommendation-ai .recommendation-card').filter({hasText:'Restaurant témoin 1'});
  await expect(card).toContainText(language==='fr'?'Les plats sont appréciés':'Các món ăn được khách khen');
  await expect(card.locator('.recommendation-caution')).toContainText(language==='fr'?'davantage d’espace':'thêm không gian');
  await expect(card.locator('.recommendation-caution')).toContainText(language==='fr'?'Le nombre de références':'Số tham chiếu');
  await expect(card).toContainText(language==='fr'?'ne constitue pas un constat des avis':'không phải kết luận từ các đánh giá');
  for(const excerpt of await card.locator('.recommendation-saved-excerpt').all())expect(await excerpt.evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
  await card.getByText(language==='fr'?'Détails et sources':'Chi tiết và nguồn',{exact:true}).click();
  const sources=card.locator('.recommendation-bound-source');
  await expect(sources).toHaveCount(3);await expect(sources).toContainText(['feature_quiet','strength_quality_0','reservation_ambiance_1']);
  await expect(sources.filter({hasText:'reservation_ambiance_1'})).not.toContainText(language==='fr'?'attente':'thời gian chờ');
  await expect(sources.filter({hasText:'reservation_ambiance_1'})).toContainText('report-place-account-a');
  await expect(sources.filter({hasText:'feature_quiet'})).toContainText('additionalInfo.Bầu không khí.Yên tĩnh');
  await expect(sources.getByRole('link')).toHaveAttribute('href','https://www.google.com/maps?cid=123');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await card.screenshot({path:testInfo.outputPath('ai-bound-sources.png')});
 });
 for(const state of ['cached','pending'])test(`explicit ${state} provenance ${language}`,async({page})=>{
  await page.addInitScript(state=>localStorage.setItem('recommendation-ai-case',state),state);
  await page.goto('/tests/e2e/fixtures/resume.html#/plus/recommandations');
  await page.getByRole('button',{name:language==='fr'?'Comparer avec l’IA':'So sánh với AI',exact:true}).click();
  await expect(page.locator(`[data-recommendation-origin="${state}"]`)).toBeVisible();
  await expect(page.locator('.recommendation-ai .recommendation-card')).toHaveCount(state==='cached'?2:0);
 });
 test(`invalid AI keeps the existing engine ${language}`,async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('recommendation-ai-case','invalid'));
  await page.goto('/tests/e2e/fixtures/resume.html#/plus/recommandations');
  await page.getByRole('button',{name:language==='fr'?'Comparer avec l’IA':'So sánh với AI',exact:true}).click();
  await expect(page.locator('.recommendation-card')).toHaveCount(3);await expect(page.locator('.recommendation-ai')).toContainText(language==='fr'?'classement du moteur conservé':'giữ xếp hạng');
  await expect(page.locator('[data-recommendation-origin="fallback"]')).toBeVisible();
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
