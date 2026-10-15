import {restaurantConfiguration,RESTAURANT_POLICY} from "../functions/_shared/jls-restaurant.ts";
import {hybridHash} from "../functions/_shared/jev-hybrid-evidence.ts";
import {editorialInstructions} from "../functions/_shared/jls-prioritized-editorial.ts";
Deno.test("offline configuration and bounded delegated scope, no monetary estimate",async()=>{
 const before=globalThis.fetch;globalThis.fetch=()=>{throw Error("PROVIDER_NETWORK_FORBIDDEN");};
 try{
  const a=await restaurantConfiguration(),b=await restaurantConfiguration();
  if(await hybridHash(a)!==await hybridHash(b)||a.policy.max_luna_calls!==32||a.policy.max_sol_calls!==1||
   a.policy.automatic_retry!==false||a.policy.provider_client_retries!==0||!a.policy.no_amount_confirmation||
   !a.policy.no_monetary_estimate||a.policy.language!=="vi")throw Error("CONFIG_INVALID");
  if(Object.keys(a.jev_request_template.questions).length!==25||RESTAURANT_POLICY.concurrency!==8)throw Error("JEV_CHANGED");
  if(!editorialInstructions("vi").includes("dish, ingredients")||!editorialInstructions("vi").includes("ALL themes"))throw Error("EDITORIAL_MISSING");
 }finally{globalThis.fetch=before;}
});

Deno.test("32k opt-in retains output reserve and complete request size without network",async()=>{
 const before=globalThis.fetch;globalThis.fetch=()=>{throw Error("NETWORK_FORBIDDEN");};
 try{const {SOL_SIZE_POLICY,solRequestSize}=await import("../functions/_shared/jls-sol-size.ts");
 const m=solRequestSize({model:"gpt-6.1-sol",max_output_tokens:9500,input:[{role:"system",content:"instructions"},{role:"user",content:"word ".repeat(21000)}]});
 if(m.guarded_input_tokens<=20000||m.guarded_input_tokens>32768||m.output_reserved_tokens!==9500||SOL_SIZE_POLICY.provider_timeout_ms>=150000)throw Error("ENVELOPE_INVALID");
 }finally{globalThis.fetch=before;}
});
