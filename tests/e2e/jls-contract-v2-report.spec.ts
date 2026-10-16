import {test,expect} from "@playwright/test";
for(const language of ["fr","vi"])test("saved V2 report "+language+" is visible on mobile and after reload without a write",async({page})=>{
 if(test.info().project.name==="desktop")await page.setViewportSize({width:768,height:1024});
 const posts:string[]=[];page.on("request",r=>{if(r.method()==="POST")posts.push(r.url());});
 await page.goto("/tests/e2e/fixtures/jls-restaurant.html?contract-v2&language="+language);
 const report=page.getByTestId("jls-contract-v2-report");await expect(report).toBeVisible();
 await expect(report).toContainText("SYNTHETIC V2 REPORT");
 await expect(report.getByText(language==="fr"?"Recommandations proposées":"Khuyến nghị đề xuất",{exact:true})).toBeVisible();
 await report.getByText(language==="fr"?"Consulter la preuve et son contexte":"Xem bằng chứng và ngữ cảnh",{exact:true}).first().click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 expect(await page.getByRole("button").count()).toBe(0);
 await page.reload();await expect(report).toBeVisible();expect(posts).toEqual([]);
});
