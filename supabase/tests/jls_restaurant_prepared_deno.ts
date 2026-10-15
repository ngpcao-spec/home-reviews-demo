import {attachPlanTokenMemo,tokenCertificate} from "../functions/_shared/jls-token-memo.ts";
import {SOL_SIZE_POLICY,solRequestSize} from "../functions/_shared/jls-sol-size.ts";
import {PREPARED_POLICY} from "../functions/_shared/jls-restaurant-prepared.ts";
Deno.test("prepared memo is isolated, sealed and hash checked, no network",async()=>{
 const before=globalThis.fetch;globalThis.fetch=()=>{throw Error("PROVIDER_FORBIDDEN");};
 try{const p={},m=await attachPlanTokenMemo(p);const q={model:"gpt-6.1-sol",max_output_tokens:9500,input:[{role:"user",content:"synthetic"}]};
 const first=solRequestSize(q,SOL_SIZE_POLICY,m.count),cert=await tokenCertificate(p),sealed=await attachPlanTokenMemo(p,cert,true);
 if(solRequestSize(q,SOL_SIZE_POLICY,sealed.count).guarded_input_tokens!==first.guarded_input_tokens||sealed.misses!==0)throw Error("MEMO_CHANGED");
 try{sealed.count("unmeasured");throw Error("MISS_ALLOWED");}catch(e){if((e as Error).message!=="JLS_TOKEN_MEASUREMENT_MISSING")throw e;}
 if(PREPARED_POLICY.maximum_stages_per_wake!==1||!PREPARED_POLICY.phases.includes("prepare_sol"))throw Error("FREE_STAGE_MISSING");
 }finally{globalThis.fetch=before;}
});
