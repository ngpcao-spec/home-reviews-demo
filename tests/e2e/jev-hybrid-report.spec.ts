import { expect, test } from "@playwright/test";
for (const language of ["fr", "vi"]) test(`hybrid balanced ${language}, generation disabled, no calls, iPhone/iPad reload`, async ({ page }) => {
  test.setTimeout(90000);
  if (test.info().project.name === "desktop") {
    await page.setViewportSize({ width: 768, height: 1024 });
  }
  const paid: string[] = [];
  page.on("request", (r) => {
    if (/typesafe|openai|apify|functions\/v1|rest\/v1/.test(r.url())) {
      paid.push(r.url());
    }
  });
    await page.goto(
      "/tests/e2e/fixtures/jev-hybrid-report.html?language=" + language,
    );
    const button = page.getByRole("button", {
      name: language === "fr"
        ? "Générer le rapport hybride"
        : "Tạo báo cáo kết hợp",
      exact: true,
    });
    await expect(button).toBeDisabled();
    await page.getByRole("button",{name:language==="fr"?"Sélection V1":"Lựa chọn V1",exact:true}).click();
    await expect(page.getByRole("button",{name:language==="fr"?"Sélection V1":"Lựa chọn V1",exact:true})).toHaveAttribute("aria-pressed","true");
    await page.getByRole("button",{name:language==="fr"?"Sélection V1.1 équilibrée":"Lựa chọn V1.1 cân bằng",exact:true}).click();
    await expect(page.getByRole("heading",{name:language==="fr"?"Comparaison gratuite V1 / V1.1":"So sánh miễn phí V1 / V1.1"})).toBeVisible();
    await page.getByText(language==="fr"?"Texte anglais complet de l’avis":"Toàn bộ nội dung tiếng Anh của đánh giá",{exact:true}).first().click();
    await expect(
      page.getByRole("heading", {
        name: language === "fr"
          ? "Prévisualisation gratuite — aucune réponse Sol"
          : "Xem trước miễn phí — chưa có phản hồi Sol",
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        document.documentElement.scrollWidth > innerWidth
      ),
    ).toBe(false);
    await page.reload();
    await expect(button).toBeDisabled();
    await expect(page.getByRole("button",{name:language==="fr"?"Sélection V1.1 équilibrée":"Lựa chọn V1.1 cân bằng",exact:true})).toHaveAttribute("aria-pressed","true");
    await page.screenshot({
      path: `test-results/hybrid-${language}-${test.info().project.name}.png`,
      fullPage: false,
    });
  expect(paid).toEqual([]);
});
