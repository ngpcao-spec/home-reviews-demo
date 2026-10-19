// One explicitly delegated format pilot. Never enumerates or launches the other 79 reviews.
import {evaluateDirectCategoriesOnce,type DirectOncePort,type DirectReservation} from './jev-direct-categories-once.ts';
import {directCategoryPayload,directHash} from './jev-direct-categories.ts';
import {verifyDirectCategoriesProtocol,type DirectCategoriesProtocol} from './jev-direct-categories-preparation.ts';
import {analysisTextSha256} from './analysis-text.ts';
export const DIRECT_PILOT_VERSION='jev-direct-categories4-pilot1-executor-v1';
export const DIRECT_PILOT_ID='8b0c78fd-0c18-4b1e-9062-ece47380b77f';
export const DIRECT_PILOT_SHA='f5b3869b10bf107bf9242b6b4b8febc91b753670c02918b9a70d8f8a3f3ad7c7';
export const DIRECT_PILOT_REVIEW='0095a08b-ff64-4b53-90e1-55434b92bcd2';
export const DIRECT_PILOT_SOURCE='f858bb8f-395d-4aa9-bd10-d7f641934244';
export const DIRECT_PILOT_SOURCE_SHA='1edf645ff5bcbb5faf731a3f21b9a95e431a4094f4c746057b126ee127650f9d';
export const DIRECT_PILOT_KINDS={execution:'jev_direct_categories4_chill1_execution_v1',attempt:'jev_direct_categories4_chill1_attempt_v1',
 receipt:'jev_direct_categories4_chill1_receipt_v1',result:'jev_direct_categories4_chill1_result_v1'} as const;
export interface PilotArchive {id:string;protocol_id:string;organization_id:string;kind:string;body:Record<string,unknown>;sha256:string}
export interface DirectPilotState {pilot:PilotArchive;source:PilotArchive;execution:PilotArchive}
export interface DirectPilotPort {
 load(id:string):Promise<DirectPilotState>;
 assertAuthority(userId:string,organizationId:string):Promise<void>;
 reserve(body:Record<string,unknown>,sha:string):Promise<string|null>;
 save(kind:string,body:Record<string,unknown>,sha:string):Promise<string>;
}
export function directPilotScope(pilot:PilotArchive){return {
 pilot_preparation_id:DIRECT_PILOT_ID,pilot_preparation_sha256:DIRECT_PILOT_SHA,
 source_preparation_id:DIRECT_PILOT_SOURCE,source_preparation_sha256:DIRECT_PILOT_SOURCE_SHA,
 review_id:DIRECT_PILOT_REVIEW,configuration_sha256:pilot.body.configuration_sha256,
 request_sha256:pilot.body.request_sha256,request_raw_sha256:pilot.body.request_raw_sha256,
 max_jev_calls:1,max_questions:4,max_attempts_per_review:1,automatic_retry:false,fallback:false,model_probe_calls:0,
 luna_calls:0,sol_calls:0,apify_calls:0};}
