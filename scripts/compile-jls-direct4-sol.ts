// Future authorized operation only: reads a PRIVATE frozen state export and
// compiles the final request locally. Never calls a provider or writes to Supabase.
import {compileDirect4Ready} from '../supabase/functions/_shared/jls-direct4-execution.ts';
globalThis.fetch=()=>{throw Error('PROVIDER_NETWORK_FORBIDDEN');};
const [input,output]=Deno.args;if(!input||!output||input===output)throw Error('DISTINCT_PRIVATE_PATHS_REQUIRED');
const data=JSON.parse(await Deno.readTextFile(input)),compiled=await compileDirect4Ready(data.state,data.preparation);
await Deno.writeTextFile(output,JSON.stringify(compiled));
console.log(JSON.stringify({gate:compiled.gate,ready_sha256:compiled.artifact?.sha256??null,provider_calls:0}));
