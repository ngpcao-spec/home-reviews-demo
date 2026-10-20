// Preparation and full rehearsal only, run with --deny-net. The 36 existing
// native replies are real; all 51 new JEV / Luna / Sol replies are explicit mocks.
import {preparePartialDirect4,verifyHistoricalDirect4} from '../functions/_shared/jls-direct4-historical.ts';
import {rehearseHistoricalDirect4} from '../functions/_shared/jls-direct4-historical-probe.ts';
import {directHash,directCategoryCounts} from '../functions/_shared/jev-direct-categories.ts';
import type {RestaurantState} from '../functions/_shared/jls-restaurant-worker.ts';
globalThis.fetch=()=>Promise.reject(Error('PROVIDER_NETWORK_FORBIDDEN'));
const data=JSON.parse(await Deno.readTextFile(Deno.args[0])),source:RestaurantState=data.state??data;
const before=await directHash(source),fix={id:'fdb19482-a9c8-45b7-b4bd-4e3e610d931c',sha256:'455fd6dceea1787b7a5986c6804ab6bd2ee8c80940c0c3c70b91a0bd8bcc4ee3'};
const prepared=await preparePartialDirect4(source,fix,Deno.args[2]);
if(prepared.body.pending.length!==51||prepared.body.continuation?.reused.length!==36||prepared.body.continuation.missing.length!==4||before!==await directHash(source))throw Error('PARTIAL_SCOPE_CHANGED');
const rehearsal=await rehearseHistoricalDirect4({...prepared,id:'EXPLICIT_MOCK_PROTOCOL'});
const prep=(rehearsal.fixtures.luna as {state:RestaurantState}).state.artifacts.find(a=>a.kind==='direct4_report_preparation')!.body as unknown as import('../functions/_shared/jev-direct-report-preparation.ts').DirectReportPreparation;
const scope=prep.body.statistics.scope;
if(scope.source_reviews!==100||scope.analysed_text_reviews!==87||scope.textless_statistics_only!==9||scope.technical_missing_reviews!==4||
 prep.body.statistics.counts.total_reviews!==87||Object.values(prep.body.statistics.counts.categories).some(c=>c.exclusive.unavailable!==0)||
 !prep.body.conditional_sol.prompt.includes('4 additional textual reviews')||!prep.body.conditional_sol.packet.methodology_vi.includes('thiếu kết quả'))throw Error('PARTIAL_COVERAGE_CHANGED');
for(const kind of ['redispatch','invent_result','source','reuse'] as const){
 const p=structuredClone(prepared.body),c=p.continuation!;
 if(kind==='redispatch'){p.pending.push(c.original_pending.find(t=>(t as {review_id:string}).review_id===c.missing[0].review_id) as typeof p.pending[number]);p.pending_sha256=await directHash(p.pending);p.max_jev_calls++;}
 if(kind==='invent_result')c.missing[0].result={} as never;
 if(kind==='source')(c.missing[0].source as {analysis_text:string}).analysis_text='CHANGED';
 if(kind==='reuse')c.reused[0].body.raw_response_text='CHANGED';
 let rejected=false;try{await verifyHistoricalDirect4(p,await directHash(p));}catch{rejected=true;}if(!rejected)throw Error('PARTIAL_TAMPER_ACCEPTED_'+kind);
}
const actualRows=prepared.body.continuation!.reused.map(r=>({review_id:r.review_id,result:r.body.direct4_result as import('../functions/_shared/jev-direct-categories.ts').DirectCategoryResult}));
const actual_counts=directCategoryCounts(actualRows.map(r=>r.review_id),actualRows);
await Deno.writeTextFile(Deno.args[1],JSON.stringify({prepared,rehearsal,actual_counts,actual_results:36,provider_calls:0,paid_consent_created:false,paid_run_created:false}));
console.log(JSON.stringify({prepared_sha256:prepared.sha256,reused:36,excluded_unknown:4,new_jev_max:51,luna_max:32,sol_max:1,
 mock_full_path:rehearsal.qualification,scope,actual_available_statistics_denominator:actual_counts.total_reviews,provider_calls:0}));
