// Free compiler/probe fixtures only. No credentials, HTTP, consent or paid queue.
import {direct4Protocol} from '../supabase/functions/_shared/jls-direct4-execution.ts';
import {prepareDirect4WorkerMocks} from '../supabase/functions/_shared/jls-direct4-probe.ts';
import {directHash} from '../supabase/functions/_shared/jev-direct-categories.ts';
globalThis.fetch=()=>{throw Error('PROVIDER_NETWORK_FORBIDDEN');};
const [preparedPath,authority,commit,protocolId,output]=Deno.args;
const p=JSON.parse(await Deno.readTextFile(preparedPath)),protocol=await direct4Protocol(p,authority,commit);
const fixtures=await prepareDirect4WorkerMocks(p,{...protocol,id:protocolId});
await Deno.writeTextFile(output,JSON.stringify({protocol,fixtures,provider_calls:0,sha256:await directHash(fixtures)}));
console.log(JSON.stringify({protocol_sha256:protocol.sha256,provider_calls:0,qualification:fixtures.qualification}));
