// @vitest-environment node
import {it,expect,vi,afterEach} from 'vitest';
import {sharedJevIdentity,sharedJevIdentities,sharedMissingIds,SHARED_JEV_VERSION,type SharedAnalysisRow} from '../../supabase/functions/_shared/shared-jev-analysis';
import {currentReportProtocol} from '../../supabase/functions/_shared/current-report-v2';
import {currentBatchManifest} from '../../supabase/functions/_shared/current-batch-report';
import {batchSolDraft,processBatchExperiment} from '../../supabase/functions/_shared/jev-batch-experiment';
import {BatchMemory,syntheticCurrentBatchJob,mockBatchJevResponse,mockBatchSolResponse} from '../../supabase/functions/_shared/current-batch-probe';
import {analysisTextSha256} from '../../supabase/functions/_shared/analysis-text';
import {directHash} from '../../supabase/functions/_shared/jev-direct-categories';
import {MIXED_SELECTOR_VERSION,evidenceSelectorBinding} from '../../supabase/functions/_shared/report-evidence-selector';
afterEach(()=>vi.restoreAllMocks());
async function saved(){
 const job=syntheticCurrentBatchJob(5);job.shared_jev_version=SHARED_JEV_VERSION;job.evidence_selector_version=MIXED_SELECTOR_VERSION;
 job.evidence_selector_sha256=(await evidenceSelectorBinding(MIXED_SELECTOR_VERSION)).sha256;
 job.snapshot.reviews!.forEach((r,i)=>r.external_review_id='google-'+i);
 const p=await currentReportProtocol(job),manifest=await currentBatchManifest(p,s=>s.length),m=new BatchMemory(manifest);
 let simulated=0;
 const http:typeof fetch=async(_url,options)=>{simulated++;return new Response(JSON.stringify(mockBatchJevResponse(JSON.parse(String(options?.body)))));};
 await processBatchExperiment(m.port,m.run.id,{jev:'MOCK',sol:'MOCK'},http);
 await processBatchExperiment(m.port,m.run.id,{jev:'MOCK',sol:'MOCK'},http);
 expect(simulated).toBe(1);const t=m.tasks[0];
 const shared:SharedAnalysisRow[]=await Promise.all(t.projection!.rows.map(async x=>({review_id:x.review_id,identity:await sharedJevIdentity(m.run.snapshot.reviews.find(r=>r.id===x.review_id)!),
  state:'ready',task_id:t.id,source_review_id:x.review_id,result:x.result,result_sha256:await directHash(x.result),receipt_sha256:t.receipt_sha256,
  question_keys:x.question_keys,request_sha256:t.request_sha256})));
 return {job,p,m,shared};
}
it('reuses all native results with the same full counts, ordered evidence and compact Sol request',async()=>{
 const deny=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN')),{p,m,shared}=await saved();
 const old=await batchSolDraft(m.run,m.tasks),manifest=await currentBatchManifest(p,s=>s.length,{missing_ids:[]});
 expect(manifest.body.plans).toEqual([]);expect(manifest.body.max_new_jev_calls).toBe(0);
 const run={...m.run,shared_jev_version:SHARED_JEV_VERSION,max_new_jev_calls:0},next=await batchSolDraft(run,[],shared);
 expect(next.counts).toEqual(old.counts);expect(next.evidence).toEqual(old.evidence);expect(next.request_json).toBe(old.request_json);
 expect(next.classification_sources).toHaveLength(5);expect(deny).not.toHaveBeenCalled();
});
it('all available makes zero simulated JEV calls and concurrent clicks reserve Sol exactly once',async()=>{
 const deny=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN')),{p,shared}=await saved();
 const m=new BatchMemory(await currentBatchManifest(p,s=>s.length,{missing_ids:[]}));m.run.shared_jev_version=SHARED_JEV_VERSION;m.run.stage='prepare_evidence';
 m.port.sharedRead=async()=>shared;let sol=0;
 const http:typeof fetch=async url=>{expect(String(url)).toContain('/responses');sol++;return new Response(JSON.stringify({model:'gpt-6.1-sol',status:'completed',usage:{input_tokens:11,output_tokens:12},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(mockBatchSolResponse(m.run.envelope!))}]}]}));};
 const step=()=>processBatchExperiment(m.port,m.run.id,{jev:'MOCK',sol:'MOCK'},http);
 await step();await step();await Promise.all([step(),step()]);await step();
 expect(sol).toBe(1);expect(m.run.status).toBe('completed');expect(m.published?.usage).toMatchObject({jev:{new_provider_attempts:0},shared_jev:{reused_reviews:5,reused_usage_billed_again:false}});expect(deny).not.toHaveBeenCalled();
});
it('remaps a proven Google identity to a new internal UUID while retaining native source IDs and probabilities',async()=>{
 const {m,shared}=await saved(),run=structuredClone(m.run);run.shared_jev_version=SHARED_JEV_VERSION;
 const before=JSON.stringify(shared.map(r=>r.result));
 for(const r of run.snapshot.reviews){const x=shared.find(x=>x.review_id===r.id)!;r.id=crypto.randomUUID();x.review_id=r.id;x.identity=await sharedJevIdentity(r);}
 run.snapshot_sha256=await directHash(run.snapshot);
 const d=await batchSolDraft(run,[],shared);expect(d.counts.received_results).toBe(5);
 expect(JSON.stringify(shared.map(r=>r.result))).toBe(before);
 expect(d.classification_sources.every(x=>'source_review_id' in x&&x.source_review_id!==x.review_id)).toBe(true);
});
it('changing text, language, Google identity or configuration rejects cached results before Sol',async()=>{
 const {m,shared}=await saved();m.run.shared_jev_version=SHARED_JEV_VERSION;
 for(const field of ['analysis_text','analysis_language','google_review_id'] as const){
  const r=structuredClone(m.run);r.snapshot.reviews[0][field]='changed';r.snapshot_sha256=await directHash(r.snapshot);
  await expect(batchSolDraft(r,[],shared)).rejects.toThrow(/SHARED_JEV/);
 }
 const wrong=structuredClone(m.run);wrong.shared_jev_version='unrecognized';await expect(batchSolDraft(wrong,[],shared)).rejects.toThrow('SHARED_JEV_VERSION_OR_RESULTS_REQUIRED');
 const absent=shared.slice(1);await expect(batchSolDraft(m.run,[],absent)).rejects.toThrow('SHARED_JEV_RESULT_INCOMPATIBLE');
});
it('146 valid plus four comments builds one unchanged native request containing only those four',async()=>{
 const job=syntheticCurrentBatchJob(150);job.snapshot.reviews!.forEach((r,i)=>r.external_review_id='google-'+i);
 const p=await currentReportProtocol(job),rows=await sharedJevIdentities(p.body.source_snapshot.reviews),last=rows.slice(146).map(x=>x.review_id);
 const m=await currentBatchManifest(p,s=>Math.ceil(s.length/4),{missing_ids:last});
 expect(m.body.plans).toHaveLength(1);expect(m.body.plans[0].review_ids).toEqual(last);expect(m.body.template.statistics.scope).toMatchObject({source_reviews:150,analysed_text_reviews:150});
 expect(Object.keys(JSON.parse(m.body.plans[0].request_wire).questions)).toHaveLength(16);
});
it('automatic preparation and waiting use the existing worker without any Sol capability',async()=>{
 const {m}=await saved();m.run.purpose='new_reviews';m.run.shared_jev_version=SHARED_JEV_VERSION;m.run.stage='shared_wait';
 m.port.sharedRefresh=async()=> 'shared_wait';const http=vi.fn(()=>{throw Error('NETWORK_FORBIDDEN')});
 expect(await processBatchExperiment(m.port,m.run.id,{jev:'',sol:''},http)).toMatchObject({phase:'shared_analyses_wait_or_ready',provider_calls:0});
 m.run.stage='sol';await expect(processBatchExperiment(m.port,m.run.id,{jev:'',sol:'MOCK'},http)).rejects.toThrow('SHARED_JEV_AUTOMATIC_SOL_FORBIDDEN');
 expect(http).not.toHaveBeenCalled();
});
it('preserves the old publication if a new Sol result is invalid; no second Sol call',async()=>{
 const {p,shared}=await saved(),m=new BatchMemory(await currentBatchManifest(p,s=>s.length,{missing_ids:[]}));
 m.run.shared_jev_version=SHARED_JEV_VERSION;m.run.stage='prepare_evidence';m.port.sharedRead=async()=>shared;
 const old=Object.freeze({id:'PREVIOUS_DATED_REPORT',statistics:{source_reviews:150}});let publication:unknown=old;
 const finish=m.port.finish;m.port.finish=async(...args)=>{const ok=await finish(...args);if(args[1]==='completed')publication=args[2];return ok;};
 const http=vi.fn(async()=>new Response('{}'));const step=()=>processBatchExperiment(m.port,m.run.id,{jev:'MOCK',sol:'MOCK'},http);
 for(let i=0;i<7;i++)await step();expect(http).toHaveBeenCalledTimes(1);expect(publication).toBe(old);expect(m.run.status).toBe('invalid_output');
});
it('textless reviews are statistics-only and unknown outcomes cannot be planned again',async()=>{
 const {p}=await saved(),r=p.body.source_snapshot.reviews[0];
 expect(await sharedJevIdentity({...r,analysis_text:null,analysis_text_sha256:null})).toBeNull();
 expect(()=>sharedMissingIds([{review_id:r.id,owned:false,state:'unknown',task_id:crypto.randomUUID()}])).toThrow('SHARED_JEV_PREVIOUS_ATTEMPT_BLOCKED');
 const identity=await sharedJevIdentity({...r,analysis_language:null});expect(identity?.body.analysis_language).toBe('und');
 expect(await analysisTextSha256(r.analysis_text!)).toBe(identity?.body.analysis_text_sha256);
});
