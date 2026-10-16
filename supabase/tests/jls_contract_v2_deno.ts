import {CONTRACT_V2_POLICY} from "../functions/_shared/jls-contract-v2-preparation.ts";
import {processContractV2,type ContractPort,type ContractState} from "../functions/_shared/jls-contract-v2-worker.ts";
Deno.test("one Luna, one Sol; no other provider or retry",()=>{const p=CONTRACT_V2_POLICY;if(p.max_luna_calls!==1||p.max_sol_calls!==1||p.max_jev_calls!==0||p.apify_calls!==0||p.automatic_retry||p.provider_client_retries!==0)throw Error("policy");});
Deno.test("terminal work cannot reach a transport without network permissions",async()=>{
 const bad=()=>{throw Error("UNEXPECTED_WORK");},port:ContractPort={load:()=>Promise.resolve({operation:{mode:"mock",status:"completed",phase:"luna"}} as ContractState),active:bad,compatible:bad,claim:bad,receive:bad,finishLuna:bad,finishSol:bad,abort:bad};
 for(let i=0;i<4;i++)if((await processContractV2(port,"mock","mock",bad))?.provider_calls!==0)throw Error("redispatch");
});
