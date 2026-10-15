import {it,expect,vi} from "vitest";
import {readyFixture} from "../fixtures/jls-sol-ready";
import {processReadySol} from "../../supabase/functions/_shared/jls-sol-ready-worker";
import {readFileSync} from "node:fs";
it("full durable path: exact request, atomic claim, raw receipt, separate validation, immutable saved result",async()=>{
 const f=await readyFixture(),http=vi.fn(f.http);
 const a=await processReadySol(f.port,f.state.operation.id,"mock",http);
 expect(a?.phase).toBe("raw_receipt_saved");expect(f.state.operation.result).toBeNull();expect(f.state.operation.receipt?.raw_response_text).toBeTruthy();
 expect(a?.provider_calls).toBe(0);expect(a?.mock_http_calls).toBe(1);
 const b=await processReadySol(f.port,f.state.operation.id,"mock",http);
 expect(b?.phase).toBe("validation_saved");expect(b?.tokenizer_misses).toBe(0);expect(f.state.operation.result?.validated_report).toBeTruthy();
 expect(f.state.operation.status).toBe("completed");
 await processReadySol(f.port,f.state.operation.id,"mock",http);expect(http).toHaveBeenCalledTimes(1);expect(f.state.operation.request_count).toBe(1);
},15000);
it("concurrent/repeated wakes make exactly one HTTP attempt",async()=>{
 const f=await readyFixture();await Promise.all(Array.from({length:8},()=>processReadySol(f.port,f.state.operation.id,"mock",f.http)));
 for(let i=0;i<3;i++)await processReadySol(f.port,f.state.operation.id,"mock",f.http);
 expect(f.calls()).toBe(1);expect(f.state.operation.result).toBeTruthy();
});
it.each(["permission","source","artifact","request","measurement"])("%s mismatch blocks before reservation and HTTP",async kind=>{
 const f=await readyFixture();if(kind==="permission")f.deny();if(kind==="source")f.incompatible();
 if(kind==="artifact")f.state.ready.body.plan.selected[0].quote+=" changed";
 if(kind==="request")f.state.ready.body.request_json+=" ";
 if(kind==="measurement")f.state.ready.body.measurement.guarded_input_tokens++;
 const http=vi.fn(f.http);await processReadySol(f.port,f.state.operation.id,"mock",http);expect(http).not.toHaveBeenCalled();expect(f.state.operation.request_count).toBe(0);
});
it("timeout/lost provider response is consumed and never retried",async()=>{
 const f=await readyFixture(),http=vi.fn(async()=>{throw Error("MOCK_TIMEOUT");});
 await processReadySol(f.port,f.state.operation.id,"mock",http);await processReadySol(f.port,f.state.operation.id,"mock",http);
 expect(http).toHaveBeenCalledTimes(1);expect(f.state.operation.status).toBe("billing_uncertain");
});
it("interruption after receipt resumes free validation only",async()=>{
 const f=await readyFixture();await processReadySol(f.port,f.state.operation.id,"mock",f.http);f.interrupt();
 await processReadySol(f.port,f.state.operation.id,"mock",f.http);expect(f.calls()).toBe(1);expect(f.state.operation.result).toBeTruthy();
});
it("ambiguous receipt save never allows a second paid dispatch",async()=>{
 const f=await readyFixture(),save=f.port.receive;f.port.receive=async(...args)=>{await save(...args);return false;};
 await processReadySol(f.port,f.state.operation.id,"mock",f.http);await processReadySol(f.port,f.state.operation.id,"mock",f.http);expect(f.calls()).toBe(1);
});
it.each(["invalid_json","wrong_model","missing_usage","refusal"])("%s raw response is retained without correction call",async kind=>{
 const f=await readyFixture();const http=async()=>{if(kind==="invalid_json")return new Response("{broken");
 const x=JSON.parse(await (await f.http("",{body:f.state.ready.body.request_json})).text());if(kind==="wrong_model")x.model="wrong";
 if(kind==="missing_usage")delete x.usage;if(kind==="refusal")x.output=[{type:"message",content:[{type:"refusal"}]}];return new Response(JSON.stringify(x));};
 await processReadySol(f.port,f.state.operation.id,"mock",http);await processReadySol(f.port,f.state.operation.id,"mock",http);
 expect(f.state.operation.receipt?.raw_response_text).toBeTruthy();expect(f.state.operation.result).toBeTruthy();expect(f.state.operation.status).not.toBe("completed");
});
it("shared SQL bounds paid calls, protects organizations and preserves both source runs",()=>{
 const sql=readFileSync("supabase/migrations/20261015090725_jls_sol_ready_receipt_validation.sql","utf8");
 expect(sql).toContain("claim_jls_restaurant_task");expect(sql).toContain("request_count in(0,1)");expect(sql).toContain("enable row level security");
 expect(sql).toContain("raw_response_sha256");expect(sql).toContain("authorize_jls_restaurant_pre_ready");expect(sql).toContain("request_count=1");
 expect(sql).not.toMatch(/update public.analysis_jls_restaurant_runs set status='(?:running|queued)'/);
 const followup=readFileSync("supabase/migrations/20261015093752_jls_sol_ready_frozen_source_checks.sql","utf8");
 expect(followup).toContain("old.status='received'");expect(followup).toContain("jls-restaurant-sol-ready-vi-v1");
});
