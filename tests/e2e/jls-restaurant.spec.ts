import {test,expect} from "@playwright/test";
for(const language of ["fr","vi"])test("Saved response "+language+" is readable with provenance and blocked history",async({page})=>{
 if(test.info().project.name==="desktop")await page.setViewportSize({width:768,height:1024});
 const posts:string[]=[];page.on("request",r=>{if(r.method()==="POST")posts.push(r.url());});
 await page.goto("/tests/e2e/fixtures/jls-restaurant.html?language="+language+"&snapshot-v2&saved-response");
 await expect(page.getByTestId("jls-saved-response")).toContainText("needs_review");
 await expect(page.getByRole("alert")).toContainText("SYNTHETIC_SAVE_BLOCKAGE");
 await page.getByText(language==="fr"?"Provenance de la revalidation":"Nguồn gốc bản kiểm tra lại",{exact:true}).click();
 await expect(page.getByTestId("jls-saved-response")).toContainText("synthetic_commit");
 await page.getByText(language==="fr"?"Recommandation masquée — statut et motifs":"Khuyến nghị bị ẩn — trạng thái và lý do",{exact:true}).click();
 await expect(page.getByText("SYNTHETIC_MASKED_RECOMMENDATION",{exact:true})).toBeVisible();
 await expect(page.getByTestId("jls-saved-response")).toContainText("PRECISE_ACTION_REQUIRES_REVIEW");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.reload();await expect(page.getByTestId("jls-saved-response")).toBeVisible();expect(posts).toEqual([]);
});
for(const language of ["fr","vi"])test("Chill frozen V2 "+language+" preserves 100/80/20 and reloads without launch",async({page})=>{
 if(test.info().project.name==="desktop")await page.setViewportSize({width:768,height:1024});
 const posts:string[]=[];page.on("request",r=>{if(r.method()==="POST")posts.push(r.url());});
 await page.goto("/tests/e2e/fixtures/jls-restaurant.html?language="+language+"&snapshot-v2");
 await expect(page.getByTestId("jls-frozen-source")).toContainText("100");await expect(page.getByTestId("jls-frozen-source")).toContainText("80");await expect(page.getByTestId("jls-frozen-source")).toContainText("20");
 await expect(page.getByRole("button",{disabled:true})).toHaveCount(1);
 expect(await page.locator("body").innerText()).not.toMatch(/USD|coût|chi phí/i);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.reload();await expect(page.getByTestId("jls-frozen-source")).toBeVisible();expect(posts).toEqual([]);
});
for(const language of ["fr","vi"])test("Garden "+language+" closed delegated preparation, reload, no amount",async({page})=>{
 if(test.info().project.name==="desktop")await page.setViewportSize({width:768,height:1024});
 const posts:string[]=[];page.on("request",r=>{if(r.method()==="POST")posts.push(r.url());});
 await page.goto("/tests/e2e/fixtures/jls-restaurant.html?language="+language);
 await expect(page.getByText("EXPLICIT SYNTHETIC TEST")).toBeVisible();
 await expect(page.getByTestId("jls-sol-size")).toContainText("32768");
 await expect(page.getByRole("button")).toBeDisabled();
 expect(await page.locator("body").innerText()).not.toMatch(/USD|coût|chi phí/i);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.getByText(language==="fr"?"Provenance du protocole":"Nguồn gốc giao thức",{exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.reload();await expect(page.getByRole("button")).toBeDisabled();expect(posts).toEqual([]);
});
for(const language of ["fr","vi"])test("Sol-only ready "+language+" has reused Luna, no cost or launch",async({page})=>{
 if(test.info().project.name==="desktop")await page.setViewportSize({width:768,height:1024});
 const posts:string[]=[];page.on("request",r=>{if(r.method()==="POST")posts.push(r.url());});
 await page.goto("/tests/e2e/fixtures/jls-restaurant.html?language="+language+"&ready");
 await expect(page.getByTestId("jls-sol-only-ready")).toContainText("28");
 await expect(page.getByTestId("jls-sol-only-ready")).toContainText("32");
 await expect(page.getByRole("button")).toBeDisabled();
 expect(await page.locator("body").innerText()).not.toMatch(/USD|coût|chi phí/i);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.reload();expect(posts).toEqual([]);await expect(page.getByRole("button")).toBeDisabled();
});
