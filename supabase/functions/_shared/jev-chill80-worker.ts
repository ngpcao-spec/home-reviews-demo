// Existing native client and durable append-only reservation pattern. No automatic entrypoint.
import {verifyChill80,parseChill80,aggregateChill80,type Chill80Protocol,type Chill80Analysis,type Chill80Baseline} from './jev-chill-reanalysis80.ts';
import type {Target9Record} from './jev-targeted9-worker.ts';
import {auditEconomyPayload} from './jev-audit-boundaries-v22.ts';
import {createJevClient,JEV_ENDPOINT} from './jev.ts';
import {hybridHash} from './jev-hybrid-evidence.ts';
import {negativeHash} from './negative-validation-core.ts';
export interface Chill80Port {
 load(id:string):Promise<{protocol:Chill80Protocol;protocol_id:string;execution:Target9Record;records:Target9Record[]}>;
 baseline():Promise<Chill80Baseline[]>;
 reserve(id:string,review:string,sha:string,worker:string):Promise<string|null>;
 save(kind:string,body:Record<string,unknown>):Promise<string>;
 wake(id:string):Promise<void>;
}
export async function processChill80(port:Chill80Port,id:string,key:string,transport:typeof fetch){
 const s=await port.load(id),p=s.protocol,e=s.execution;await verifyChill80(p);
 if(e.id!==id||e.kind!=='jev_chill80_execution_v1'||e.sha256!==await hybridHash(e.body)||
 e.body.full_protocol_id!==s.protocol_id||e.body.protocol_sha256!==p.sha256||e.body.pending_sha256!==p.body.pending_sha256||
 e.body.reuses_sha256!==p.body.reuses_sha256||e.body.configuration_sha256!==p.body.configuration_sha256||
 e.body.consent_source!=='user_directive_codex_delegation'||await hybridHash(e.body.scope)!==p.body.policy_sha256||
 typeof e.body.directive!=='string'||await negativeHash(e.body.directive)!==e.body.directive_sha256||
 !Number.isFinite(Date.parse(String(e.body.expires_at)))||Date.parse(String(e.body.expires_at))<=Date.now())throw Error('CHILL80_SPECIFIC_GO_REQUIRED');
 for(const r of s.records)if(r.sha256!==await hybridHash(r.body))throw Error('CHILL80_RECORD_CHANGED');
 const results=s.records.filter(r=>/^jev_chill80_result_\d\d$/.test(r.kind));
 if(results.some(r=>r.body.status!=='completed'))return 'stopped_no_retry';
 const pending=p.body.pending.find(r=>!results.some(x=>x.body.review_id===r.review_id));
 if(!pending){
  const fresh:Chill80Analysis[]=results.map(r=>{
   const receipt=s.records.find(x=>x.id===r.body.receipt_id);if(!receipt)throw Error('CHILL80_RECEIPT_MISSING');
   return {...r.body.result as Awaited<ReturnType<typeof parseChill80>>,duration_ms:Number(r.body.duration_ms),
    provenance:{kind:'new_execution',result_id:r.id,receipt_id:receipt.id,result_sha256:r.sha256,receipt_sha256:receipt.sha256}};
  });
  const dataset=await aggregateChill80(p,[...p.body.reused,...fresh],await port.baseline());
  const archive=await port.save('jev_chill80_dataset_v1',{...dataset,execution_id:id,full_protocol_id:s.protocol_id,new_provider_calls:71,
   provider_retries:0,model_probe_calls:0,luna_calls:0,sol_calls:0,apify_calls:0});return archive;
 }
 const suffix=String(pending.position).padStart(2,'0');
 if(s.records.some(r=>r.kind==='jev_chill80_attempt_'+suffix))return 'consumed_no_retry';
 const r=p.body.reviews.find(r=>r.id===pending.review_id)!;
 const payload=auditEconomyPayload(pending.request_state.review_alias,r.analysis_text!);
 if(await hybridHash(payload)!==pending.request_sha256||await negativeHash(JSON.stringify(payload))!==pending.request_raw_sha256)throw Error('CHILL80_REQUEST_CHANGED');
 if(!key.trim())throw Error('JEV_NOT_CONFIGURED');
 const attempt=await port.reserve(id,r.id,pending.request_sha256,crypto.randomUUID());if(!attempt)return 'not_claimed';
 let receipt:string|null=null,duration=0,http:number|null=null;
 let parsed:Awaited<ReturnType<typeof parseChill80>>|null=null,error:string|null=null;
 const base={version:'jev-chill80-receipt-v1',execution_id:id,full_protocol_id:s.protocol_id,protocol_sha256:p.sha256,
  attempt_id:attempt,review_id:r.id,position:pending.position,configuration_id:p.body.configuration_id,
  request_sha256:pending.request_sha256,request_raw_sha256:pending.request_raw_sha256,analysis_text_sha256:r.analysis_text_sha256,
  requested_model:'jev-latest',required_served_model:p.body.required_served_model,attempt_count:1};
 const fetcher:typeof fetch=async(url,init)=>{
  if(url!==JEV_ENDPOINT||init?.method!=='POST'||init.body!==JSON.stringify(payload))throw Error('CHILL80_TRANSPORT_FORBIDDEN');
  const start=Date.now(),started_at=new Date().toISOString();let response:Response,text:string;
  try{response=await transport(url,init);http=response.status;text=await response.text();}
  catch{duration=Date.now()-start;receipt=await port.save('jev_chill80_receipt_'+suffix,{...base,started_at,finished_at:new Date().toISOString(),
   duration_ms:duration,http_status:http,raw_response_text:null,billing_state:'uncertain_no_retry',error:'JEV_NETWORK_OR_BODY_LOST'});throw TypeError('JEV_NETWORK_ERROR');}
  duration=Date.now()-start;
  receipt=await port.save('jev_chill80_receipt_'+suffix,{...base,started_at,finished_at:new Date().toISOString(),duration_ms:duration,
   http_status:http,raw_response_text:text,response_raw_sha256:await negativeHash(text),provider_request_id:response.headers.get('x-request-id'),
   billing_state:response.ok?'response_received':'http_error_no_retry',error:null});
  return new Response(response.status===204?null:text,{status:response.status,headers:{'Content-Type':'application/json'}});
 };
 try{const client=createJevClient(key,{maxAttempts:1,timeoutMs:60000,fetcher,sleep:()=>{throw Error('CHILL80_RETRY_FORBIDDEN');}});
  parsed=await parseChill80(p,r.id,await client.evaluatePayload(payload,x=>x));
 }catch(e){error=e instanceof Error&&/^(JEV|CHILL80)_[A-Z0-9_]+$/.test(e.message)?e.message:'CHILL80_RESPONSE_OR_STORAGE_FAILED';}
 if(!receipt)throw Error('CHILL80_RECEIPT_NOT_CONFIRMED_NO_RETRY');
 await port.save('jev_chill80_result_'+suffix,{version:'jev-chill80-result-v1',execution_id:id,full_protocol_id:s.protocol_id,
  protocol_sha256:p.sha256,review_id:r.id,position:pending.position,attempt_id:attempt,receipt_id:receipt,
  status:parsed?'completed':'failed_or_uncertain',result:parsed,duration_ms:duration,http_status:http,error,provider_retries:0});
 if(!parsed)return 'stopped_no_retry';await port.wake(id);return 'completed_one';
}
