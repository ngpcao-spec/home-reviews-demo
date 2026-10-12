import {expect,test} from "@playwright/test";
for(const language of ["fr","vi"])test(`Luna evidence40 ${language} manual cost consent and mobile resume`,async({page})=>{
 test.setTimeout(90000);if(test.info().project.name==="desktop")await page.setViewportSize({width:768,height:1024});
 const traffic:string[]=[];page.on("request",r=>{if(/api\.openai|typesafe|apify|functions\/v1|rest\/v1/.test(r.url()))traffic.push(r.url());});
 await page.goto(`/tests/e2e/fixtures/decisions-evidence40.html?language=${language}`);
 const prepare=page.getByRole("button",{name:language==="fr"?"Prévisualiser gratuitement":"Xem trước miễn phí",exact:true}),confirm=page.getByRole("button",{name:language==="fr"?"Confirmer le coût et lancer Luna":"Xác nhận chi phí và chạy Luna",exact:true});
 await expect(prepare).toBeEnabled();await expect(confirm).toHaveCount(0);expect(await page.evaluate(()=>localStorage.getItem("e40-confirm-count"))).toBeNull();
 await prepare.click();await expect(confirm).toBeEnabled();expect(await page.evaluate(()=>localStorage.getItem("e40-confirm-count"))).toBeNull();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.screenshot({path:`test-results/e40-consent-${language}-${test.info().project.name}.png`});
 await confirm.click();await expect(confirm).toBeDisabled();await expect(page.getByText("mock-run",{exact:true})).toBeVisible();expect(await page.evaluate(()=>localStorage.getItem("e40-confirm-count"))).toBe("1");
 await page.reload();await expect(page.getByText("mock-run",{exact:true})).toBeVisible();await expect(confirm).toHaveCount(0);await expect(prepare).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await page.getByRole("button",{name:language==="fr"?"Vérifier l’état (sans nouvel appel IA)":"Kiểm tra trạng thái (không gọi AI mới)",exact:true}).click();await expect(page.getByText(language==="fr"?"Résultats exploratoires":"Kết quả thử nghiệm",{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);expect(traffic).toEqual([]);
});
