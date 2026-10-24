// In-memory persistence and explicit provider simulations. Never writes a real
// request, obtains a secret, or calls a network transport.
import {currentReportProtocol} from './current-report-v2.ts';
import {currentBatchManifest,type CurrentBatchManifest} from './current-batch-report.ts';
import {processBatchExperiment,type BatchRun,type BatchTask,type BatchExperimentPort,type BatchEnvelope} from './jev-batch-experiment.ts';
import {directHash,DIRECT_CATEGORY_KEYS,DIRECT_NATIVE_CHOICES} from './jev-direct-categories.ts';
import {COMPACT_SOL_WIRE} from './parallel-sol-wire.ts';
import {DIRECT_CANDIDATE_EMPTY} from './jev-direct-report-preparation.ts';
import type {HistoricalJob} from './historical-report-worker.ts';
export function syntheticCurrentBatchJob(n=51,scope:{organization_id:string;establishment_id:string;requested_by:string}={organization_id:crypto.randomUUID(),establishment_id:crypto.randomUUID(),requested_by:crypto.randomUUID()}){
 const reviews=Array.from({length:n},(_,i)=>({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,rating:i%5+1,
  original_text:`EXPLICIT SYNTHETIC SOURCE ${i}: helpful staff but a long wait; cold soup; pleasant room.`,
  analysis_text:`EXPLICIT SYNTHETIC SOURCE ${i}: helpful staff but a long wait; cold soup; pleasant room.`,
  analysis_source:'original_en',analysis_language:'en',original_language:'en',review_context:null,review_detailed_rating:null,published_at:null}));
 return {id:crypto.randomUUID(),generation_id:crypto.randomUUID(),engine:'jev_sol_v2',jev_transport:'batch_initial_v1',request_id:crypto.randomUUID(),...scope,
  language:'vi',status:'running',created_at:new Date().toISOString(),snapshot:{reviews,base:{organization_id:scope.organization_id,establishment_id:scope.establishment_id,stored_reviews_count:n,source_fingerprint:'EXPLICIT_TECHNICAL_MOCK'}}} as unknown as HistoricalJob;
}
export async function syntheticCurrentBatchManifest(n=51,scope?:Parameters<typeof syntheticCurrentBatchJob>[1]){
 const job=syntheticCurrentBatchJob(n,scope),protocol=await currentReportProtocol(job),manifest=await currentBatchManifest(protocol,s=>Math.ceil(s.length/4));
 return {job,protocol,manifest};
}
export function mockBatchJevResponse(request:{questions:Record<string,unknown>}){
 return {model:'jev-1.13.0',usage:{input_tokens:101,output_tokens:202,total_tokens:303},answers:Object.fromEntries(Object.keys(request.questions).map(key=>{
  const category=key.split('_').at(-1),choice=category==='service'?'mixed':category==='quality'?'negative':category==='ambiance'?'positive':'not_mentioned';
  return [key,{type:'choice',choice,confidence:1,probabilities:Object.fromEntries(DIRECT_NATIVE_CHOICES.map(c=>[c,c===choice?1:0]))}];
 }))};
}
export function mockBatchSolResponse(envelope:BatchEnvelope){
 const refs=envelope.compact_manifest.associations;
 return {format_version:COMPACT_SOL_WIRE,report:{categories:DIRECT_CATEGORY_KEYS.map(category=>({category,
  text:refs.some(x=>x.category===category)?'EXPLICIT TECHNICAL MOCK':DIRECT_CANDIDATE_EMPTY,refs:refs.filter(x=>x.category===category).slice(0,1).map(x=>x.ref)})),
  positive_aspects:refs.filter(x=>x.polarity==='positive').slice(0,1).map(x=>({category:x.category,text:'EXPLICIT TECHNICAL MOCK',refs:[x.ref]})),
  negative_aspects:refs.filter(x=>x.polarity==='negative').slice(0,1).map(x=>({category:x.category,text:'EXPLICIT TECHNICAL MOCK',refs:[x.ref]})),
  conclusion:{text:'EXPLICIT TECHNICAL MOCK',refs:[refs[0].ref]},recommendations:[]}};
}
export class BatchMemory {
 run:BatchRun;tasks:BatchTask[];port:BatchExperimentPort;events:string[]=[];published:Record<string,unknown>|null=null;
 leases=new Map<string,number>();
 constructor(m:CurrentBatchManifest){
  const p=m.body;this.run={id:crypto.randomUUID(),organization_id:p.organization_id,establishment_id:p.establishment_id,report_id:crypto.randomUUID(),baseline_report_id:null,
   current_source_run_id:p.current_delivery.source_run_id,snapshot:p.snapshot,snapshot_sha256:p.snapshot_sha256,template:p.template,
   max_new_jev_calls:p.plans.length,status:'running',stage:'jev',armed:true,sol_request_count:0};
  this.tasks=p.plans.map(b=>({id:crypto.randomUUID(),...b,status:'pending',request_count:0,receipt:null,receipt_sha256:null,historical_source:null}));
  this.port={
   load:async()=>structuredClone({run:this.run,tasks:this.tasks}),
   claim:async(_id,w)=>{
    if(!this.run.armed||this.run.status!=='running')return null;
    for(const t of this.tasks)if(t.status==='reserved'&&(this.leases.get(t.id)??0)<Date.now())t.status='unknown';
    const t=this.tasks.find(t=>t.status==='received'&&(this.leases.get(t.id)??0)<Date.now()||t.status==='pending'&&t.request_count===0);
    if(!t){if(this.tasks.some(t=>['unknown','invalid_output'].includes(t.status))){this.run.status='blocked';this.run.armed=false;}return null;}
    if(t.status==='pending'){
     if(this.tasks.some(x=>x.status==='reserved'))return null;
     t.request_count=1;t.status='reserved';this.events.push('reserved:'+t.number);
    }
    (t as BatchTask&{worker:string}).worker=w;this.leases.set(t.id,Date.now()+150000);return structuredClone(t);
   },
   receive:async(id,w,body,sha)=>{
    const t=this.tasks.find(t=>t.id===id)!;if(t.receipt)return t.receipt_sha256===sha;
    if((t as BatchTask&{worker:string}).worker!==w||!['reserved','unknown'].includes(t.status))return false;
    t.receipt=structuredClone(body) as Record<string,unknown>;t.receipt_sha256=sha;t.status=t.receipt.raw_response_text?'received':'unknown';this.leases.delete(t.id);this.events.push('receipt:'+t.number);return true;
   },
   project:async(id,w,body,sha,error)=>{
    const t=this.tasks.find(t=>t.id===id)!;if(t.status==='completed')return await directHash(t.projection)===sha;
    if(t.status!=='received'||(t as BatchTask&{worker:string}).worker!==w)return false;
    if(!error)t.projection=structuredClone(body) as NonNullable<BatchTask['projection']>;
    t.status=error?'invalid_output':'completed';this.leases.delete(t.id);this.events.push('project:'+t.number);
    if(this.tasks.every(t=>t.status==='completed'))this.run.stage='prepare_evidence';return true;
   },
   envelope:async(_id,body,sha)=>{if(this.run.envelope)return this.run.envelope_sha256===sha;this.run.envelope=structuredClone(body);this.run.envelope_sha256=sha;this.run.stage='sol';return true;},
   claimSol:async()=>{if(this.run.sol_request_count||!this.run.armed||this.run.status!=='running')return false;this.run.sol_request_count=1;return true;},
   receiveSol:async(_id,_w,body,sha)=>{if(this.run.sol_receipt)return this.run.sol_receipt_sha256===sha;this.run.sol_receipt=structuredClone(body) as Record<string,unknown>;this.run.sol_receipt_sha256=sha;this.run.stage='validate_sol';return true;},
   finish:async(_id,status,result,usage,error)=>{
    if(this.run.status!=='running')return true;this.published={state:status,...structuredClone(result as object),usage:structuredClone(usage),error_code:error,
     statistics:this.run.envelope!.statistics,source_reviews:this.run.snapshot.reviews,current_source_run_id:this.run.current_source_run_id};
    this.run.status=status;this.run.armed=false;return true;
   },
  };
 }
 expireReserved(){for(const t of this.tasks)if(t.status==='reserved')this.leases.set(t.id,0);}
}
export async function rehearseCurrentBatches(){
 const f=await syntheticCurrentBatchManifest(),memory=new BatchMemory(f.manifest);let jev=0,sol=0;
 const http:typeof fetch=async(url,options)=>{
  if(String(url)==='https://api.typesafe.ai/v1/systemone'){jev++;return new Response(JSON.stringify(mockBatchJevResponse(JSON.parse(String(options?.body)))));}
  if(String(url)==='https://api.openai.com/v1/responses'){
   sol++;return new Response(JSON.stringify({model:'gpt-6.1-sol',status:'completed',usage:{input_tokens:303,output_tokens:404},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(mockBatchSolResponse(memory.run.envelope!))}]}]}));
  }throw Error('ONLY_EXPLICIT_MOCK_ENDPOINTS_ALLOWED');
 };
 for(let i=0;i<20&&memory.run.armed;i++)await processBatchExperiment(memory.port,memory.run.id,{jev:'EXPLICIT_MOCK_JEV',sol:'EXPLICIT_MOCK_SOL'},http);
 if(memory.run.status!=='completed'||jev!==2||sol!==1)throw Error('CURRENT_BATCH_MOCK_PATH_FAILED');
 return {explicit_technical_mock:true,provider_calls:0,new_runs:0,status:memory.run.status,simulated_jev:jev,simulated_sol:sol,
  batches:memory.tasks.length,reviews:51,native_classifications:memory.tasks.reduce((n,t)=>n+(t.projection?.native_classifications??0),0),
  usage:memory.published!.usage,exact_current_publication:!!memory.published!.current_source_run_id,events:memory.events};
}
