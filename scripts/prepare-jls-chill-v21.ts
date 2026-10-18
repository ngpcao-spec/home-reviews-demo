import {prepareChillV21} from "../supabase/functions/_shared/jls-chill-v21-preparation.ts";
const [input,output,commit]=Deno.args;
globalThis.fetch=()=>{throw Error("PROVIDER_NETWORK_BLOCKED");};
const s=JSON.parse(await Deno.readTextFile(input)),prepared=await prepareChillV21(s.source,s.archive,commit);
await Deno.writeTextFile(output,JSON.stringify(prepared));
console.log(JSON.stringify({sha256:prepared.sha256,reused:prepared.body.reused_decisions.length,provider_calls:0,
 branches:prepared.body.branches.map(b=>({assumption:b.assumption,gate:b.gate,measurement:b.draft.measurement}))}));
