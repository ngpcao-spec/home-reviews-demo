import {test,expect} from "@playwright/test";
for(const language of ["fr","vi"])test("targeted V2.1 preparation stays read-only and visible after reload "+language,async({page})=>{
 if(test.info().project.name==="desktop")await page.setViewportSize({width:768,height:1024});
 const writes:string[]=[];page.on("request",r=>{if(!["GET","HEAD"].includes(r.method()))writes.push(r.url());});
 await page.goto("/tests/e2e/fixtures/jls-restaurant.html?snapshot-v2&targeted-v21&language="+language);
 const preparation=page.getByTestId("jls-targeted-v21");await expect(preparation).toBeVisible();
 for(const text of ["100","80","20","31","wait_time","drinks","synthetic-new-protocol"])await expect(preparation).toContainText(text);
 expect(await preparation.getByRole("button").count()).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.reload();await expect(preparation).toBeVisible();expect(writes).toEqual([]);
});
