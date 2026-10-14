import {prioritizedExecutionFixture} from "../../tests/fixtures/jls-prioritized-execution.ts";
import {processPrioritizedSol} from "../functions/_shared/jls-prioritized-worker.ts";
const assert=(x:unknown)=>{if(!x)throw Error("ASSERT_FAILED");};
Deno.test("no GO: zero mock HTTP; explicit mock GO: one reservation across concurrent wakes",async()=>{
 const f=await prioritizedExecutionFixture();let calls=0;const http:typeof fetch=(...a)=>{calls++;return f.http(...a);};
 await processPrioritizedSol(f.port,f.source,f.task.run_id,"explicit_mock_key",http);assert(calls===0);
 await f.authorize();await Promise.all(Array.from({length:8},()=>processPrioritizedSol(f.port,f.source,f.task.run_id,"explicit_mock_key",http)));
 assert(calls===1&&f.task.request_count===1&&f.read().state==="completed");
});
Deno.test("timeout consumed once, no correction or retry call",async()=>{
 const f=await prioritizedExecutionFixture();await f.authorize();let calls=0;const http:typeof fetch=()=>{calls++;return Promise.reject(Error("timeout"));};
 await processPrioritizedSol(f.port,f.source,f.task.run_id,"explicit_mock_key",http);
 await processPrioritizedSol(f.port,f.source,f.task.run_id,"explicit_mock_key",http);assert(calls===1&&f.read().state==="billing_uncertain");
});
