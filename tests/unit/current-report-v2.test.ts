import {it,expect,vi,afterEach} from 'vitest';
import {currentReportProtocol,processCurrentReportPreparation} from '../../supabase/functions/_shared/current-report-v2';
import {verifyParallelProtocol,CURRENT_V2} from '../../supabase/functions/_shared/parallel-report';
import {shortJev} from '../../supabase/functions/_shared/direct4-short-comparison';
import {rehearseParallel} from '../../supabase/functions/_shared/parallel-report-probe';
import {directHash} from '../../supabase/functions/_shared/jev-direct-categories';
import type {HistoricalJob} from '../../supabase/functions/_shared/historical-report-worker';
const id=()=>crypto.randomUUID();
function fixture(){const org=id(),est=id();const reviews=Array.from({length:7},(_,i)=>({id:id(),rating:5,original_text:i===6?'':`SYNTHETIC review ${i} helpful staff and tasty food.`,text:i===6?'':`SYNTHETIC review ${i} helpful staff and tasty food.`,analysis_text:i===6?'':`SYNTHETIC review ${i} helpful staff and tasty food.`,analysis_source:'original_en',analysis_language:'en',original_language:'en',review_context:null,review_detailed_rating:null,published_at:null}));
 return {id:id(),generation_id:id(),engine:'jev_sol_v2',request_id:id(),requested_by:id(),organization_id:org,establishment_id:est,language:'vi',status:'running',created_at:new Date().toISOString(),cursor:0,snapshot:{analysis_version:8,reviews,base:{organization_id:org,establishment_id:est,preferred_language:'vi',stored_reviews_count:7,source_fingerprint:'fixture-only'}}} as unknown as HistoricalJob;
}
afterEach(()=>vi.restoreAllMocks());
it('promotes delivery without changing the short JEV questions, selector or compact wire',async()=>{
 const r=fixture(),p=await currentReportProtocol(r);await verifyParallelProtocol(p.body,p.sha256);
 expect(p.body.current_delivery).toMatchObject({version:CURRENT_V2,source_run_id:r.id,request_id:r.request_id});expect(p.body.production_enabled).toBe(true);
 expect(p.body.denominators).toEqual({source_reviews:7,analytical_reviews:6,textless_statistics_only:1});expect(p.body.max_luna_calls).toBe(0);expect(p.body.max_sol_calls).toBe(1);
 for(const t of p.body.pending)expect(t.payload).toEqual(shortJev({review_alias:'review_'+t.review_id,analysis_text:t.payload.state.analysis_text}));
 const wrong=structuredClone(p.body);wrong.current_delivery!.source_run_id=id();await expect(verifyParallelProtocol(wrong,await directHash(wrong))).rejects.toThrow();
});
it('rehearses the shared current V2 path with mock transport, one Sol reservation and no native network',async()=>{
 const deny=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN')),p=await currentReportProtocol(fixture());
 const result=await rehearseParallel({...p,id:id()});expect(result).toMatchObject({provider_calls:0,mock_jev:6,mock_luna:0,mock_sol:1,status:'completed'});
 expect(result.operation.result!.production_enabled).toBe(true);expect(deny).not.toHaveBeenCalled();
});
it('handles a stored text fallback without pretending a new translation was produced',async()=>{
 const r=fixture();r.snapshot.reviews![0].original_text=null;
 const p=await currentReportProtocol(r);expect(p.body.source_snapshot.reviews[0].original_text).toBe(r.snapshot.reviews![0].text);await verifyParallelProtocol(p.body,p.sha256);
});
it('refuses a changed source perimeter or a request without its authenticated owner binding',async()=>{
 const r=fixture();r.snapshot.base!.stored_reviews_count=8;await expect(currentReportProtocol(r)).rejects.toThrow('CURRENT_V2_SOURCE_MISSING');
 r.snapshot.base!.stored_reviews_count=7;delete r.requested_by;await expect(currentReportProtocol(r)).rejects.toThrow('CURRENT_V2_SOURCE_MISSING');
});
it('splits free certification and queueing across wakes and never opens a provider transport',async()=>{
 const r=fixture(),p=await currentReportProtocol(r),deny=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN'));
 let sealed:unknown=null;const rpc=vi.fn(async(name:string)=>({data:name==='start_parallel_report'?id():true,error:null}));
 const query={select(){return this},eq(){return this},maybeSingle:async()=>({data:sealed,error:null})};const db={from:()=>query,rpc};
 expect(await processCurrentReportPreparation(db as never,r,id())).toMatchObject({phase:'protocol_certified',provider_calls:0});expect(rpc.mock.calls.some(c=>c[0]==='start_parallel_report')).toBe(false);
 sealed=p;expect(await processCurrentReportPreparation(db as never,r,id())).toMatchObject({phase:'v2_queued',provider_calls:0});expect(rpc.mock.calls.filter(c=>c[0]==='start_parallel_report')).toHaveLength(1);expect(deny).not.toHaveBeenCalled();
});
