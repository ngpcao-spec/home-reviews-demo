import {test,expect} from "@playwright/test";
for(const language of ["fr","vi"])test("recommendation review "+language+" keeps original and derived separate after reload",async({page})=>{
 if(test.info().project.name==="desktop")await page.setViewportSize({width:768,height:1024});
 const posts:string[]=[];page.on("request",r=>{if(r.method()==="POST")posts.push(r.url());});
 await page.goto("/tests/e2e/fixtures/jls-restaurant.html?ready&review&language="+language);
 const review=page.getByTestId("jls-recommendation-review");await expect(review).toBeVisible();
 await review.getByTestId("jls-derived-report").locator("summary").first().click();
 await expect(review).toContainText(language==="fr"?"Les textes, citations, thèmes et verdicts Luna sont conservés.":"Giữ nguyên văn bản, trích dẫn, chủ đề và quyết định Luna.");
 await review.getByText(language==="fr"?"Citation autonome proposée":"Trích dẫn độc lập được đề xuất",{exact:true}).click();
 await expect(review).toContainText("They served the wrong dish instead of the soup we ordered.");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.reload();await expect(review).toBeVisible();expect(posts).toEqual([]);
});