export async function verifyDirectPilotConsent(body:Record<string,unknown>,scope:unknown,authority:string,now=Date.now()){
 if(body.executor_version!==DIRECT_PILOT_VERSION||body.consent_source!=='user_directive_codex_delegation'||
 body.authority_user_id!==authority||await directHash(body.scope)!==await directHash(scope)||
 typeof body.directive!=='string'||!body.directive.startsWith('GO')||!body.directive.includes(DIRECT_PILOT_REVIEW)||
 await analysisTextSha256(body.directive)!==body.directive_sha256||
 typeof body.executor_code_commit!=='string'||!/^[a-f0-9]{40}$/.test(body.executor_code_commit)||
 !Number.isFinite(Date.parse(String(body.created_at)))||Date.parse(String(body.created_at))>now||
 !Number.isFinite(Date.parse(String(body.expires_at)))||Date.parse(String(body.expires_at))<=now||
 Date.parse(String(body.expires_at))-Date.parse(String(body.created_at))>24*3600_000)
 throw Error('DIRECT_PILOT_GO_OR_SCOPE_INVALID');return true;
}
export async function verifyDirectPilot(s:DirectPilotState,id:string,now=Date.now()){
 const {pilot,source,execution:e}=s,p={body:source.body,sha256:source.sha256} as DirectCategoriesProtocol;
 if(pilot.id!==DIRECT_PILOT_ID||pilot.kind!=='jev_direct_categories4_chill1_pilot_v1'||pilot.sha256!==DIRECT_PILOT_SHA||
 source.id!==DIRECT_PILOT_SOURCE||source.sha256!==DIRECT_PILOT_SOURCE_SHA||source.kind!=='jev_direct_categories4_chill80_protocol_v1'||
 e.id!==id||e.kind!==DIRECT_PILOT_KINDS.execution||[pilot,source,e].some(x=>x.protocol_id!==source.protocol_id||x.organization_id!==source.organization_id)||
 await directHash(pilot.body)!==pilot.sha256||await directHash(e.body)!==e.sha256)throw Error('DIRECT_PILOT_ARCHIVE_INVALID');
 await verifyDirectCategoriesProtocol(p);
 const r=p.body.reviews.find(x=>x.review_id===DIRECT_PILOT_REVIEW)!;
 if(!r||await directHash(r)!==await directHash(pilot.body.review)||
 await directHash(directCategoryPayload(r.review_alias,r.analysis_text))!==pilot.body.request_sha256||
 p.body.configuration_sha256!==pilot.body.configuration_sha256||pilot.body.source_preparation_id!==source.id||
 pilot.body.source_preparation_sha256!==source.sha256)
 throw Error('DIRECT_PILOT_GO_OR_SCOPE_INVALID');
 await verifyDirectPilotConsent(e.body,directPilotScope(pilot),p.body.authority_user_id,now);
 return p;
}
export async function processDirectPilot1(port:DirectPilotPort,id:string,key:string,transport:typeof fetch){
 const s=await port.load(id),p=await verifyDirectPilot(s,id);
 await port.assertAuthority(p.body.authority_user_id,p.body.organization_id);
 const provenance={pilot_preparation_id:DIRECT_PILOT_ID,pilot_preparation_sha256:DIRECT_PILOT_SHA,
 execution_id:id,execution_sha256:s.execution.sha256,executor_version:DIRECT_PILOT_VERSION,
 executor_code_commit:s.execution.body.executor_code_commit,luna_calls:0,sol_calls:0,apify_calls:0};
 const once:DirectOncePort={
  assertAuthorized:async(protocol,review)=>{
   if(protocol.sha256!==DIRECT_PILOT_SOURCE_SHA||review!==DIRECT_PILOT_REVIEW)throw Error('DIRECT_PILOT_REVIEW_NOT_AUTHORIZED');
   await verifyDirectPilot(s,id);
  },
  reserve:async(review,request_sha256,configuration_sha256)=>{
   // Authorization and active membership are rechecked immediately before the atomic INSERT.
   await verifyDirectPilot(s,id);await port.assertAuthority(p.body.authority_user_id,p.body.organization_id);
   const body={...provenance,review_id:review,request_sha256,configuration_sha256,request_count:1,
    reserved_at:new Date().toISOString(),uncertain_dispatch_is_consumed:true};
   const reserved=await port.reserve(body,await directHash(body));
   return reserved?{id:reserved,review_id:review,request_sha256,configuration_sha256,request_count:1} as DirectReservation:null;
  },
  saveReceipt:async(body)=>{const b={...body,...provenance};return await port.save(DIRECT_PILOT_KINDS.receipt,b,await directHash(b));},
  saveResult:async(body)=>{const b={...body,...provenance};return await port.save(DIRECT_PILOT_KINDS.result,b,await directHash(b));},
 };
 return await evaluateDirectCategoriesOnce(p,DIRECT_PILOT_REVIEW,once,key,transport);
}
export function directPilotHandler(deps:{authenticate(r:Request):Promise<boolean>;run(id:string):Promise<unknown>;waitUntil(p:Promise<unknown>):void}){
 return async(r:Request)=>{
  const json=(body:unknown,status:number)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  if(r.method!=='POST')return json({error:'METHOD_NOT_ALLOWED',provider_calls:0},405);
  if(!await deps.authenticate(r))return json({error:'UNAUTHORIZED',provider_calls:0},401);
  const b=await r.json().catch(()=>null);
  if(!b||Object.keys(b).join()!=='execution_id'||typeof b.execution_id!=='string'||!/^[a-f0-9-]{36}$/.test(b.execution_id))return json({error:'INVALID_SCOPE',provider_calls:0},400);
  deps.waitUntil(deps.run(b.execution_id).catch(()=>{console.error('DIRECT_PILOT_STOPPED_NO_RETRY');}));
  return json({accepted_background:true,execution_id:b.execution_id,max_jev_calls:1,automatic_retry:false},202);
 };
}
