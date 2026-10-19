// Future integration seam only. No entrypoint, job creation, credential lookup or default network transport.
import {createJevClient,JEV_ENDPOINT} from './jev.ts';
import {DIRECT_CONFIG,directCategoryPayload,directHash,parseDirectCategories,type DirectCategoryResult} from './jev-direct-categories.ts';
import {verifyDirectCategoriesProtocol,type DirectCategoriesProtocol} from './jev-direct-categories-preparation.ts';
import {analysisTextSha256} from './analysis-text.ts';
export interface DirectReservation {id:string;review_id:string;request_sha256:string;configuration_sha256:string;request_count:1}
export interface DirectOncePort {
 // Future authenticated server job must check its fresh consent, tenant and scope.
 assertAuthorized(protocol:DirectCategoriesProtocol,reviewId:string):Promise<void>;
 // Must be a durable, atomic, consume-once reservation; never reset after dispatch.
 reserve(reviewId:string,requestSha:string,configurationSha:string):Promise<DirectReservation|null>;
 saveReceipt(body:Record<string,unknown>,sha:string):Promise<string>;
 saveResult(body:Record<string,unknown>,sha:string):Promise<string>;
}
export async function evaluateDirectCategoriesOnce(p:DirectCategoriesProtocol,reviewId:string,port:DirectOncePort,apiKey:string,transport:typeof fetch){
 await verifyDirectCategoriesProtocol(p);const r=p.body.reviews.find(r=>r.review_id===reviewId);
 if(!r)throw Error('JEV_DIRECT_REVIEW_OUT_OF_SCOPE');
 await port.assertAuthorized(p,reviewId);
 if(!apiKey.trim())throw Error('JEV_NOT_CONFIGURED');
 const payload=directCategoryPayload(r.review_alias,r.analysis_text),wire=JSON.stringify(payload);
 const reservation=await port.reserve(reviewId,r.request_sha256,p.body.configuration_sha256);
 if(!reservation)return {status:'consumed_or_concurrent_no_retry',provider_calls:0};
 if(reservation.review_id!==reviewId||reservation.request_sha256!==r.request_sha256||reservation.configuration_sha256!==p.body.configuration_sha256||
  reservation.request_count!==1||!reservation.id)throw Error('JEV_DIRECT_RESERVATION_CHANGED');
 let receiptId:string|null=null,dispatched=false,result:DirectCategoryResult|null=null,error:string|null=null;
 const started=Date.now(),base={version:DIRECT_CONFIG.version,configuration_id:DIRECT_CONFIG.id,
  configuration_sha256:p.body.configuration_sha256,protocol_sha256:p.sha256,reservation_id:reservation.id,review_id:reviewId,
  analysis_text_sha256:r.analysis_text_sha256,request_sha256:r.request_sha256,request_raw_sha256:r.request_raw_sha256,
  requested_model:DIRECT_CONFIG.requested_model,request_count:1};
 const fetcher:typeof fetch=async(url,init)=>{
  if(url!==JEV_ENDPOINT||init?.method!=='POST'||init.body!==wire||dispatched)throw Error('JEV_DIRECT_SINGLE_DISPATCH_REQUIRED');
  dispatched=true;let response:Response,text:string;
  try{response=await transport(url,{...init,redirect:'error'});text=await response.text();}
  catch{
   const body={...base,http_status:null,raw_response_text:null,response_raw_sha256:null,duration_ms:Date.now()-started,
    billing_state:'uncertain_no_retry',error:'NETWORK_TIMEOUT_OR_RESPONSE_LOST'};
   receiptId=await port.saveReceipt(body,await directHash(body));throw TypeError('JEV_NETWORK_ERROR');
  }
  const safeText=text.replaceAll(apiKey,'[REDACTED_SECRET]');
  const body={...base,http_status:response.status,provider_request_id:response.headers.get('x-request-id'),
   raw_response_text:safeText,response_raw_sha256:await analysisTextSha256(safeText),secret_redaction_applied:safeText!==text,
   duration_ms:Date.now()-started,billing_state:'response_received_no_retry',error:null};
  receiptId=await port.saveReceipt(body,await directHash(body));
  return new Response(response.status===204?null:safeText,{status:response.status,headers:{'Content-Type':'application/json'}});
 };
 try{
  const client=createJevClient(apiKey,{fetcher,maxAttempts:1,timeoutMs:60_000,sleep:()=>{throw Error('JEV_DIRECT_RETRY_FORBIDDEN');}});
  result=await client.evaluatePayload(payload,parseDirectCategories);
 }catch(e){error=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'JEV_DIRECT_RESULT_OR_STORAGE_UNCERTAIN';}
 if(!receiptId)throw Error('JEV_DIRECT_RECEIPT_NOT_CONFIRMED_NO_RETRY');
 const body={...base,receipt_id:receiptId,status:result?'completed':'failed_or_uncertain',error,result,
  duration_ms:Date.now()-started,served_model:result?.model??null,provider_retries:0,model_probe_calls:0,human_validated:false};
 const resultId=await port.saveResult(body,await directHash(body));
 return {status:body.status,result_id:resultId,provider_calls:dispatched?1:0};
}
