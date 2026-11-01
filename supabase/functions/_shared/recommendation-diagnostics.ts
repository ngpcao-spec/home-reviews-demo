import type {Fact,Prepared} from './recommendation-ai.ts';
import {PLACE_FEATURES} from './google-place-taxonomy.ts';
import {CRITERIA_VERSION,RECOMMENDATION_AI_VERSION,VALIDATOR_VERSION} from './recommendation-versions.ts';
export {VALIDATOR_VERSION} from './recommendation-versions.ts';

export const DIAGNOSTIC_VERSION='recommendation-diagnostic-v2';
export const DIAGNOSTIC_BUILD='private-recommendation-diagnostics-v2';
export type DiagnosticRuntime={deployment_id:string|null};
type Context={choice_index?:number;candidate_id?:unknown;criterion_index?:number;reference_index?:number;reference?:unknown;list?:unknown;list_limit?:number;expected_state?:string;received_state?:unknown};
const states=['documented','partial','contradicted','conflicted','unknown'];
const statuses=['reported','denied','conflicted','not_documented','reported_repetition','not_established','unknown'];
const kind=(v:unknown)=>v===null?'null':Array.isArray(v)?'array':typeof v;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export function safeReference(ref:unknown):string|null{
 if(typeof ref!=='string')return null;
 if(/^(?:score_(?:global|quality|service|ambiance)|cuisine|specialties|usages|price|freshness|cooking_recurrence|(?:strength|reservation)_(?:quality|service|ambiance|price)_\d{1,4})$/.test(ref))return ref;
 if(ref.startsWith('feature_')&&(Object.hasOwn(PLACE_FEATURES,ref.slice(8))||['fast_service','sea_view'].includes(ref.slice(8))))return ref;
 return null;
}
export function listDiagnostic(value:unknown,limit:number|null=null){
 if(!Array.isArray(value))return {type:kind(value),size:null,limit,duplicate_count:null,duplicate_positions:[],non_string_positions:[]};
 const seen=new Set<unknown>(),duplicates:number[]=[],invalid:number[]=[];let duplicateCount=0;
 value.forEach((v,i)=>{if(seen.has(v)){duplicateCount++;if(duplicates.length<16)duplicates.push(i);}seen.add(v);if(typeof v!=='string'&&invalid.length<16)invalid.push(i);});
 return {type:'array',size:value.length,limit,duplicate_count:duplicateCount,duplicate_positions:duplicates,non_string_positions:invalid};
}
export const reasonAllowed=(f:Fact)=>['score','cuisine','price','strength'].includes(f.kind)||f.kind==='feature'&&['reported','denied'].includes(String((f.value as {status?:unknown}).status));
export const criterionAllowed=(f:Fact,key:string|null)=>key===null?true:key.startsWith('feature_')||key==='cooking_recurrence'?f.ref===key:(f.kind==='strength'||f.kind==='reservation')&&(f.value as {category?:unknown}).category===key.slice(9);
function referenceDiagnostic(p:Prepared,id:unknown,ref:unknown){
 const candidate=typeof id==='string'?p.facts.get(id):undefined,f=typeof ref==='string'?candidate?.find(f=>f.ref===ref):undefined;
 const owners=typeof ref==='string'?p.candidates.filter(c=>p.facts.get(c.id)?.some(f=>f.ref===ref)).map(c=>c.id):[];
 const example=f??(owners[0]?p.facts.get(owners[0])?.find(f=>f.ref===ref):undefined),status=example&&['feature','recurrence'].includes(example.kind)?(example.value as {status?:unknown}).status:null;
 return {code:safeReference(ref),value_type:kind(ref),withheld:typeof ref==='string'&&safeReference(ref)===null,exists_in_transmitted_facts:owners.length>0,exists_for_candidate:!!f,
  candidate_ids:owners,fact_kind:example?.kind??null,fact_status:typeof status==='string'&&statuses.includes(status)?status:null,
  allowed_usages:example?{reason:reasonAllowed(example),criterion_keys:p.criteriaHints.filter(h=>criterionAllowed(example,h.key)).map(h=>h.key),open_criterion:'explicit_binding_and_verified_subject_required',
   caution_policy:example.kind==='reservation'?'relevance_required':example.kind==='strength'?'exact_scoped_source_required':example.kind==='feature'||example.kind==='recurrence'?'bound_criterion_required':example.kind==='freshness'?'stale_report_only':'not_allowed'}:null};
}
export function decisionDiagnostic(p:Prepared,code:string,field:string,rule:string,c:Context={}){
 const id=typeof c.candidate_id==='string'&&(p.facts.has(c.candidate_id)||uuid(c.candidate_id))?c.candidate_id:null;
 return {version:DIAGNOSTIC_VERSION,stage:'decision_validation',code,field,location:field,rule,
  choice_index:c.choice_index??null,candidate_index:id?p.candidates.findIndex(x=>x.id===id):-1,candidate_id:id,candidate_present:id!==null&&p.facts.has(id),
  criterion_index:c.criterion_index??null,reference_index:c.reference_index??null,
  ...(Object.hasOwn(c,'reference')?{reference:referenceDiagnostic(p,id,c.reference)}:{}),
  ...(Object.hasOwn(c,'list')?{list:listDiagnostic(c.list,c.list_limit??null)}:{}),
  ...(c.expected_state?{expected_state:states.includes(c.expected_state)?c.expected_state:null,received_state:typeof c.received_state==='string'&&states.includes(c.received_state)?c.received_state:null}:{}),
 };
}
export type DecisionDiagnostic=ReturnType<typeof decisionDiagnostic>;
export class DecisionValidationError extends Error{
 readonly diagnostic:DecisionDiagnostic;
 constructor(code:string,diagnostic:DecisionDiagnostic){super(code);this.name='DecisionValidationError';this.diagnostic=diagnostic;}
}
export function decisionFailure(p:Prepared,code:string,field:string,rule:string,context:Context={}):never{throw new DecisionValidationError(code,decisionDiagnostic(p,code,field,rule,context));}
export type DiagnosticObservation={prepared?:Prepared;stage:string;attempt_id?:string;failure?:DecisionDiagnostic|{stage:string;code:string;rule:string;field?:string};selected_ids?:string[];criterion_keys?:(string|null)[];prior_state?:string;http_status?:number};
export function diagnosticCriterionKeys(raw:unknown,p:Prepared):(string|null)[]{
 if(!raw||typeof raw!=='object'||!Array.isArray((raw as {criteria?:unknown}).criteria))return [];
 return ((raw as {criteria:unknown[]}).criteria).slice(0,8).map(c=>{const key=c&&typeof c==='object'?(c as {key?:unknown}).key:null;return typeof key==='string'&&p.criteriaHints.some(h=>h.key===key)?key:null;});
}
export function selectedDiagnosticIds(raw:unknown,p:Prepared):string[]{
 if(!raw||typeof raw!=='object'||!Array.isArray((raw as {choices?:unknown}).choices))return [];
 return ((raw as {choices:unknown[]}).choices).slice(0,3).flatMap(c=>{const id=c&&typeof c==='object'?(c as {id?:unknown}).id:null;return typeof id==='string'&&(p.facts.has(id)||uuid(id))?[id]:[];});
}
export type RecommendationTrace={version:typeof DIAGNOSTIC_VERSION;server_build:typeof DIAGNOSTIC_BUILD;deployment_id:string|null;server_version:number|null;api_version:string;client_mode:string;contract_version:string;validator_version:string;cache_version:string;
 attempt_id:string|null;origin:'ai_validated'|'cache'|'fallback'|'pending'|'unavailable';stage:string;notice:string|null;candidate_ids:string[];selected_candidate_ids:string[];criterion_keys:(string|null)[];failure:DiagnosticObservation['failure']|null;prior_attempt_state:string|null;provider_http_status:number|null;response_status?:number};
