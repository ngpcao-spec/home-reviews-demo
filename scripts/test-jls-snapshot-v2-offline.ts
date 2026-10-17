// Run with --cached-only --allow-read; network is not granted.
import {snapshotMockPort,snapshotReadyMock} from "../supabase/functions/_shared/jls-snapshot-v2-probe.ts";
import {processRestaurant} from "../supabase/functions/_shared/jls-restaurant-worker.ts";
import {processReadySol} from "../supabase/functions/_shared/jls-sol-ready-worker.ts";
import {verifySnapshotV2,verifySnapshotReady,snapshotExecutionContract,snapshotReadyContract} from "../supabase/functions/_shared/jls-snapshot-v2.ts";
import {hybridHash} from "../supabase/functions/_shared/jev-hybrid-evidence.ts";
globalThis.fetch=()=>Promise.reject(Error("ALL_NETWORK_FORBIDDEN"));
const source=JSON.parse(await Deno.readTextFile(Deno.args[0])),passed:string[]=[];
function assert(ok:unknown,why:string){if(!ok)throw Error(why);}
async function check(name:string,fn:()=>Promise<void>){await fn();passed.push(name);}
await check("source changed fails before reservation",async()=>{
 const f=snapshotMockPort(source.inputs.jev.state,[]);f.state.protocol.body.snapshot.source.reviews[0].original_text+=" changed";
 await processRestaurant(f.port,f.state.run.id,{jev:"mock",openai:"mock"},f.http,snapshotExecutionContract);
 assert(f.state.run.status==="blocked"&&!f.calls.length,"SOURCE_NOT_BLOCKED");
});
await check("invalid authority cannot acquire lease",async()=>{
 const f=snapshotMockPort(source.inputs.jev.state,[]);f.deny();await processRestaurant(f.port,f.state.run.id,{jev:"mock",openai:"mock"},f.http,snapshotExecutionContract);
 assert(!f.calls.length,"AUTH_BYPASSED");
});
await check("concurrent wakes reserve at most one batch",async()=>{
 const f=snapshotMockPort(source.inputs.jev.state,[]);
 await Promise.all(Array.from({length:3},()=>processRestaurant(f.port,f.state.run.id,{jev:"mock",openai:"mock"},f.http,snapshotExecutionContract)));
 assert(f.calls.length===8&&f.state.tasks.every(t=>t.request_count<=1),"DUPLICATE_BATCH");
});
await check("interrupted dispatched task is never sent twice",async()=>{
 const f=snapshotMockPort(source.inputs.jev.state,[]);f.state.tasks[0].status="running";f.state.tasks[0].request_count=1;
 await processRestaurant(f.port,f.state.run.id,{jev:"mock",openai:"mock"},f.http,snapshotExecutionContract);
 assert(f.state.tasks[0].status==="running"&&f.state.tasks[0].request_count===1,"DISPATCHED_RESET");
});
await check("failed provider attempt blocks with zero retry",async()=>{
 const f=snapshotMockPort(source.inputs.jev.state,[]);let calls=0;const http:typeof fetch=()=>{calls++;return Promise.reject(Error("MOCK_NETWORK_ERROR"));};
 for(let i=0;i<3;i++)await processRestaurant(f.port,f.state.run.id,{jev:"mock",openai:"mock"},http,snapshotExecutionContract);
 assert(calls===8&&f.state.run.status==="blocked"&&f.state.tasks.every(t=>t.request_count<=1),"RETRIED_FAILED_BATCH");
});
await check("quotes and Luna artifacts cannot change",async()=>{
 const f=snapshotMockPort(source.inputs.luna.state,source.inputs.luna.cache);f.state.artifacts[0].body.changed=true;
 await processRestaurant(f.port,f.state.run.id,{jev:"mock",openai:"mock"},f.http,snapshotExecutionContract);
 assert(f.state.run.status==="blocked"&&!f.calls.length,"ARTIFACT_CHANGED");
});
await check("Sol request modified fails before reservation",async()=>{
 const f=snapshotReadyMock(source.inputs.sol);f.state.ready.body.request_json+=" ";
 const out=await processReadySol(f.port,f.state.operation.id,"mock",f.http,snapshotReadyContract);
 assert(!f.calls.length&&!!out.error_code,"REQUEST_NOT_BOUND");
});
await check("Sol concurrent dispatch and repeated validation never resends",async()=>{
 const f=snapshotReadyMock(source.inputs.sol);
 await Promise.all(Array.from({length:3},()=>processReadySol(f.port,f.state.operation.id,"mock",f.http,snapshotReadyContract)));
 await processReadySol(f.port,f.state.operation.id,"mock",f.http,snapshotReadyContract);
 await processReadySol(f.port,f.state.operation.id,"mock",f.http,snapshotReadyContract);
 assert(f.calls.length===1&&!!f.state.operation.result?.validated_report,"SOL_DUPLICATED_OR_NOT_SAVED "+JSON.stringify({calls:f.calls.length,status:f.state.operation.status,error:f.state.operation.result?.error}));
});
await check("lost Sol response is uncertain and never retried",async()=>{
 const f=snapshotReadyMock(source.inputs.sol);let calls=0;
 const http:typeof fetch=()=>{calls++;return Promise.reject(Error("MOCK_TIMEOUT"));};
 for(let i=0;i<3;i++)await processReadySol(f.port,f.state.operation.id,"mock",http,snapshotReadyContract);
 assert(calls===1&&f.state.operation.status==="billing_uncertain","LOST_RESPONSE_RETRIED");
});
await check("invalid Sol output saved without correction call",async()=>{
 const f=snapshotReadyMock(source.inputs.sol);let calls=0;const http:typeof fetch=()=>{calls++;return Promise.resolve(new Response("not JSON"));};
 for(let i=0;i<3;i++)await processReadySol(f.port,f.state.operation.id,"mock",http,snapshotReadyContract);
 assert(calls===1&&f.state.operation.receipt?.raw_response_text==="not JSON"&&f.state.operation.status==="invalid_output","INVALID_RESPONSE_LOST");
});
await check("same prepared protocol reproducibly verifies",async()=>{
 const p=source.inputs.sol.protocol;await verifySnapshotV2(p.body,p.sha256);await verifySnapshotReady(p.body,p.sha256,source.inputs.sol.ready);
 assert(await hybridHash(p.body)===p.sha256,"PROTOCOL_NON_REPRODUCIBLE");
});
console.log(JSON.stringify({passed:passed.length,checks:passed,provider_calls:0,paid_runs_created:0,consents_created:0}));
