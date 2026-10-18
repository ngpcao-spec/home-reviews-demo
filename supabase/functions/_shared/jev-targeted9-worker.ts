// Explicit GO only. One durable reservation per review; never a model probe or retry.
import {verifyTargetedJev,parseTargetedJevResult,type TargetedProtocol} from './jev-boundaries-targeted-protocol.ts';
import {auditEconomyPayload} from './jev-audit-boundaries-v22.ts';
import {createJevClient,JEV_ENDPOINT} from './jev.ts';
import {hybridHash} from './jev-hybrid-evidence.ts';
import {negativeHash} from './negative-validation-core.ts';
export interface Target9Record {id:string;kind:string;body:Record<string,unknown>;sha256:string}
export interface Target9State {protocol:TargetedProtocol;protocol_id:string;execution:Target9Record;records:Target9Record[]}
export interface Target9Port {
 load(id:string):Promise<Target9State>;
 reserve(id:string,review:string,sha:string,worker:string):Promise<string|null>;
 save(kind:string,body:Record<string,unknown>):Promise<string>;
 wake(id:string):Promise<void>;
}
export async function processTargeted9(port:Target9Port,id:string,key:string,transport:typeof fetch){
 const s=await port.load(id),p=s.protocol,e=s.execution;
 await verifyTargetedJev(p);
 if(e.id!==id||e.kind!=='jev_targeted9_execution_v1'||await hybridHash(e.body)!==e.sha256||
 e.body.targeted_protocol_id!==s.protocol_id||e.body.protocol_sha256!==p.sha256||
 e.body.request_manifest_sha256!==p.body.request_manifest_sha256||e.body.configuration_sha256!==p.body.configuration_sha256||
 e.body.consent_source!=='user_directive_codex_delegation'||await hybridHash(e.body.scope)!==p.body.policy_sha256||
 typeof e.body.directive!=='string'||await negativeHash(e.body.directive)!==e.body.directive_sha256||
 !Number.isFinite(Date.parse(String(e.body.expires_at)))||Date.parse(String(e.body.expires_at))<=Date.now())throw Error('TARGETED_GO_INVALID');
 for(const r of s.records)if(await hybridHash(r.body)!==r.sha256)throw Error('TARGETED_RECORD_CHANGED');
 const pending=p.body.reviews.find(r=>!s.records.some(x=>x.kind==='jev_targeted9_result_'+String(r.position).padStart(2,'0')));
 if(!pending){
  const results=s.records.filter(x=>/^jev_targeted9_result_\d\d$/.test(x.kind));
  const receipts=s.records.filter(x=>/^jev_targeted9_receipt_\d\d$/.test(x.kind));
  await port.save('jev_targeted9_summary_v1',{version:'jev-targeted9-summary-v1',execution_id:id,targeted_protocol_id:s.protocol_id,
   protocol_sha256:p.sha256,results:results.map(x=>({id:x.id,sha256:x.sha256,review_id:x.body.review_id,status:x.body.status})),
   receipt_ids:receipts.map(x=>x.id),attempts:s.records.filter(x=>/^jev_targeted9_attempt_\d\d$/.test(x.kind)).length,
   completed:results.filter(x=>x.body.status==='completed').length,failed:results.filter(x=>x.body.status!=='completed').length,
   provider_retries:0,model_probes:0,luna_calls:0,sol_calls:0,apify_calls:0,historical_results_modified:false});
  return 'finished';
 }
 const suffix=String(pending.position).padStart(2,'0'),kind='jev_targeted9_attempt_'+suffix;
 // An existing consumed reservation is never dispatched again, even without a receipt.
 if(s.records.some(x=>x.kind===kind))return 'consumed_no_retry';
 const payload=auditEconomyPayload(pending.request_state.review_alias,pending.analysis_text!);
 if(await hybridHash(payload)!==pending.request_sha256||await negativeHash(JSON.stringify(payload))!==pending.request_raw_sha256)throw Error('TARGETED_REQUEST_CHANGED');
 if(!key.trim())throw Error('JEV_NOT_CONFIGURED');
 const worker=crypto.randomUUID(),attempt=await port.reserve(id,pending.id,pending.request_sha256,worker);
 if(!attempt)return 'not_claimed';
 let receiptId:string|null=null,rawText:string|null=null,httpStatus:number|null=null,providerMs=0;
 let error:string|null=null,parsed:Awaited<ReturnType<typeof parseTargetedJevResult>>|null=null;
 const base={version:'jev-targeted9-receipt-v1',execution_id:id,targeted_protocol_id:s.protocol_id,protocol_sha256:p.sha256,
  attempt_id:attempt,review_id:pending.id,position:pending.position,request_sha256:pending.request_sha256,
  request_raw_sha256:pending.request_raw_sha256,analysis_text_sha256:pending.analysis_text_sha256,
  configuration_id:p.body.configuration_id,configuration_sha256:p.body.configuration_sha256,requested_model:'jev-latest',attempt_count:1};
 const fetcher:typeof fetch=async(url,init)=>{
  if(url!==JEV_ENDPOINT||init?.method!=='POST'||init.body!==JSON.stringify(payload))throw Error('TARGETED_TRANSPORT_FORBIDDEN');
  const start=Date.now(),started=new Date().toISOString();let response:Response;
  try{response=await transport(url,init);httpStatus=response.status;rawText=await response.text();}
  catch{
   providerMs=Date.now()-start;
   receiptId=await port.save('jev_targeted9_receipt_'+suffix,{...base,started_at:started,finished_at:new Date().toISOString(),
    http_status:httpStatus,duration_ms:providerMs,raw_response_text:rawText,response_raw_sha256:rawText===null?null:await negativeHash(rawText),
    billing_state:'uncertain_no_retry',error:'JEV_NETWORK_OR_BODY_LOST'});
   throw TypeError('JEV_NETWORK_ERROR');
  }
  providerMs=Date.now()-start;
  // Persist the full response before JSON/usage/theme parsing, including HTTP errors.
  receiptId=await port.save('jev_targeted9_receipt_'+suffix,{...base,started_at:started,finished_at:new Date().toISOString(),
   http_status:httpStatus,duration_ms:providerMs,raw_response_text:rawText,response_raw_sha256:await negativeHash(rawText!),
   provider_request_id:response.headers.get('x-request-id')??response.headers.get('request-id'),
   billing_state:response.ok?'response_received_usage_not_yet_validated':'http_error_no_retry',error:null});
  return new Response(response.status===204?null:rawText,{status:response.status,headers:{'Content-Type':'application/json'}});
 };
 try{
  const client=createJevClient(key,{maxAttempts:1,timeoutMs:60_000,fetcher,sleep:()=>{throw Error('TARGETED_RETRY_FORBIDDEN');}});
  const raw=await client.evaluatePayload(payload,x=>x);
  parsed=await parseTargetedJevResult(p,pending.id,raw);
 }catch(x){error=x instanceof Error&&/^JEV_[A-Z0-9_]+$|^TARGETED_[A-Z0-9_]+$/.test(x.message)?x.message:'TARGETED_RESPONSE_OR_STORAGE_FAILED';}
 // A receipt write failure stops here. The consumed reservation protects billing.
 if(!receiptId)throw Error('TARGETED_RECEIPT_NOT_CONFIRMED_NO_RETRY');
 await port.save('jev_targeted9_result_'+suffix,{version:'jev-targeted9-result-v1',execution_id:id,targeted_protocol_id:s.protocol_id,
  protocol_sha256:p.sha256,attempt_id:attempt,receipt_id:receiptId,review_id:pending.id,position:pending.position,
  request_sha256:pending.request_sha256,configuration_sha256:p.body.configuration_sha256,
  status:parsed?'completed':'failed_or_uncertain',http_status:httpStatus,duration_ms:providerMs,error,
  result:parsed,provider_retries:0,model_probe_calls:0,human_validated:false});
 // Only a new never-reserved review can be sent on the next server wake.
 await port.wake(id);return parsed?'completed_one':'failed_one';
}