export function diagnosticTrace(observation:DiagnosticObservation,result:{status:'completed'|'cached'|'fallback'|'pending';attempt_id?:string;notice?:string},runtime:DiagnosticRuntime|undefined):RecommendationTrace{
 const deployment=runtime?.deployment_id&&/^[a-z0-9_-]{1,160}$/i.test(runtime.deployment_id)?runtime.deployment_id:null,version=deployment?.match(/_(\d+)$/)?.[1];
 return {version:DIAGNOSTIC_VERSION,server_build:DIAGNOSTIC_BUILD,deployment_id:deployment,server_version:version?Number(version):null,api_version:'recommendation-test-v1',client_mode:'criteria_coverage_v6',contract_version:CRITERIA_VERSION,validator_version:VALIDATOR_VERSION,cache_version:RECOMMENDATION_AI_VERSION,
  attempt_id:result.attempt_id??observation.attempt_id??null,origin:result.status==='completed'?'ai_validated':result.status==='cached'?'cache':result.status,stage:observation.stage,notice:result.notice??null,
  candidate_ids:observation.prepared?.candidates.map(c=>c.id)??[],selected_candidate_ids:observation.selected_ids??[],criterion_keys:observation.criterion_keys??[],failure:observation.failure??null,prior_attempt_state:observation.prior_state??null,provider_http_status:observation.http_status??null};
}
