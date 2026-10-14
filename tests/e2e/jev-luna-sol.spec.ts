import { expect, test } from "@playwright/test";
for (const language of ["fr", "vi"]) test(`JEV Luna Sol ${language}: free iPhone/iPad preview, reload, no paid request`, async ({ page }) => {
  if (test.info().project.name === "desktop") await page.setViewportSize({ width: 768, height: 1024 });
  const paid: string[] = [];
  page.on("request", r => { if (/api\.openai\.com|api\.jev|apify|process-jev-luna-sol/.test(r.url()) || r.method() === "POST") paid.push(r.url()); });
  await page.goto(`/tests/e2e/fixtures/jev-luna-sol.html?language=${language}`);
  const button = page.getByRole("button", { name: language === "fr" ? "Générer le rapport hybride" : "Tạo báo cáo kết hợp" });
  await expect(button).toBeDisabled();
  await expect(page.getByText(language === "fr" ? "Lancement délégué prêt — aucune dépense autorisée" : "Sẵn sàng chạy được ủy quyền — chưa cho phép chi phí")).toBeVisible();
  await page.getByText(language === "fr" ? "Prévisualisation gratuite du dossier Sol" : "Xem trước miễn phí hồ sơ Sol", { exact: true }).click();
  await expect(page.getByText(language === "fr" ? "Ce dossier montre les preuves proposées. Aucune n’a encore été acceptée par Luna. Aucun résultat Sol n’est simulé." : "Hồ sơ hiển thị bằng chứng đề xuất. Chưa có bằng chứng nào được Luna chấp nhận. Không mô phỏng kết quả Sol.")).toBeVisible();
  await page.getByText(language === "fr" ? "Texte anglais complet" : "Toàn bộ nội dung tiếng Anh", { exact: true }).first().click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.reload();await expect(button).toBeDisabled();
  await expect(page.getByText(language === "fr" ? "Pilote vietnamien — exécution déléguée" : "Thử nghiệm tiếng Việt — chạy được ủy quyền")).toBeVisible();
  expect(paid).toEqual([]);
  await page.screenshot({ path: `test-results/jls-${language}-${test.info().project.name}.png`, fullPage: false });
});
