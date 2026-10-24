// Shared durable batch execution. Used by saved experiments and opt-in current requests.
import {initialBatchIdentity,assertInitialBatchRequest,parseBatchJson,parseInitialBatchResponse,type InitialBatch} from './jev-review-batches.ts';
import {directCanonical,directHash,directCategoryCounts} from './jev-direct-categories.ts';
import {analysisTextSha256} from './analysis-text.ts';
import {directReportCandidates,type DirectReportInput} from './jev-direct-report-preparation.ts';
import {selectDirectCoverage} from './jev-direct-evidence-selection.ts';
import {prepareCompactSolWire,reconstructCompactSolResponse} from './parallel-sol-wire.ts';
import {validateParallelReport} from './parallel-report.ts';
import {solRequestSize,SOL_SIZE_POLICY} from './jls-sol-size.ts';
export const BATCH_EXPERIMENT='jev-multi-review-initial-v1';
export interface BatchTask {id:string;number:number;reviews:number;status:string;request_count:number;request_wire:string;request_sha256:string;
 mapping:InitialBatch['mapping'];receipt:Record<string,unknown>|null;receipt_sha256:string|null;projection?:BatchProjection;historical_source:unknown}
export interface BatchRun {id:string;organization_id:string;establishment_id:string;report_id:string;baseline_report_id:string|null;current_source_run_id?:string|null;stage:string;status:string;armed:boolean;
 snapshot:Omit<DirectReportInput['snapshot']['body'],'reviews'>&{reviews:(DirectReportInput['snapshot']['body']['reviews'][number]&{analysis_language:string|null;analysis_source:string;translation_provenance:unknown})[]};snapshot_sha256:string;template:Record<string,any>;max_new_jev_calls:number;
 draft?:BatchDraft;draft_sha256?:string;envelope?:BatchEnvelope;envelope_sha256?:string;sol_receipt?:Record<string,any>;sol_receipt_sha256?:string;sol_request_count:number}
export interface BatchProjection {parent_receipt_sha256:string;question_mapping_sha256:string;rows:ReturnType<typeof parseInitialBatchResponse>['rows'];
 usage:ReturnType<typeof parseInitialBatchResponse>['usage'];usage_is_historical:boolean;native_classifications:number}
