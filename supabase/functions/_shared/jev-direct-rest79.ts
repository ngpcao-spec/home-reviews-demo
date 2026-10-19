// Sequential continuation of the frozen direct-category experiment; never re-dispatches the pilot.
import {evaluateDirectCategoriesOnce,type DirectOncePort} from './jev-direct-categories-once.ts';
import {directHash,directCategoryCounts,type DirectCategoryResult} from './jev-direct-categories.ts';
import {verifyDirectCategoriesProtocol,type DirectCategoriesProtocol,type DirectReplayReview} from './jev-direct-categories-preparation.ts';
import {parseUsage} from './jev.ts';
import {analysisTextSha256} from './analysis-text.ts';
import {DIRECT_PILOT_REVIEW,DIRECT_PILOT_SOURCE,DIRECT_PILOT_SOURCE_SHA,type PilotArchive} from './jev-direct-pilot1.ts';
export const REST79_VERSION='jev-direct-categories4-rest79-executor-v1';
export const REST79_PREFIX='jev_direct_categories4_rest79_';
export const REST79_PILOT_RESULT='60df0905-c3f1-4c40-885f-31d2da216147';
export const REST79_PILOT_RESULT_SHA='c1b7229fcff35b6637891a87fbd3d88a2936196867edbd014f2b912c237978ee';
export const REST79_PILOT_RECEIPT='27cae165-2c81-47e1-a221-93a16284e9c5';
export const REST79_PILOT_RECEIPT_SHA='30b36e97711c1b2ecffb501088799500a58ca3f98b902b90e1d2f7c61aab670a';
export interface Rest79State {source:PilotArchive;execution:PilotArchive;pilot_result:PilotArchive;pilot_receipt:PilotArchive;records:PilotArchive[]}
export interface Rest79Port {
 load(id:string):Promise<Rest79State>;
 assertAuthority(user:string,org:string):Promise<void>;
 reserve(kind:string,body:Record<string,unknown>,sha:string):Promise<string|null>;
 save(kind:string,body:Record<string,unknown>,sha:string):Promise<string>;
 wake(id:string):Promise<void>;
}
const remaining=(p:DirectCategoriesProtocol)=>p.body.reviews.filter(r=>r.review_id!==DIRECT_PILOT_REVIEW);
export async function rest79Scope(p:DirectCategoriesProtocol){const reviews=remaining(p);return {
 source_protocol_id:p.body.source.id,source_preparation_id:DIRECT_PILOT_SOURCE,source_preparation_sha256:p.sha256,
 configuration_id:p.body.configuration.id,configuration_sha256:p.body.configuration_sha256,
 pilot_review_id:DIRECT_PILOT_REVIEW,pilot_result_id:REST79_PILOT_RESULT,pilot_result_sha256:REST79_PILOT_RESULT_SHA,
 pilot_receipt_id:REST79_PILOT_RECEIPT,pilot_receipt_sha256:REST79_PILOT_RECEIPT_SHA,
 pending_review_ids:reviews.map(r=>r.review_id),pending_manifest_sha256:await directHash(reviews.map(r=>({review_id:r.review_id,
  analysis_text_sha256:r.analysis_text_sha256,request_sha256:r.request_sha256,request_raw_sha256:r.request_raw_sha256}))),
 max_new_jev_calls:79,max_questions:316,max_attempts_per_review:1,automatic_retry:false,fallback:false,model_probe_calls:0,
 luna_calls:0,sol_calls:0,apify_calls:0};}
