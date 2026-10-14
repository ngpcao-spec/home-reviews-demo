import {it,expect,vi} from "vitest";
import {prioritizedExecutionFixture} from "../fixtures/jls-prioritized-execution";
import {processPrioritizedSol} from "../../supabase/functions/_shared/jls-prioritized-worker";
import {prioritizedExecutionProtocol} from "../../supabase/functions/_shared/jls-prioritized-execution";
import {hybridHash} from "../../supabase/functions/_shared/jev-hybrid-evidence";
import {readFileSync} from "node:fs";
it("free protocol pins every source; no consent or run is implied",async()=>{
 const f=await prioritizedExecutionFixture();expect(f.read().consent).toBeNull();expect(f.protocol.body).toMatchObject({max_sol_calls:1,jev_new_calls:0,luna_new_calls:0,apify_new_calls:0,automatic_retry:false,provider_client_retries:0,language:"vi"});
 for(const key of ["source_plan_sha256","decisions_sha256","dossier_sha256","prompt_sha256","schema_sha256","request_sha256","configuration_sha256","reused_luna_manifest_sha256"])expect(f.protocol.body[key as keyof typeof f.protocol.body]).toMatch(/^[a-f0-9]{64}$/);
});
it.each(["no_go","expired","wrong_scope"])("%s never sends HTTP",async(kind)=>{
 const f=await prioritizedExecutionFixture(),http=vi.fn(f.http);
 if(kind!=="no_go")await f.authorize();if(kind==="expired")f.advance();if(kind==="wrong_scope"){const c=f.read().consent!;c.scope.language="fr";f.setConsent(c);}
 await processPrioritizedSol(f.port,f.source,f.task.run_id,"explicit_mock_key",http);expect(http).not.toHaveBeenCalled();expect(f.task.request_count).toBe(0);
});
it("concurrent wakes and repeated wakes send exactly one request after durable reservation",async()=>{
 const f=await prioritizedExecutionFixture();await f.authorize();const before=await hybridHash(f.history);const http=vi.fn(async(...args:Parameters<typeof fetch>)=>{
  expect(f.task.request_count).toBe(1);expect(String(args[0])).toBe("https://api.openai.com/v1/responses");expect(args[1]?.redirect).toBe("error");return f.http(...args);});
 await Promise.all(Array.from({length:12},()=>processPrioritizedSol(f.port,f.source,f.task.run_id,"explicit_mock_key",http)));
 await processPrioritizedSol(f.port,f.source,f.task.run_id,"explicit_mock_key",http);
 expect(http).toHaveBeenCalledTimes(1);expect(f.task.request_count).toBe(1);expect(f.read().state).toBe("completed");expect(await hybridHash(f.history)).toBe(before);
 expect(f.read().result).toMatchObject({served_model:"gpt-6.1-sol",input_tokens:200,output_tokens:100,cost_usd:.0014,human_validated:false});
});
it.each(["response","parsed","served_model","request_sha256"])("incompatible historical %s rejected without recalculation",async(key)=>{
 const f=await prioritizedExecutionFixture(),h=structuredClone(f.history);(h.tasks[0] as unknown as Record<string,unknown>)[key]=key==="served_model"?"another-model":"changed";
 await expect(prioritizedExecutionProtocol(f.preparation,f.source.plan,h)).rejects.toThrow();
});
it.each(["dossier_sha256","schema_sha256","request_sha256","config_sha256"])("changed draft %s blocked",async(key)=>{
 const f=await prioritizedExecutionFixture(),p=structuredClone(f.preparation);(p.body.draft as unknown as Record<string,unknown>)[key]="changed";p.sha256=await hybridHash(p.body);
 await expect(prioritizedExecutionProtocol(p,f.source.plan,f.history)).rejects.toThrow();
});
it.each(["timeout","429","500","invalid_json","missing_usage","wrong_model","refusal","invalid_report"])("%s preserved, no retry",async(kind)=>{
 const f=await prioritizedExecutionFixture();await f.authorize();const native=f.response();
 const http=vi.fn(async()=>{if(kind==="timeout")throw new Error("timeout");if(kind==="invalid_json")return new Response("not json");
  if(kind==="missing_usage")delete (native as {usage?:unknown}).usage;if(kind==="wrong_model")native.model="another-model";
  if(kind==="refusal")native.output[0].content=[{type:"refusal",text:"Refused"}];if(kind==="invalid_report")native.output[0].content[0].text="{}";
  return new Response(JSON.stringify(native),{status:kind==="429"?429:kind==="500"?500:200});});
 await processPrioritizedSol(f.port,f.source,f.task.run_id,"explicit_mock_key",http);await processPrioritizedSol(f.port,f.source,f.task.run_id,"explicit_mock_key",http);
 expect(http).toHaveBeenCalledTimes(1);expect(f.task.request_count).toBe(1);expect(f.read().state).not.toBe("completed");
 if(kind!=="timeout")expect(f.read().result?.raw_response_text).not.toBeNull();
 if(kind==="missing_usage"||kind==="timeout")expect(f.read().state).toBe("billing_uncertain");
});
it("failed save cannot cause another provider call",async()=>{
 const f=await prioritizedExecutionFixture();await f.authorize();const http=vi.fn(f.http);f.port.finish=async()=>false;
 await expect(processPrioritizedSol(f.port,f.source,f.task.run_id,"explicit_mock_key",http)).rejects.toThrow("NO_RETRY");
 await processPrioritizedSol(f.port,f.source,f.task.run_id,"explicit_mock_key",http);expect(http).toHaveBeenCalledTimes(1);
});
it("task binding altered after reservation blocks dispatch",async()=>{
 const f=await prioritizedExecutionFixture();await f.authorize();const claim=f.port.claim;f.port.claim=async(r,w)=>{const t=await claim(r,w);if(t)t.request_sha256="changed";return t;};
 const http=vi.fn(f.http);await processPrioritizedSol(f.port,f.source,f.task.run_id,"explicit_mock_key",http);expect(http).not.toHaveBeenCalled();expect(f.read().state).toBe("blocked_incompatible");
});
it("migration never creates consent/run/task or starts a provider, old history untouched",()=>{
 const sql=readFileSync("supabase/migrations/20261014125455_jls_prioritized_delegated_execution.sql","utf8");
 expect(sql).not.toContain("select public.jls_pri_authorize(");expect(sql).not.toContain("cron.schedule(");
 expect(sql).toContain("security invoker");expect(sql).toContain("request_count in(0,1)");
 expect(sql).not.toMatch(/update public.analysis_jev_luna_sol_(runs|tasks|results|plans)/i);
});
