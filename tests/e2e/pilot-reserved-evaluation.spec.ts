import { expect, test } from "@playwright/test";
test("readonly real 40-case report FR/VI, no paid traffic, iPhone/iPad, reload and filter", async ({ page }) => {
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
      "/tests/e2e/fixtures/pilot-reserved-evaluation.html?language=" + language,
    );
    await expect(
      page.getByRole("heading", {
        name: language === "fr" ? "Résultat réel V3" : "Kết quả V3 thực tế",
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        document.documentElement.scrollWidth > innerWidth
      ),
    ).toBe(false);
    await page.getByRole("combobox").selectOption("justified_rejected");
    await expect(
      page.getByText("50e0a434-b71b-410f-9149-122cec9a23d0", { exact: true }),
    ).toBeVisible();
    expect(await page.getByRole("button").count()).toBe(1);
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: language === "fr" ? "Résultat réel V3" : "Kết quả V3 thực tế",
      }),
    ).toBeVisible();
    await page.screenshot({
      path:
        `test-results/reserved40-${language}-${test.info().project.name}.png`,
      fullPage: true,
    });
  }
  expect(paid).toEqual([]);
});