export async function verifyRest79Consent(body:Record<string,unknown>,scope:unknown,authority:string,now=Date.now()){
 if(body.executor_version!==REST79_VERSION||body.consent_source!=='user_directive_codex_delegation'||body.authority_user_id!==authority||
 await directHash(body.scope)!==await directHash(scope)||typeof body.directive!=='string'||!body.directive.startsWith('GO')||
 !body.directive.includes('bc00633a-30d8-4a90-8e22-dcc6a0efaeb9')||!body.directive.includes('jev_categories4_direct_1pass_v1')||
 await analysisTextSha256(body.directive)!==body.directive_sha256||typeof body.executor_code_commit!=='string'||!/^[a-f0-9]{40}$/.test(body.executor_code_commit)||
 !Number.isFinite(Date.parse(String(body.created_at)))||Date.parse(String(body.created_at))>now||
 !Number.isFinite(Date.parse(String(body.expires_at)))||Date.parse(String(body.expires_at))<=now||
 Date.parse(String(body.expires_at))-Date.parse(String(body.created_at))>24*3600_000)throw Error('REST79_GO_OR_SCOPE_INVALID');return true;
}
export async function verifyDirectSaved(p:DirectCategoriesProtocol,result:PilotArchive,receipt:PilotArchive){
 const r=p.body.reviews.find(r=>r.review_id===result.body.review_id),b=result.body,h=receipt.body;
 if(!r||await directHash(b)!==result.sha256||await directHash(h)!==receipt.sha256||b.receipt_id!==receipt.id||
 [b,h].some(x=>x.review_id!==r.review_id||x.configuration_sha256!==p.body.configuration_sha256||
 x.request_sha256!==r.request_sha256||x.request_raw_sha256!==r.request_raw_sha256||x.analysis_text_sha256!==r.analysis_text_sha256||x.request_count!==1)||
 !['completed','failed_or_uncertain'].includes(String(b.status))||b.provider_retries!==0||b.model_probe_calls!==0||
 (h.raw_response_text!==null&&(typeof h.raw_response_text!=='string'||await analysisTextSha256(h.raw_response_text)!==h.response_raw_sha256)))throw Error('REST79_SAVED_RESULT_INCOMPATIBLE');
 if(b.status==='completed'){
  if(!b.result||typeof h.raw_response_text!=='string'||await directHash((b.result as DirectCategoryResult).raw_response)!==await directHash(JSON.parse(h.raw_response_text)))throw Error('REST79_RAW_RESPONSE_CHANGED');
  directCategoryCounts([r.review_id],[{review_id:r.review_id,result:b.result as DirectCategoryResult}]);
 }else if(b.result!==null)throw Error('REST79_FAILED_RESULT_CHANGED');
}
async function verifyState(s:Rest79State,id:string){const p={body:s.source.body,sha256:s.source.sha256} as DirectCategoriesProtocol,e=s.execution;
 if(s.source.id!==DIRECT_PILOT_SOURCE||p.sha256!==DIRECT_PILOT_SOURCE_SHA||e.id!==id||e.kind!==REST79_PREFIX+'execution_v1'||
 e.sha256!==await directHash(e.body)||[e,s.pilot_result,s.pilot_receipt,...s.records].some(r=>r.protocol_id!==s.source.protocol_id||r.organization_id!==s.source.organization_id)||
 s.pilot_result.id!==REST79_PILOT_RESULT||s.pilot_result.sha256!==REST79_PILOT_RESULT_SHA||s.pilot_result.body.status!=='completed'||
 s.pilot_receipt.id!==REST79_PILOT_RECEIPT||s.pilot_receipt.sha256!==REST79_PILOT_RECEIPT_SHA)throw Error('REST79_ARCHIVE_INVALID');
 await verifyDirectCategoriesProtocol(p);if(remaining(p).length!==79)throw Error('REST79_REVIEW_SCOPE_INVALID');
 await verifyDirectSaved(p,s.pilot_result,s.pilot_receipt);
 await verifyRest79Consent(e.body,await rest79Scope(p),p.body.authority_user_id);
 for(const r of s.records)if(await directHash(r.body)!==r.sha256)throw Error('REST79_RECORD_CHANGED');return p;
}
function observedTelemetry(receipt:PilotArchive){let raw:Record<string,unknown>={};try{const v=JSON.parse(String(receipt.body.raw_response_text));if(v&&typeof v==='object'&&!Array.isArray(v))raw=v;}catch{/* Keep missing telemetry explicit. */}
 let usage=null;try{usage=parseUsage(raw.usage);}catch{/* Never invent usage. */}
 return {served_model:typeof raw.model==='string'?raw.model:null,usage,duration_ms:typeof receipt.body.duration_ms==='number'?receipt.body.duration_ms:null};}
