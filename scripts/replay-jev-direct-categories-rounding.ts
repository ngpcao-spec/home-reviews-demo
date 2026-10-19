// Run with --deny-net --allow-read --allow-write. Writes a private local artifact only.
import {replayDirectSavedArchive} from '../supabase/functions/_shared/jev-direct-categories-replay.ts';
globalThis.fetch=()=>{throw Error('ALL_PROVIDER_NETWORK_FORBIDDEN');};
const [input,output,commit]=Deno.args;
if(!input||!output||input===output)throw Error('DISTINCT_PRIVATE_INPUT_AND_OUTPUT_REQUIRED');
const exported=JSON.parse(await Deno.readTextFile(input)),source=exported.rows?.[0]??exported;
if(source.id!=='85683890-8cf2-4dbd-8531-5d18b5acdaab'||
 source.sha256!=='123950779163129d0bad1ed921aa4862d73068c1de62e02d5d6e473de6475771')throw Error('WRONG_SOURCE_ARCHIVE');
const replay=await replayDirectSavedArchive(source,commit);
await Deno.writeTextFile(output,JSON.stringify(replay));
console.log(JSON.stringify({sha256:replay.sha256,parser_version:replay.body.parser_version,
 usable:replay.body.counts.received_results,recovered:replay.body.recovered_review_ids,
 categories:Object.fromEntries(Object.entries(replay.body.counts.categories).map(([k,v])=>[k,v.exclusive])),
 diagnostics:replay.body.probability_diagnostics.length,remaining_anomalies:replay.body.remaining_anomalies,
 uncertainties:replay.body.uncertainties,new_provider_calls:0}));
