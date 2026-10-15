import {processReadySol,type ReadyPort,type ReadyState} from "../functions/_shared/jls-sol-ready-worker.ts";
import {SOL_READY_POLICY} from "../functions/_shared/jls-sol-ready.ts";
function assert(x:unknown){if(!x)throw Error("assertion");}
Deno.test("Sol-only scope is bounded, no retries and raw-before-validation",()=>{
 assert(SOL_READY_POLICY.max_sol_calls===1&&SOL_READY_POLICY.max_luna_calls===0&&SOL_READY_POLICY.max_jev_calls===0);
 assert(SOL_READY_POLICY.raw_receipt_before_validation&&SOL_READY_POLICY.dispatch_tokenizations===0&&!SOL_READY_POLICY.automatic_retry);
});
Deno.test("already recorded result cannot dispatch, even after repeated wakes",async()=>{
 const load=()=>Promise.resolve({operation:{status:"completed"}} as ReadyState);
 const unexpected=()=>Promise.reject(Error("UNEXPECTED_TERMINAL_OPERATION"));
 const port:ReadyPort={load,active:unexpected,compatible:unexpected,claim:unexpected,receive:unexpected,finish:unexpected,abort:unexpected};let calls=0;
 for(let i=0;i<3;i++){const r=await processReadySol(port,"explicit_mock","mock",()=>{calls++;throw Error("NETWORK_FORBIDDEN");});assert(r?.provider_calls===0);}
 assert(calls===0);
});
