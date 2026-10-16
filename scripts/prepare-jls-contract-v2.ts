import {prepareContractV2} from "../supabase/functions/_shared/jls-contract-v2-preparation.ts";
const [input,output,commit]=Deno.args;
globalThis.fetch=()=>{throw Error("PROVIDER_NETWORK_BLOCKED");};
const s=JSON.parse(await Deno.readTextFile(input));
const prepared=await prepareContractV2(s.source,s.archive,commit);
await Deno.writeTextFile(output,JSON.stringify(prepared));
console.log(JSON.stringify({sha256:prepared.sha256,reused:prepared.body.reused_decisions.length,
 branches:prepared.body.branches.map(b=>({assumption:b.assumption,gate:b.gate,measurement:b.draft.measurement})),new_paid_calls:0}));
