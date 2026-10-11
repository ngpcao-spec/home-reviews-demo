import { expect, test } from "@playwright/test";
test("hybrid free preview FR/VI, generation disabled, no calls, iPhone/iPad reload", async ({ page }) => {
  if (test.info().project.name === "desktop") {
    await page.setViewportSize({ width: 768, height: 1024 });
  }
  const paid: string[] = [];
  page.on("request", (r) => {
    if (/typesafe|openai|apify|functions\/v1|rest\/v1/.test(r.url())) {
      paid.push(r.url());
    }
  });
  for (const language of ["fr", "vi"]) {
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
    await page.screenshot({
      path: `test-results/hybrid-${language}-${test.info().project.name}.png`,
      fullPage: true,
    });
  }
  expect(paid).toEqual([]);
});
