import {prepareDirectReport,DIRECT_SYNTHESIS_VERSION} from '../supabase/functions/_shared/jev-direct-report-preparation.ts';
globalThis.fetch=()=>{throw Error('ALL_PROVIDER_NETWORK_FORBIDDEN');};
const [inputPath,outputPath,code,profile]=Deno.args;
if(!inputPath||!outputPath||inputPath===outputPath)throw Error('DISTINCT_PRIVATE_INPUT_OUTPUT_REQUIRED');
const exported=JSON.parse((await Deno.readTextFile(inputPath)).replace(/^\uFEFF/,'')),input=exported.rows?.[0]?.input??exported;
if(profile!==undefined&&profile!==DIRECT_SYNTHESIS_VERSION)throw Error('DIRECT_REPORT_SYNTHESIS_VERSION_INVALID');
const p=await prepareDirectReport(input,code,undefined,profile);
await Deno.writeTextFile(outputPath,JSON.stringify(p));
console.log(JSON.stringify({sha256:p.sha256,candidates:p.body.selection.candidates.length,selected:p.body.selection.selected.length,
 distinct_selected_reviews:p.body.selection.distinct_selected_reviews,coverage:p.body.selection.coverage,
 prior_requests_checked:p.body.compatibility.checked_requests,reused_verdicts:p.body.compatibility.reused_verdicts,
 max_jev_calls:p.body.max_jev_calls,max_luna_calls:p.body.max_luna_calls,luna_questions:p.body.luna_questions,max_sol_calls:p.body.max_sol_calls,
 sol_size:p.body.conditional_sol.measurement,provider_calls:0,consent:null,run:null}));
