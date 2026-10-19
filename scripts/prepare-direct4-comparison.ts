// Explicit FREE compilation. No connector, credentials, consent or execution.
import {prepareDirect4Comparison} from '../supabase/functions/_shared/jls-direct4-comparison.ts';
import {rehearseDirect4Comparison} from '../supabase/functions/_shared/jls-direct4-comparison-probe.ts';
globalThis.fetch=()=>{throw Error('ALL_PROVIDER_NETWORK_FORBIDDEN');};
const [sourcePath,outputPath,authority,commit,protocolId='EXPLICIT_MOCK_PROTOCOL']=Deno.args;
if(!sourcePath||!outputPath||sourcePath===outputPath)throw Error('DISTINCT_PRIVATE_FILES_REQUIRED');
const source=JSON.parse(await Deno.readTextFile(sourcePath)),protocol=await prepareDirect4Comparison(source,authority,commit),
 rehearsal=await rehearseDirect4Comparison({...protocol,id:protocolId});
await Deno.writeTextFile(outputPath,JSON.stringify({protocol,...rehearsal}));
console.log(JSON.stringify({sha256:protocol.sha256,reused:protocol.body.reused_evidence_ids.length,
 new_luna_questions:protocol.body.new_luna_questions,new_luna_requests:protocol.body.max_luna_calls,max_sol_calls:1,
 qualification:rehearsal.qualification,provider_calls:0}));
