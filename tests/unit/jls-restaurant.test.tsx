import {it,expect,vi,afterEach} from "vitest";
import {cleanup,render,screen} from "@testing-library/react";
import {gardenFixture} from "../fixtures/jls-restaurant";
import {restaurantConsent,verifyRestaurantProtocol} from "../../supabase/functions/_shared/jls-restaurant";
import {processRestaurant,restaurantAttempt} from "../../supabase/functions/_shared/jls-restaurant-worker";
import {JlsRestaurantPreparation,type RestaurantView} from "../../src/components/analysis/JlsRestaurantPreparation";
import {I18nProvider} from "../../src/i18n";
import {readFileSync} from "node:fs";
afterEach(cleanup);
it("frozen preparation pins English, original texts, configuration and exact cache; no estimates or consent",async()=>{
 const f=await gardenFixture(),p=f.state.protocol;await verifyRestaurantProtocol(p.body,p.sha256);
 expect(p.body.max_jev_calls).toBe(12);expect(p.body.max_luna_calls).toBe(32);expect(p.body.max_sol_calls).toBe(1);
 expect(p.body.configuration.policy).toMatchObject({automatic_retry:false,provider_client_retries:0,no_monetary_estimate:true,no_amount_confirmation:true});
 expect(JSON.stringify(p.body)).not.toMatch(/estimated_cost|approved_estimates|cost_confirmed/);
 expect(f.state.tasks.every(t=>t.request_count===0)).toBe(true);
 expect(p.body.pending.every(t=>Object.keys(t.payload.state).sort().join(",")==="analysis_text,review_alias")).toBe(true);
});
it.each(["no_go","expired"])("%s sends zero requests",async(kind)=>{
 const f=await gardenFixture();if(kind==="expired"){f.authorize();f.expire();}
 const http=vi.fn(f.http);await processRestaurant(f.port,f.state.run.id,{jev:"mock",openai:"mock"},http);expect(http).not.toHaveBeenCalled();
});
it("new direct consent binds only this protocol, expires and has no monetary confirmation",async()=>{
 const f=await gardenFixture(),c=await restaurantConsent(f.state.protocol.body,f.state.protocol.sha256,"GO unique SYNTHETIC TEST",new Date().toISOString());
 expect(c.scope.max_jev_calls).toBe(12);expect(c.scope.max_sol_calls).toBe(1);expect(c.expires_at).not.toBe(c.requested_at);
 expect(JSON.stringify(c)).not.toMatch(/cost|estimate|amount|Artisan/);
});
it.each(["source_sha256","configuration_sha256","cache_sha256","pending_sha256"])("modified %s blocks before provider",async(key)=>{
 const f=await gardenFixture();f.authorize();(f.state.protocol.body as unknown as Record<string,unknown>)[key]="changed";
 const http=vi.fn(f.http);await processRestaurant(f.port,f.state.run.id,{jev:"mock",openai:"mock"},http);expect(http).not.toHaveBeenCalled();
});
it("concurrent and repeated wakes do not repeat a JEV request; capacity is eight",async()=>{
 const f=await gardenFixture();f.authorize();const http=vi.fn(f.http);
 await Promise.all(Array.from({length:8},()=>processRestaurant(f.port,f.state.run.id,{jev:"mock",openai:"mock"},http)));
 expect(http).toHaveBeenCalledTimes(8);expect(f.cache).toHaveLength(8);
 await processRestaurant(f.port,f.state.run.id,{jev:"mock",openai:"mock"},http);
 expect(http).toHaveBeenCalledTimes(12);expect(f.cache).toHaveLength(12);
 expect(f.state.run.stage).toBe("luna");
 await processRestaurant(f.port,f.state.run.id,{jev:"mock",openai:"mock"},http);
 await processRestaurant(f.port,f.state.run.id,{jev:"mock",openai:"mock"},http);
 const luna=f.state.tasks.filter(t=>t.phase==="luna");expect(luna.length).toBeLessThanOrEqual(12);
 expect(luna.every(t=>t.request_count<=1)).toBe(true);
 expect(f.state.run.stage,f.getError()??undefined).toBe("sol");
 await processRestaurant(f.port,f.state.run.id,{jev:"mock",openai:"mock"},http);
 expect(f.state.run.status).toBe("completed");
 await processRestaurant(f.port,f.state.run.id,{jev:"mock",openai:"mock"},http);
 expect(f.calls.filter(u=>u.endsWith("/responses"))).toHaveLength(1);
});
it.each(["timeout","429","500","invalid_json","missing_usage","wrong_model"])("%s is preserved and never retried",async(kind)=>{
 const f=await gardenFixture();f.authorize();
 await f.port.tick(f.state.run.id,"w");
 const t=await f.port.claim(f.state.run.id,"w");t!.worker="w";
 const http=vi.fn(async()=>{if(kind==="timeout")throw Error("TIMEOUT");
  if(kind==="invalid_json")return new Response("broken");
  const native=JSON.parse(await (await f.http("https://api.typesafe.ai/v1/systemone",{body:JSON.stringify(t!.request)})).text());
  if(kind==="missing_usage")delete native.usage;if(kind==="wrong_model")native.model="another";
  return new Response(JSON.stringify(native),{status:kind==="429"?429:kind==="500"?500:200});});
 // Isolated provider unit: the reservation is explicit; no native network.
 f.port.tick=async()=>true;
 const out=await restaurantAttempt(t!,f.state,"mock",http);expect(http).toHaveBeenCalledTimes(1);expect(out.status).not.toBe("completed");
 expect(t!.request_count).toBe(1);
});
it("low-confidence native Luna decisions remain uncertain and block Sol without replacing evidence",async()=>{
 const f=await gardenFixture();f.authorize();
 const http:typeof fetch=async(...args)=>{
  const r=await f.http(...args);
  if(!String(args[0]).endsWith("/decisions"))return r;
  const raw=await r.json();raw.answers.forEach((a:{confidence:number})=>a.confidence=.5);
  return new Response(JSON.stringify(raw));
 };
 for(let i=0;i<8&&["queued","running"].includes(f.state.run.status);i++)await processRestaurant(f.port,f.state.run.id,{jev:"mock",openai:"mock"},http);
 expect(f.state.run.status).toBe("blocked");expect(f.getError()).toBe("JLS_SOL_EVIDENCE_INSUFFICIENT");
 expect(f.calls.some(u=>u.endsWith("/responses"))).toBe(false);
 const decisions=f.state.artifacts.filter(a=>a.kind.startsWith("task:")&&a.body.phase==="luna").flatMap(a=>a.body.decisions as {status:string;native_choice:string}[]);
 expect(decisions.every(d=>d.status==="UNCERTAIN"&&d.native_choice==="supported")).toBe(true);
});
it("SQL keeps historical tables untouched and prevents reset, duplicate run and API wakes from GET",()=>{
 const sql=readFileSync("supabase/migrations/20261014160258_jls_restaurant_delegated_preparation.sql","utf8");
 expect(sql).toContain("protocol_id uuid not null unique");expect(sql).toContain("request_count in(0,1)");
 expect(sql).toContain("new.request_count<old.request_count");
 expect(sql).not.toMatch(/update public.analysis_(?:jev_luna_sol|jls_prioritized)_(?:runs|results|tasks)/i);
 const api=readFileSync("supabase/functions/jls-restaurant/index.ts","utf8");expect(api).toContain('r.method!=="GET"');
 expect(api).not.toContain("authorize_jls_restaurant");expect(api).not.toContain("wake_jls_restaurant");
});
it.each(["fr","vi"] as const)("mobile %s has no amount, no confirmation and closed launch",language=>{
 const data:RestaurantView={protocol:{id:"p",sha256:"a".repeat(64),created_at:"2026-10-14",establishment_name:"Xóm Mới Garden",
  source_sha256:"b".repeat(64),configuration_sha256:"c".repeat(64),coverage:{google_total:17038,stored_reviews:587,reviews_with_text:550,
   english_ready:78,reused_analyses:7,missing_analyses:71,missing_english:472},max_jev_calls:71,max_luna_calls:32,max_sol_calls:1,
  language:"vi",format_version:"jls-prioritized-recommendations-v1",editorial_version:"jls-prioritized-editorial-v1"},run:null,result:null,progress:null};
 render(<I18nProvider language={language}><JlsRestaurantPreparation data={data}/></I18nProvider>);
 expect(screen.getByRole("button")).toBeDisabled();expect(screen.getByTestId("jls-restaurant-preparation").textContent).not.toMatch(/USD|coût|chi phí/i);
});
