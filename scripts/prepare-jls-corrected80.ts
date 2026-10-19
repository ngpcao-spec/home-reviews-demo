// Offline only. No paid transport, no consent/run creation. Outputs stay local.
import {prepareCorrectedReport} from '../supabase/functions/_shared/jls-corrected80-preparation.ts';
globalThis.fetch=()=>{throw Error('ALL_PROVIDER_NETWORK_FORBIDDEN');};
const [input,output,commit]=Deno.args;
const data=JSON.parse(await Deno.readTextFile(input));data.code_provenance=commit;
const p=await prepareCorrectedReport(data);
await Deno.writeTextFile(output,JSON.stringify(p));
console.log(JSON.stringify({sha256:p.sha256,dataset:p.body.dataset_id,statistics_sha256:p.body.statistics_sha256,
 reused:p.body.reused_verdicts.length,new_luna_requests:p.body.pending_groups.length,
 new_luna_questions:p.body.pending_groups.reduce((n,g)=>n+g.evidence_ids.length,0),max_sol_calls:1,provider_calls:0}));
