import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {it,expect,vi} from 'vitest';
import {batchSolDraft,validateBatchTask,type BatchRun,type BatchTask} from '../../supabase/functions/_shared/jev-batch-experiment';
import {sharedJevIdentity,SHARED_JEV_VERSION,type SharedAnalysisRow} from '../../supabase/functions/_shared/shared-jev-analysis';
import {directHash} from '../../supabase/functions/_shared/jev-direct-categories';
// Private saved receipts supplied explicitly; no personal fixtures in Git.
const folder=process.env.SHARED_JEV_REPLAY_DIR;
it.skipIf(!folder)('preserves every native classification, ordered association and Sol input on saved corpora',async()=>{
 const deny=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN')),results=[];
 try{
  for(const file of readdirSync(folder!).filter(f=>/^saved-replay-input-.*\.json$/.test(f))){
   const saved=JSON.parse(readFileSync(join(folder!,file),'utf8')) as {run:BatchRun;tasks:(BatchTask&{projection_sha256:string})[];google_ids:Record<string,string>};
   const {run,tasks,google_ids}=saved;
   for(const t of tasks){t.projection=await validateBatchTask(run,t);expect(await directHash(t.projection)).toBe(t.projection_sha256);}
   const textual=run.snapshot.reviews.filter(r=>r.analysis_text),unverifiable=textual.filter(r=>!google_ids[r.id]).map(r=>r.id);
   if(unverifiable.length){results.push({run_id:run.id,texts:textual.length,native_validated:tasks.reduce((n,t)=>n+t.projection!.native_classifications,0),unverifiable_google_binding:unverifiable});continue;}
   // Add proven Google IDs to BOTH offline inputs. Only this auxiliary metadata
   // changes the source hash; no historical request/report is modified.
   const shadow=structuredClone(run);shadow.snapshot.reviews.forEach(r=>r.google_review_id=google_ids[r.id]);
   shadow.snapshot.source_reviews_sha256=await directHash(shadow.snapshot.reviews);shadow.snapshot_sha256=await directHash(shadow.snapshot);
   const baseline=await batchSolDraft(shadow,tasks),shared:SharedAnalysisRow[]=[];
   for(const t of tasks)for(const x of t.projection!.rows){const r=shadow.snapshot.reviews.find(r=>r.id===x.review_id)!;
    shared.push({review_id:r.id,identity:await sharedJevIdentity(r),state:'ready',task_id:t.id,source_review_id:r.id,result:x.result,
     result_sha256:await directHash(x.result),receipt_sha256:t.receipt_sha256,question_keys:x.question_keys,request_sha256:t.request_sha256});}
   shadow.shared_jev_version=SHARED_JEV_VERSION;
   const reused=await batchSolDraft(shadow,[],shared);
   expect(reused.counts).toEqual(baseline.counts);expect(reused.evidence).toEqual(baseline.evidence);expect(reused.request_json).toBe(baseline.request_json);
   results.push({run_id:run.id,source_reviews:run.snapshot.reviews.length,texts:textual.length,classifications:textual.length*4,
    native_validated:tasks.reduce((n,t)=>n+t.projection!.native_classifications,0),associations:reused.evidence.length,
    counts_identical:true,ordered_evidence_identical:true,sol_request_identical:true,request_sha256:reused.request_sha256,provider_calls:0});
  }
  expect(results.length).toBeGreaterThan(0);writeFileSync(join(folder!,'saved-replay-results.json'),JSON.stringify({provider_calls:0,results},null,2));
 }finally{expect(deny).not.toHaveBeenCalled();deny.mockRestore();}
},60000);