export async function aggregateDirect80(p:DirectCategoriesProtocol,pilotResult:PilotArchive,pilotReceipt:PilotArchive,fresh:{result:PilotArchive;receipt:PilotArchive}[]){
 const entries=[{result:pilotResult,receipt:pilotReceipt},...fresh];
 if(entries.length!==80||new Set(entries.map(x=>x.result.body.review_id)).size!==80||fresh.some(x=>x.result.body.review_id===DIRECT_PILOT_REVIEW))throw Error('REST79_DATASET_NOT_80_UNIQUE');
 const rows:(DirectReplayReview&{provenance:string;result_id:string;result_sha256:string;receipt_id:string;receipt_sha256:string;
  status:unknown;error:unknown;result:DirectCategoryResult|null;raw_response_text:unknown;response_raw_sha256:unknown;telemetry:ReturnType<typeof observedTelemetry>})[]=[];
 for(const x of entries){await verifyDirectSaved(p,x.result,x.receipt);const r=p.body.reviews.find(r=>r.review_id===x.result.body.review_id)!;
  rows.push({...r,provenance:r.review_id===DIRECT_PILOT_REVIEW?'reused_pilot':'new_execution',result_id:x.result.id,result_sha256:x.result.sha256,
   receipt_id:x.receipt.id,receipt_sha256:x.receipt.sha256,status:x.result.body.status,error:x.result.body.error,
   result:x.result.body.result as DirectCategoryResult|null,raw_response_text:x.receipt.body.raw_response_text,
   response_raw_sha256:x.receipt.body.response_raw_sha256??null,telemetry:observedTelemetry(x.receipt)});
 }
 rows.sort((a,b)=>a.review_id.localeCompare(b.review_id));
 const usage=(group:typeof rows)=>({reviews:group.length,known_usage_calls:group.filter(r=>r.telemetry.usage!==null).length,
  unknown_usage_review_ids:group.filter(r=>r.telemetry.usage===null).map(r=>r.review_id),
  input_tokens_known:group.reduce((n,r)=>n+(r.telemetry.usage?.input_tokens??0),0),output_tokens_known:group.reduce((n,r)=>n+(r.telemetry.usage?.output_tokens??0),0),
  response_duration_ms_known:group.reduce((n,r)=>n+(r.telemetry.duration_ms??0),0),served_models:[...new Set(group.map(r=>r.telemetry.served_model))]});
 return {version:'jev-direct-categories4-full80-dataset-v1',source_preparation_id:DIRECT_PILOT_SOURCE,source_preparation_sha256:p.sha256,
  configuration_id:p.body.configuration.id,configuration_sha256:p.body.configuration_sha256,denominators:p.body.denominators,
  reviews:rows,counts:directCategoryCounts(p.body.reviews.map(r=>r.review_id),rows.map(r=>({review_id:r.review_id,result:r.result}))),
  errors:rows.filter(r=>r.status!=='completed').map(r=>({review_id:r.review_id,error:r.error,result_id:r.result_id})),
  uncertainties:rows.flatMap(r=>Object.entries(r.result?.categories??{}).filter(([,a])=>a.status!=='classified').map(([category,a])=>({review_id:r.review_id,category,status:a.status,native_choice:a.native_choice}))),
  usage:{reused_pilot:usage(rows.filter(r=>r.provenance==='reused_pilot')),new79:usage(rows.filter(r=>r.provenance==='new_execution'))},
  new_provider_calls:79,pilot_reused_without_dispatch:true,provider_retries:0,model_probe_calls:0,luna_calls:0,sol_calls:0,apify_calls:0,
  qualitative_audit_performed:false,human_reference:false,production_modified:false};
}
export async function processRest79(port:Rest79Port,id:string,key:string,transport:typeof fetch){
 const s=await port.load(id),p=await verifyState(s,id);await port.assertAuthority(p.body.authority_user_id,p.body.organization_id);
 const existing=s.records.find(r=>r.kind===REST79_PREFIX+'dataset_v1');if(existing)return {status:'already_completed',dataset_id:existing.id};
 const reviews=remaining(p),next=reviews.find((_,i)=>!s.records.some(x=>x.kind===REST79_PREFIX+'result_'+String(i+1).padStart(2,'0')));
 const base={execution_id:id,execution_sha256:s.execution.sha256,executor_version:REST79_VERSION,executor_code_commit:s.execution.body.executor_code_commit,
  source_preparation_id:DIRECT_PILOT_SOURCE,source_preparation_sha256:p.sha256,luna_calls:0,sol_calls:0,apify_calls:0};
 if(!next){const fresh=reviews.map((_,i)=>{const suffix=String(i+1).padStart(2,'0'),result=s.records.find(r=>r.kind===REST79_PREFIX+'result_'+suffix)!,
   receipt=s.records.find(r=>r.id===result.body.receipt_id),attempt=s.records.find(r=>r.kind===REST79_PREFIX+'attempt_'+suffix);
   if(!receipt||!attempt||attempt.id!==result.body.reservation_id||attempt.body.review_id!==result.body.review_id)throw Error('REST79_ATTEMPT_OR_RECEIPT_MISSING');return {result,receipt};});
  const dataset={...await aggregateDirect80(p,s.pilot_result,s.pilot_receipt,fresh),...base};
  return {status:'completed',dataset_id:await port.save(REST79_PREFIX+'dataset_v1',dataset,await directHash(dataset))};
 }
 const suffix=String(reviews.indexOf(next)+1).padStart(2,'0');
 if(s.records.some(r=>r.kind===REST79_PREFIX+'attempt_'+suffix))return {status:'consumed_or_inflight_no_retry'};
 const once:DirectOncePort={
  assertAuthorized:async(protocol,review)=>{if(protocol.sha256!==p.sha256||review!==next.review_id||review===DIRECT_PILOT_REVIEW)throw Error('REST79_REVIEW_NOT_AUTHORIZED');
   await verifyRest79Consent(s.execution.body,await rest79Scope(p),p.body.authority_user_id);},
  reserve:async(review,request_sha256,configuration_sha256)=>{
   await verifyRest79Consent(s.execution.body,await rest79Scope(p),p.body.authority_user_id);await port.assertAuthority(p.body.authority_user_id,p.body.organization_id);
   const body={...base,review_id:review,request_sha256,configuration_sha256,request_count:1,reserved_at:new Date().toISOString(),uncertain_dispatch_is_consumed:true};
   const rid=await port.reserve(REST79_PREFIX+'attempt_'+suffix,body,await directHash(body));return rid?{id:rid,review_id:review,request_sha256,configuration_sha256,request_count:1}:null;
  },
  saveReceipt:async b=>{const body={...b,...base};return await port.save(REST79_PREFIX+'receipt_'+suffix,body,await directHash(body));},
  saveResult:async b=>{const body={...b,...base};return await port.save(REST79_PREFIX+'result_'+suffix,body,await directHash(body));},
 };
 const outcome=await evaluateDirectCategoriesOnce(p,next.review_id,once,key,transport);
 if(outcome.provider_calls===1)await port.wake(id);return outcome;
}
