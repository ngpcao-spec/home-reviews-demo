import {currentReportProtocol} from '../_shared/current-report-v2.ts';
import {verifyParallelProtocol,CURRENT_V2} from '../_shared/parallel-report.ts';
import {rehearseParallel} from '../_shared/parallel-report-probe.ts';
import type {HistoricalJob} from '../_shared/historical-report-worker.ts';
const assert=(v:unknown)=>{if(!v)throw Error('ASSERT_FAILED');};
Deno.test('current V2 shared worker: no network, current source binding and one mock Sol attempt',async()=>{
 const org=crypto.randomUUID(),est=crypto.randomUUID(),reviews=Array.from({length:7},(_,i)=>({id:crypto.randomUUID(),rating:5,original_text:i===6?'':`EXPLICIT SYNTHETIC ${i}: helpful service and tasty food.`,analysis_text:i===6?'':`EXPLICIT SYNTHETIC ${i}: helpful service and tasty food.`,analysis_source:'original_en',analysis_language:'en',original_language:'en',review_context:null,review_detailed_rating:null,published_at:null}));
 const run={id:crypto.randomUUID(),generation_id:crypto.randomUUID(),engine:'jev_sol_v2',request_id:crypto.randomUUID(),requested_by:crypto.randomUUID(),organization_id:org,establishment_id:est,language:'vi',status:'running',snapshot:{reviews,base:{organization_id:org,establishment_id:est,stored_reviews_count:7,source_fingerprint:'synthetic'}}} as unknown as HistoricalJob;
 const p=await currentReportProtocol(run);await verifyParallelProtocol(p.body,p.sha256);assert(p.body.current_delivery?.version===CURRENT_V2);assert(p.body.max_luna_calls===0);
 const result=await rehearseParallel({...p,id:crypto.randomUUID()});assert(result.mock_jev===6&&result.mock_sol===1&&result.provider_calls===0);assert(result.operation.result?.production_enabled===true);
});
