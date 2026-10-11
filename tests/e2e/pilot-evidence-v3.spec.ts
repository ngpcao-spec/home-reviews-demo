import { expect, test } from "@playwright/test";
test("V3 exact quotes, blind control export, FR/VI mobile reload, zero paid traffic", async ({ page }) => {
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
      "/tests/e2e/fixtures/pilot-evidence-v3.html?language=" + language,
    );
    const disabled = page.getByRole("button", {
      name: language === "fr"
        ? "Vérification sémantique IA — désactivée"
        : "Kiểm tra ngữ nghĩa AI — chưa bật",
      exact: true,
    });
    await expect(disabled).toBeDisabled();
    await expect(
      page.getByRole("heading", {
        name: language === "fr"
          ? "Nouveau contrôle figé — 40 avis"
          : "Bộ kiểm tra mới đã cố định — 40 đánh giá",
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        document.documentElement.scrollWidth > innerWidth
      ),
    ).toBe(false);
    const download = page.waitForEvent("download");
    await page.getByRole("button", {
      name: language === "fr"
        ? "Exporter pour une future annotation ChatGPT"
        : "Xuất để ChatGPT gán nhãn sau",
    }).click();
    expect((await download).suggestedFilename()).toBe(
      "home-reviews-evidence-v3-control-blind.json",
    );
    await page.reload();
    await expect(disabled).toBeDisabled();
    await page.screenshot({
      path:
        `test-results/evidence-v3-${language}-${test.info().project.name}.png`,
      fullPage: true,
    });
  }
  expect(paid).toEqual([]);
});
