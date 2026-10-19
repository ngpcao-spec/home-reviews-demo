// Invoked by Codex's authenticated delegated workflow between server stages.
import {compileSnapshotEvidence,compileSnapshotSol} from "../supabase/functions/_shared/jls-snapshot-v2.ts";
import {hybridHash} from "../supabase/functions/_shared/jev-hybrid-evidence.ts";
import {HISTORICAL_DIRECT4,FROZEN_CORPUS_DIRECT4,compileHistoricalDirect4Evidence,compileHistoricalDirect4Sol} from "../supabase/functions/_shared/jls-direct4-historical.ts";
import {DIRECT4_COMPARISON,compileDirect4ComparisonSol} from '../supabase/functions/_shared/jls-direct4-comparison.ts';
globalThis.fetch=()=>Promise.reject(Error("ALL_PROVIDER_NETWORK_FORBIDDEN"));
const [input,output]=Deno.args;if(!input||!output)throw Error("INPUT_OUTPUT_REQUIRED");
const s=JSON.parse(await Deno.readTextFile(input));let body;
if(s.state.protocol.body.version===DIRECT4_COMPARISON){
 if(s.state.run.stage!=='prepare_sol')throw Error('FREE_PREPARATION_STAGE_INVALID');
 body=(await compileDirect4ComparisonSol(s.state)).body;
}
else if([HISTORICAL_DIRECT4,FROZEN_CORPUS_DIRECT4].includes(s.state.protocol.body.version)){
 if(s.state.run.stage==='prepare_evidence')body=await compileHistoricalDirect4Evidence(s.state);
 else if(s.state.run.stage==='prepare_sol')body=(await compileHistoricalDirect4Sol(s.state)).body;
 else throw Error('FREE_PREPARATION_STAGE_INVALID');
}
else if(s.state.run.stage==="prepare_evidence")body=await compileSnapshotEvidence(s.state.protocol.body,s.state.protocol.sha256,s.cache);
else if(s.state.run.stage==="prepare_sol")body=(await compileSnapshotSol(s.state)).body;
else throw Error("FREE_PREPARATION_STAGE_INVALID");
await Deno.writeTextFile(output,JSON.stringify({stage:s.state.run.stage,body,sha256:await hybridHash(body)}));
console.log(JSON.stringify({stage:s.state.run.stage,sha256:await hybridHash(body),provider_calls:0}));
