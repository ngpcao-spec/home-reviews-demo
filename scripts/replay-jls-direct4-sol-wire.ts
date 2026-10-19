// Private SQL export must retain JSONB ordering through a state_json string.
// No supplier access, authorization or database write.
import {replaySavedDirect4Sol} from '../supabase/functions/_shared/jls-direct4-probe.ts';
globalThis.fetch=()=>{throw Error('PROVIDER_NETWORK_FORBIDDEN');};
const [input,output]=Deno.args;if(!input||!output||input===output)throw Error('DISTINCT_PRIVATE_PATHS_REQUIRED');
const data=JSON.parse((await Deno.readTextFile(input)).replace(/^\uFEFF/,''));
const state=JSON.parse(data.rows[0].input.state_json),result=await replaySavedDirect4Sol(state);
await Deno.writeTextFile(output,JSON.stringify(result));
console.log(JSON.stringify(result));
