import {delegatedMockFixture} from "../../tests/fixtures/jev-luna-sol-delegated.ts";
import {processDelegatedJls} from "../functions/_shared/jev-luna-sol-executor.ts";
import {executionCosts,evidenceSufficiency} from "../functions/_shared/jev-luna-sol-delegation.ts";
const assert=(x:unknown)=>{if(!x)throw new Error("ASSERT_FAILED");};
Deno.test("mock-only durable 24+1 calls, no repeated attempt",async()=>{
 const f=await delegatedMockFixture();let count=0;
 const http:typeof fetch=(...args)=>{count++;return f.http(...args);};
 for(let i=0;i<6;i++)await processDelegatedJls(f.port,f.p,f.snapshot,"explicit_mock_run","explicit_mock_key",http);
 assert(count===25);assert(f.tasks.every(t=>t.request_count===1));assert(f.read().completed);
});
Deno.test("failed Luna blocks Sol and missing telemetry remains unknown",async()=>{
 const f=await delegatedMockFixture();let count=0;
 const http:typeof fetch=()=>{count++;return Promise.reject(new Error("timeout"));};
 for(let i=0;i<3;i++)await processDelegatedJls(f.port,f.p,f.snapshot,"explicit_mock_run","explicit_mock_key",http);
 assert(count===4);assert(!f.tasks.some(t=>t.phase==="sol"));assert(executionCosts(f.tasks).total_cost_usd===null);
 assert(!evidenceSufficiency(f.p,[],false).passed);
});
