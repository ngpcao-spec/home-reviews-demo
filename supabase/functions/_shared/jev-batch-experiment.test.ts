import {it,expect,vi} from 'vitest';
import {initialBatchPayload} from './jev-review-batches.ts';
import {analysisTextSha256} from './analysis-text.ts';
import {directHash,DIRECT_NATIVE_CHOICES} from './jev-direct-categories.ts';
import {validateBatchTask,processBatchExperiment,type BatchRun,type BatchTask,type BatchExperimentPort} from './jev-batch-experiment.ts';
async function fixture(){
 const id='00000000-0000-4000-8000-000000000001',b=initialBatchPayload([{review_id:id,text:'Personnel aimable mais attente longue.'}]);
 const request_wire=JSON.stringify(b.payload),request_sha256=await analysisTextSha256(request_wire);
 const raw=JSON.stringify({model:'jev-1.13.0',usage:{input_tokens:10,output_tokens:20},answers:Object.fromEntries(Object.keys(b.mapping).map(k=>[k,{type:'choice',choice:k.endsWith('service')?'mixed':'not_mentioned',probabilities:Object.fromEntries(DIRECT_NATIVE_CHOICES.map(c=>[c,c===(k.endsWith('service')?'mixed':'not_mentioned')?1:0]))}]))});
 const receipt={request_sha256,raw_response_text:raw,raw_response_sha256:await analysisTextSha256(raw),http_status:200,error:null};
 const run={id:'run',status:'running',stage:'jev',armed:true,template:{},max_new_jev_calls:0,organization_id:'org',establishment_id:'est',snapshot:{reviews:[{id,organization_id:'org',establishment_id:'est',analysis_text:b.payload.state.avis['review_'+id],analysis_text_sha256:await analysisTextSha256(b.payload.state.avis['review_'+id])}]}} as unknown as BatchRun;
 const task={id:'task',number:1,reviews:1,status:'received',request_count:0,request_wire,request_sha256,mapping:b.mapping,receipt,receipt_sha256:await directHash(receipt),historical_source:{saved:true}} as BatchTask;
 return {run,task};
}
it('reuses saved native batch answers with exact review/category binding and no HTTP',async()=>{
 const {run,task}=await fixture(),projection=await validateBatchTask(run,task);
 expect(projection.rows[0].result.categories.service).toMatchObject({native_choice:'mixed',classification:'mixed'});
 expect(projection.rows[0].result.categories.quality.native_choice).toBe('not_mentioned');
 expect(projection).toMatchObject({usage_is_historical:true,native_classifications:4});
 const project=vi.fn().mockResolvedValue(true),http=vi.fn(()=>{throw Error('NO_HTTP');});
 const port={load:async()=>({run,tasks:[task]}),claim:async()=>task,project} as unknown as BatchExperimentPort;
 expect(await processBatchExperiment(port,'run',{jev:'',sol:''},http)).toMatchObject({provider_calls:0,phase:'saved_jev_reused_and_mapped'});
 expect(project).toHaveBeenCalledOnce();expect(http).not.toHaveBeenCalled();
});
it('rejects changed texts, changed question mappings and changed saved responses',async()=>{
 const {run,task}=await fixture();const changed=structuredClone(run);changed.snapshot.reviews[0].analysis_text='other';
 await expect(validateBatchTask(changed,task)).rejects.toThrow('BATCH_FROZEN_TEXT_CHANGED');
 const m=structuredClone(task);m.mapping.r001_service.category='price';await expect(validateBatchTask(run,m)).rejects.toThrow('BATCH_REQUEST_OR_MAPPING_CHANGED');
 const r=structuredClone(task);r.receipt!.raw_response_text+=' ';await expect(validateBatchTask(run,r)).rejects.toThrow('BATCH_RECEIPT_CHANGED');
});
it('does not resend consumed/concurrent tasks or disarmed experiments',async()=>{
 const {run}=await fixture(),http=vi.fn(()=>{throw Error('NO_HTTP');});
 const port={load:async()=>({run,tasks:[]}),claim:async()=>null} as unknown as BatchExperimentPort;
 expect(await processBatchExperiment(port,'run',{jev:'',sol:''},http)).toMatchObject({provider_calls:0});
 run.armed=false;expect(await processBatchExperiment(port,'run',{jev:'',sol:''},http)).toMatchObject({phase:'saved_or_disarmed'});
 expect(http).not.toHaveBeenCalled();
});
it('refuses a new JEV send in the saved-only final-test scope',async()=>{
 const {run,task}=await fixture();task.status='reserved';task.request_count=1;
 const http=vi.fn(()=>{throw Error('NO_HTTP');});const port={load:async()=>({run,tasks:[task]}),claim:async()=>task} as unknown as BatchExperimentPort;
 await expect(processBatchExperiment(port,'run',{jev:'',sol:''},http)).rejects.toThrow('BATCH_NEW_JEV_NOT_AUTHORIZED');
 expect(http).not.toHaveBeenCalled();
});

