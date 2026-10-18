import {CONTRACT_V2_POLICY} from "../functions/_shared/jls-contract-v2-preparation.ts";
import {processContractV2,type ContractPort,type ContractState} from "../functions/_shared/jls-contract-v2-worker.ts";
import {CHILL_V21_POLICY,chillV21Expected} from "../functions/_shared/jls-chill-v21-preparation.ts";
Deno.test("Chill V2.1 keeps the archived prompt and a single targeted verification",async()=>{
 if(CHILL_V21_POLICY.max_jev_calls!==0||CHILL_V21_POLICY.max_luna_calls!==1||CHILL_V21_POLICY.max_questions!==1||CHILL_V21_POLICY.max_sol_calls!==1||
  (await chillV21Expected()).prompt_sha256!=="e1f45fc531b8d820b03c195fa8c8c6b683e897a139c89c9c74a58776df4d53f0")throw Error("CHILL_SCOPE_CHANGED");
});
Deno.test("one Luna, one Sol; no other provider or retry",()=>{const p=CONTRACT_V2_POLICY;if(p.max_luna_calls!==1||p.max_sol_calls!==1||p.max_jev_calls!==0||p.apify_calls!==0||p.automatic_retry||p.provider_client_retries!==0)throw Error("policy");});
Deno.test("terminal work cannot reach a transport without network permissions",async()=>{
 const bad=()=>{throw Error("UNEXPECTED_WORK");},port:ContractPort={load:()=>Promise.resolve({operation:{mode:"mock",status:"completed",phase:"luna"}} as ContractState),active:bad,compatible:bad,claim:bad,receive:bad,finishLuna:bad,finishSol:bad,abort:bad};
 for(let i=0;i<4;i++)if((await processContractV2(port,"mock","mock",bad))?.provider_calls!==0)throw Error("redispatch");
});