function check(ok:unknown,code:string):asserts ok{if(!ok)throw Error(code);}
export async function validateBatchTask(run:BatchRun,task:BatchTask):Promise<BatchProjection>{
 check(await analysisTextSha256(task.request_wire)===task.request_sha256,'BATCH_REQUEST_CHANGED');
 const batch={payload:parseBatchJson(task.request_wire) as InitialBatch['payload'],mapping:task.mapping};
 await initialBatchIdentity(batch);assertInitialBatchRequest(batch);
 check(Object.keys(batch.payload.state.avis).length===task.reviews,'BATCH_REVIEW_COUNT_CHANGED');
 for(const [alias,text] of Object.entries(batch.payload.state.avis)){
  const r=run.snapshot.reviews.find(r=>r.id===alias.replace(/^review_/,''));
  check(r&&r.organization_id===run.organization_id&&r.establishment_id===run.establishment_id&&r.analysis_text===text&&
    await analysisTextSha256(text)===r.analysis_text_sha256,'BATCH_FROZEN_TEXT_CHANGED');
 }
 const receipt=task.receipt;
 check(receipt&&await directHash(receipt)===task.receipt_sha256&&receipt.request_sha256===task.request_sha256&&
   typeof receipt.raw_response_text==='string'&&await analysisTextSha256(receipt.raw_response_text)===receipt.raw_response_sha256,
   'BATCH_RECEIPT_CHANGED');
 check(receipt.http_status===200&&receipt.error===null,'BATCH_RECEIPT_FAILED');
 const parsed=parseInitialBatchResponse(receipt.raw_response_text,batch);
 return {parent_receipt_sha256:task.receipt_sha256!,question_mapping_sha256:await directHash(task.mapping),rows:parsed.rows,
   usage:parsed.usage,usage_is_historical:task.historical_source!==null,native_classifications:parsed.received_classifications};
}
export async function batchSolDraft(run:BatchRun,tasks:BatchTask[]){
 check(await directHash(run.snapshot)===run.snapshot_sha256,'BATCH_SNAPSHOT_CHANGED');
 const expected=run.snapshot.reviews.filter(r=>r.analysis_text).map(r=>r.id),rows:DirectReportInput['dataset']['body']['reviews']=[];
 const ordered=[...tasks].sort((a,b)=>a.number-b.number),seen=new Set<string>(),classification_sources=[];
 for(const t of ordered){
  check(t.status==='completed'&&t.projection,'BATCH_INCOMPLETE_NO_SOL');
  const projection=await validateBatchTask(run,t);
  check(directCanonical(projection)===directCanonical(t.projection),'BATCH_PROJECTION_CHANGED');
  for(const x of projection.rows){
   check(!seen.has(x.review_id),'BATCH_REVIEW_DUPLICATED_ACROSS_LOTS');seen.add(x.review_id);
   const r=run.snapshot.reviews.find(r=>r.id===x.review_id)!;
   rows.push({review_id:r.id,organization_id:run.organization_id,establishment_id:run.establishment_id,
    analysis_text:r.analysis_text!,analysis_text_sha256:r.analysis_text_sha256!,analysis_language:r.analysis_language??'und',
    result:x.result,result_sha256:await directHash(x.result),raw_response_text:JSON.stringify(x.result.raw_response),
    response_raw_sha256:await analysisTextSha256(JSON.stringify(x.result.raw_response)),translation_source:r.analysis_source,
    translation_provenance:r.translation_provenance,receipt_id:t.id});
   classification_sources.push({review_id:r.id,batch_task_id:t.id,native_question_keys:x.question_keys,receipt_sha256:t.receipt_sha256});
  }
 }
 check(seen.size===expected.length&&expected.every(id=>seen.has(id)),'BATCH_MISSING_OR_FOREIGN_REVIEW');
 const counts=directCategoryCounts(expected,rows),statistics={...run.template.statistics,counts};
 check(statistics.scope.analysed_text_reviews===rows.length&&statistics.scope.source_reviews===run.snapshot.reviews.length,'BATCH_SCOPE_CHANGED');
 const statistics_sha256=await directHash(statistics);
 // The candidates keep the batch parent receipt and the native per-review projection.
 // No synthetic individual supplier receipt is registered in the old cache.
 const candidates=await directReportCandidates({dataset:{body:{reviews:rows,configuration_id:'jev_categories4_short_common_1pass_v1'}},
  snapshot:{body:run.snapshot}} as unknown as DirectReportInput);
 const selection=selectDirectCoverage(candidates,32),evidence=selection.selected;
 check(evidence.length>0,'BATCH_EVIDENCE_INSUFFICIENT');
 const compact=await prepareCompactSolWire({organization_id:run.organization_id,establishment_id:run.establishment_id,
  source_snapshot_sha256:run.snapshot_sha256,statistics,statistics_sha256,evidence,reviews:run.snapshot.reviews},run.template.packet.language);
 const request=JSON.parse(run.template.request_json);
 check(request.model==='gpt-6.1-sol'&&request.reasoning?.effort==='low','BATCH_SOL_PARAMETERS_CHANGED');
 request.input=[{role:'system',content:compact.prompt},{role:'user',content:JSON.stringify(compact.packet)}];
 const request_json=JSON.stringify(request);
 return {version:BATCH_EXPERIMENT,statistics,statistics_sha256,counts,evidence,selection:selection.diagnostics,
  compact_manifest:compact.manifest,compact_manifest_sha256:compact.manifest_sha256,packet:compact.packet,
  classification_sources,classification_sources_sha256:await directHash(classification_sources),
  request_json,request_sha256:await directHash(request),request_raw_sha256:await analysisTextSha256(request_json)};
}
export type BatchDraft=Awaited<ReturnType<typeof batchSolDraft>>;
export async function measureBatchSolDraft(draft:BatchDraft){
 check(await analysisTextSha256(draft.request_json)===draft.request_raw_sha256&&await directHash(JSON.parse(draft.request_json))===draft.request_sha256,'BATCH_SOL_DRAFT_CHANGED');
 return {...draft,measurement:solRequestSize(JSON.parse(draft.request_json))};
}
// Offline compatibility entry point. The worker uses two durable invocations so
// selection and tokenizer initialization do not share one Edge CPU allowance.
export async function batchSolEnvelope(run:BatchRun,tasks:BatchTask[]){return await measureBatchSolDraft(await batchSolDraft(run,tasks));}
export type BatchEnvelope=Awaited<ReturnType<typeof batchSolEnvelope>>;
export interface BatchExperimentPort {
 load(id:string):Promise<{run:BatchRun;tasks:BatchTask[]}>;
 claim(id:string,worker:string):Promise<BatchTask|null>;
 receive(task:string,worker:string,receipt:unknown,sha:string):Promise<boolean>;
 project(task:string,worker:string,projection:unknown,sha:string,error?:string):Promise<boolean>;
 draft(id:string,body:BatchDraft,sha:string):Promise<boolean>;
 envelope(id:string,body:BatchEnvelope,sha:string):Promise<boolean>;
 claimSol(id:string,worker:string):Promise<boolean>;
 receiveSol(id:string,worker:string,body:unknown,sha:string):Promise<boolean>;
 finish(id:string,status:string,result:unknown,usage:unknown,error?:string):Promise<boolean>;
}
const errorCode=(e:unknown)=>{const code=e instanceof Error?e.message.split(':')[0]:'';return /^[A-Z_0-9]+$/.test(code)?code:'BATCH_STEP_FAILED_NO_RETRY';};
function receiptMetadata(raw:string){
 try{const r=JSON.parse(raw),u=r.usage;
  return {served_model:typeof r.model==='string'?r.model:null,usage:u&&Number.isSafeInteger(u.input_tokens)&&u.input_tokens>=0&&Number.isSafeInteger(u.output_tokens)&&u.output_tokens>=0?u:null};
 }catch{return {served_model:null,usage:null};}
}
export function batchJevAccounting(tasks:BatchTask[]){
 check(new Set(tasks.map(t=>t.id)).size===tasks.length,'BATCH_ACCOUNTING_DUPLICATE_TASK');
 const sum=(rows:BatchTask[],historical:boolean)=>{
  let input=0,output=0,duration=0,known=0,unknown=0,attempts=0;
  for(const t of rows){const attempted=historical?1:t.request_count;attempts+=attempted;if(!attempted)continue;
   const u=t.projection?.usage??(typeof t.receipt?.raw_response_text==='string'?receiptMetadata(t.receipt.raw_response_text).usage:null);
   if(u){input+=u.input_tokens;output+=u.output_tokens;known++;}else unknown++;
   if(typeof t.receipt?.duration_ms==='number')duration+=t.receipt.duration_ms;
  }
  return {provider_attempts:attempts,input_tokens:known||!attempts?input:null,output_tokens:known||!attempts?output:null,
   summed_provider_duration_ms:duration,batches_with_recorded_usage:known,unknown_usage_batches:unknown,usage_complete:unknown===0};
 };
 const historical=sum(tasks.filter(t=>t.historical_source!==null),true),fresh=sum(tasks.filter(t=>t.historical_source===null),false);
 return {historical:fresh.provider_attempts===0,provider_attempts:historical.provider_attempts+fresh.provider_attempts,
  reused_batches:tasks.filter(t=>t.historical_source!==null).length,new_provider_attempts:fresh.provider_attempts,
  input_tokens:historical.input_tokens===null||fresh.input_tokens===null?null:historical.input_tokens+fresh.input_tokens,
  output_tokens:historical.output_tokens===null||fresh.output_tokens===null?null:historical.output_tokens+fresh.output_tokens,
  summed_provider_duration_ms:historical.summed_provider_duration_ms+fresh.summed_provider_duration_ms,
  usage_complete:historical.usage_complete&&fresh.usage_complete,historical_usage:historical,new_usage:fresh};
}
export async function processBatchExperiment(port:BatchExperimentPort,id:string,keys:{jev:string;sol:string},http:typeof fetch){
 const {run,tasks}=await port.load(id),worker=crypto.randomUUID();let providerCalls=0;
 if(!run.armed||run.status!=='running')return {phase:'saved_or_disarmed',provider_calls:0};
 if(run.stage==='jev'){
  const t=await port.claim(id,worker);if(!t)return {phase:'concurrent_consumed_or_blocked',provider_calls:0};
  if(t.status==='reserved'){
   check(run.max_new_jev_calls>0&&keys.jev,'BATCH_NEW_JEV_NOT_AUTHORIZED');
   check(await analysisTextSha256(t.request_wire)===t.request_sha256,'BATCH_REQUEST_CHANGED');
   const batch={payload:parseBatchJson(t.request_wire) as InitialBatch['payload'],mapping:t.mapping};
   await initialBatchIdentity(batch);assertInitialBatchRequest(batch);
   const at=Date.now();let receipt;
   try{
    providerCalls++;
    const r=await http('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{Authorization:'Bearer '+keys.jev,'Content-Type':'application/json'},body:t.request_wire,redirect:'error',signal:AbortSignal.timeout(110000)});
    const raw=(await r.text()).replaceAll(keys.jev,'[REDACTED_SECRET]');
    receipt={request_sha256:t.request_sha256,raw_response_text:raw,raw_response_sha256:await analysisTextSha256(raw),http_status:r.status,duration_ms:Date.now()-at,
     ...receiptMetadata(raw),provider_request_id:r.headers.get('x-request-id'),error:null};
   }catch(e){receipt={request_sha256:t.request_sha256,raw_response_text:null,http_status:null,duration_ms:Date.now()-at,error:errorCode(e)};}
   check(await port.receive(t.id,worker,receipt,await directHash(receipt)),'BATCH_RECEIPT_SAVE_UNCERTAIN_NO_RETRY');
   return {phase:'raw_jev_saved',provider_calls:providerCalls};
  }
  try{const projection=await validateBatchTask(run,t);check(await port.project(t.id,worker,projection,await directHash(projection)),'BATCH_PROJECTION_SAVE_FAILED');}
  catch(e){const body={error_code:errorCode(e)};await port.project(t.id,worker,body,await directHash(body),errorCode(e));return {phase:'jev_invalid_saved',provider_calls:0,error_code:errorCode(e)};}
  return {phase:'saved_jev_reused_and_mapped',provider_calls:0};
 }
 if(run.stage==='prepare_evidence'){
  const b=await batchSolDraft(run,tasks);check(await port.draft(id,b,await directHash(b)),'BATCH_DRAFT_SAVE_FAILED');
  return {phase:'compact_sol_draft_saved',provider_calls:0};
 }
 if(run.stage==='measure_sol'){
  check(run.draft&&await directHash(run.draft)===run.draft_sha256,'BATCH_SOL_DRAFT_CHANGED');
  const b=await measureBatchSolDraft(run.draft);check(await port.envelope(id,b,await directHash(b)),'BATCH_ENVELOPE_SAVE_FAILED');
  return {phase:'compact_sol_prepared',provider_calls:0};
 }
 const envelope=run.envelope;
 check(envelope&&await directHash(envelope)===run.envelope_sha256&&await analysisTextSha256(envelope.request_json)===envelope.request_raw_sha256&&
  await directHash(JSON.parse(envelope.request_json))===envelope.request_sha256,'BATCH_SOL_ENVELOPE_CHANGED');
 check(envelope.measurement.version===SOL_SIZE_POLICY.version&&envelope.measurement.guarded_input_tokens<=SOL_SIZE_POLICY.input_budget_tokens&&
  envelope.measurement.request_bytes===new TextEncoder().encode(envelope.request_json).length,'BATCH_SOL_MEASUREMENT_CHANGED');
 if(run.stage==='sol'){
  check(keys.sol,'BATCH_SOL_KEY_UNAVAILABLE');
  if(!await port.claimSol(id,worker))return {phase:'sol_concurrent_or_consumed',provider_calls:0};
  const at=Date.now();let receipt;
  try{
   providerCalls++;
   const r=await http('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+keys.sol,'Content-Type':'application/json'},body:envelope.request_json,redirect:'error',signal:AbortSignal.timeout(SOL_SIZE_POLICY.provider_timeout_ms)});
   const raw=(await r.text()).replaceAll(keys.sol,'[REDACTED_SECRET]');
   receipt={raw_response_text:raw,raw_response_sha256:await analysisTextSha256(raw),http_status:r.status,provider_request_id:r.headers.get('x-request-id'),duration_ms:Date.now()-at,error_code:null,request_sha256:envelope.request_sha256};
  }catch(e){receipt={raw_response_text:null,raw_response_sha256:null,http_status:null,provider_request_id:null,duration_ms:Date.now()-at,error_code:errorCode(e),request_sha256:envelope.request_sha256};}
  check(await port.receiveSol(id,worker,receipt,await directHash(receipt)),'BATCH_SOL_SAVE_UNCERTAIN_NO_RETRY');
  return {phase:'sol_raw_receipt_saved',provider_calls:providerCalls};
 }
 check(run.stage==='validate_sol'&&run.sol_receipt&&run.sol_request_count===1,'BATCH_SOL_RECEIPT_REQUIRED');
 const receipt=run.sol_receipt;
 check(await directHash(receipt)===run.sol_receipt_sha256&&receipt.request_sha256===envelope.request_sha256,'BATCH_SOL_RECEIPT_CHANGED');
 const jev=batchJevAccounting(tasks);
 const usage:Record<string,unknown>={jev,luna_calls:0,apify_calls:0};
 let status='invalid_output',error:string|undefined,result:Record<string,unknown>={};
 try{
  if(!receipt.raw_response_text){status='billing_uncertain';throw Error('BATCH_SOL_OUTCOME_UNKNOWN_NO_RETRY');}
  check(await analysisTextSha256(receipt.raw_response_text)===receipt.raw_response_sha256,'BATCH_SOL_RAW_CHANGED');
  const raw=JSON.parse(receipt.raw_response_text);result.response=raw;
  usage.sol={historical:false,provider_attempts:1,usage:raw.usage??null,duration_ms:receipt.duration_ms,provider_request_id:receipt.provider_request_id,served_model:raw.model??null};
  check(receipt.http_status>=200&&receipt.http_status<300&&raw.model==='gpt-6.1-sol'&&raw.status==='completed','BATCH_SOL_HTTP_MODEL_OR_OUTPUT_INVALID');
  check(Number.isSafeInteger(raw.usage?.input_tokens)&&raw.usage.input_tokens>0&&Number.isSafeInteger(raw.usage.output_tokens)&&raw.usage.output_tokens>=0,'BATCH_SOL_USAGE_MISSING');
  const texts=raw.output.filter((x:any)=>x.type==='message').flatMap((x:any)=>x.content).filter((x:any)=>x.type==='output_text');
  check(texts.length===1,'BATCH_SOL_OUTPUT_INVALID');const compact=JSON.parse(texts[0].text);
  const reconstructed=reconstructCompactSolResponse(compact,envelope.compact_manifest,envelope.evidence);
  const validated=await validateParallelReport(reconstructed,envelope as unknown as Parameters<typeof validateParallelReport>[1]);
  const {report,format_version,statistics_sha256,...controls}=validated;
  result={...result,original_report:validated.original_report,derived_report:{report,format_version,statistics_sha256},corrections:validated.reference_derivation,
   controls:{...controls,evidence:envelope.evidence,compact_response:compact,response_format_version:envelope.packet.version,
    batch_experiment:!run.current_source_run_id,jev_transport:BATCH_EXPERIMENT,new_jev_calls:jev.new_provider_attempts}};
  status=validated.technical_checks_passed?'completed':'needs_review';
 }catch(e){error=errorCode(e);result.controls={validation_error:error,batch_experiment:!run.current_source_run_id,new_jev_calls:jev.new_provider_attempts};}
 check(await port.finish(id,status,result,usage,error),'BATCH_RESULT_SAVE_FAILED');
 return {phase:'sol_validation_saved',provider_calls:0,status,error_code:error};
}

