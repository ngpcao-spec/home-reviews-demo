// Private offline preparation and end-to-end injected-provider qualification.
import {prepareHistoricalDirect4} from '../supabase/functions/_shared/jls-direct4-historical.ts';
import {rehearseHistoricalDirect4} from '../supabase/functions/_shared/jls-direct4-historical-probe.ts';
globalThis.fetch=()=>{throw Error('PROVIDER_NETWORK_FORBIDDEN');};
const [inputPath,outputPath,code]=Deno.args;
if(!inputPath||!outputPath||inputPath===outputPath)throw Error('DISTINCT_PRIVATE_PATHS_REQUIRED');
const exported=JSON.parse((await Deno.readTextFile(inputPath)).replace(/^\uFEFF/,'')),input=exported.rows[0].input;
const protocol=await prepareHistoricalDirect4(input,code),replay=await rehearseHistoricalDirect4({...protocol,id:'EXPLICIT_MOCK_PROTOCOL'});
await Deno.writeTextFile(outputPath,JSON.stringify({protocol,...replay}));
console.log(JSON.stringify({protocol_sha256:protocol.sha256,configuration_sha256:protocol.body.classification_configuration_sha256,
 denominators:protocol.body.denominators,pending:protocol.body.pending.length,existing_cache_reused:0,
 requested_model:protocol.body.configuration.jev.requested_model,native_choices:Object.keys(protocol.body.configuration.jev.questions.service.criteria),
 provider_calls:0,consent:null,paid_run:null,qualification:replay.qualification}));
