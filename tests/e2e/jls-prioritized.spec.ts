import { test, expect } from "@playwright/test";
for(const language of ["fr","vi"]) test(`prioritized ${language}: observation/action, source expansion, reload and closed spending`,async({page})=>{
  if(test.info().project.name==="desktop")await page.setViewportSize({width:768,height:1024});
  const paid:string[]=[];
  page.on("request",r=>{if(r.method()==="POST"||/api\.openai|api\.jev|apify|process-jev-luna-sol/.test(r.url()))paid.push(r.url());});
  await page.goto(`/tests/e2e/fixtures/jls-prioritized.html?language=${language}`);
  await expect(page.getByText("EXPLICIT SYNTHETIC TEST — NO REAL SOL RESULT")).toBeVisible();
  const button=page.getByRole("button",{name:language==="fr"?"Nouvel essai — GO explicite requis":"Thử nghiệm mới — cần cho phép rõ ràng"});
  await expect(button).toBeDisabled();
  await expect(page.getByText(language==="fr"?"Ce que les clients rapportent":"Nội dung khách hàng phản ánh")).toBeVisible();
  await expect(page.getByText(language==="fr"?"Action proposée au restaurateur":"Hành động đề xuất cho nhà hàng")).toBeVisible();
  await page.getByText(language==="fr"?"Consulter la preuve et son contexte":"Xem bằng chứng và ngữ cảnh",{exact:true}).click();
  await expect(page.locator("blockquote").last()).toContainText("waited");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.reload();await expect(button).toBeDisabled();
  await expect(page.getByText(language==="fr"?"Note méthodologique":"Ghi chú phương pháp").last()).toBeVisible();
  expect(paid).toEqual([]);
  await page.screenshot({path:`test-results/prioritized-${language}-${test.info().project.name}.png`,fullPage:true});
});
