import {prepareTargetedJev,verifyTargetedJev,type TargetCriteria,type TargetBaseline} from '../supabase/functions/_shared/jev-boundaries-targeted-protocol.ts';
globalThis.fetch=()=>{throw Error('PROVIDER_NETWORK_FORBIDDEN');};
const [sourcePath,criteriaPath,baselinePath,outputPath]=Deno.args;
const source=JSON.parse(await Deno.readTextFile(sourcePath)),criteria=JSON.parse(await Deno.readTextFile(criteriaPath)) as TargetCriteria,
 baseline=JSON.parse(await Deno.readTextFile(baselinePath)) as TargetBaseline[];
const protocol=await prepareTargetedJev(source,criteria,baseline);await verifyTargetedJev(protocol);
await Deno.writeTextFile(outputPath,JSON.stringify(protocol));
console.log(JSON.stringify({version:protocol.body.version,sha256:protocol.sha256,criteria_sha256:protocol.body.criteria_sha256,
 reviews:protocol.body.reviews.length,theme_results:protocol.body.expected_theme_results,max_jev_calls:protocol.body.policy.max_jev_calls,
 supplier_calls:0,spending_authorization:null,run_id:null}));
