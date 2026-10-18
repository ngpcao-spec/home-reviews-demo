// Free preparation and result parsing only. No dispatch, credentials or provider client.
import {AUDIT_ECONOMY_CONFIG,auditEconomyPayload,auditBoundaryManifest} from './jev-audit-boundaries-v22.ts';
import {THEME_KEYS,THEME_CHOICES,parseThemes,type ThemeChoice,type ThemeKey} from './jev-themes.ts';
import {economicThemeResults} from './jev-economy-cache.ts';
import {hybridHash} from './jev-hybrid-evidence.ts';
import {negativeHash} from './negative-validation-core.ts';
import type {PilotReview} from './jev-pilot-core.ts';
export const TARGETED_VERSION='jev-audit-boundaries-targeted9-v1';
export const TARGETED_CODE='13cff76ef38fedaf964ca96515710e72a8b874d2';
export interface TargetCriterion {expected_choice:ThemeChoice|null;allowed_choices:ThemeChoice[];manual_review_only:boolean;criterion:string}
export interface TargetCriteria {version:string;source_code_commit:string;review_count:number;theme_count:number;assessment_count:number;human_gold:boolean;cases:{position:number;review_id:string;role:string;label:string;primary_criteria:Partial<Record<ThemeKey,ThemeChoice>>;ambiguities:string;expectation_provenance:string;themes:Record<ThemeKey,TargetCriterion>}[];[key:string]:unknown}
export interface TargetBaseline {review_id:string;cache_id:string;analysis_text_sha256:string;configuration_id:string;instruction_sha256:string;threshold_sha256:string;served_model:string;response_sha256:string;theme_results_sha256:string}
export const TARGETED_POLICY=Object.freeze({requested_model:'jev-latest',endpoint:'https://api.typesafe.ai/v1/systemone',
 max_jev_calls:9,max_calls_per_review:1,repeat_count:1,client_max_attempts:1,concurrency:1,
 max_luna_calls:0,max_sol_calls:0,max_apify_calls:0,automatic_retry:false,reports_generated:0,
 reserve_atomically_before_dispatch:true,uncertain_dispatch_is_consumed:true,
 no_model_probe_call:true,no_fallback_api:true,new_authenticated_go_required:true,production_enabled:false});
function criteriaValid(c:TargetCriteria){
 if(c.source_code_commit!==TARGETED_CODE||c.review_count!==9||c.theme_count!==25||c.assessment_count!==225||c.human_gold!==false||
 c.cases.length!==9||new Set(c.cases.map(r=>r.review_id)).size!==9)throw Error('TARGETED_CRITERIA_SCOPE_INVALID');
 for(const [i,r] of c.cases.entries()){
  if(r.position!==i+1||Object.keys(r.themes).length!==25||THEME_KEYS.some(k=>!r.themes[k]))throw Error('TARGETED_ALL_25_REQUIRED');
  for(const x of Object.values(r.themes))if(!x.allowed_choices.length||new Set(x.allowed_choices).size!==x.allowed_choices.length||
   x.allowed_choices.some(v=>!THEME_CHOICES.includes(v))||!x.manual_review_only&&(x.expected_choice===null||!x.allowed_choices.includes(x.expected_choice)))throw Error('TARGETED_EXPECTATION_INVALID');
 }
}
export async function prepareTargetedJev(source:{source_protocol:{id:string;sha256:string;snapshot_sha256:string;authority_user_id:string};reviews:PilotReview[]},criteria:TargetCriteria,baseline:TargetBaseline[]){
 criteriaValid(criteria);const registry=await auditBoundaryManifest(),reviews=[];
 if(source.reviews.length!==9||baseline.length!==9||new Set(baseline.map(b=>b.review_id)).size!==9)throw Error('TARGETED_UNIQUE_REVIEWS_REQUIRED');
 const scope=source.reviews[0];
 for(const row of criteria.cases){
  const r=source.reviews.find(r=>r.id===row.review_id),b=baseline.find(b=>b.review_id===row.review_id);
  if(!r||r.organization_id!==scope.organization_id||r.establishment_id!==scope.establishment_id||r.analysis_language!=='en'||!r.analysis_text?.trim()||
   await negativeHash(r.original_text)!==r.original_text_sha256||await negativeHash(r.analysis_text)!==r.analysis_text_sha256)throw Error('TARGETED_FROZEN_TEXT_CHANGED');
  if(!b||b.analysis_text_sha256!==r.analysis_text_sha256||b.configuration_id!=='v12_economy_1pass_v1'||b.threshold_sha256!==registry.threshold_sha256)throw Error('TARGETED_BASELINE_INCOMPATIBLE');
  const payload=auditEconomyPayload('review_'+String(row.position).padStart(2,'0'),r.analysis_text);
  reviews.push({...r,position:row.position,case:row.label,role:row.role,request_state:payload.state,
   request_sha256:await hybridHash(payload),request_raw_sha256:await negativeHash(JSON.stringify(payload))});
 }
 const body={version:TARGETED_VERSION,code_commit:TARGETED_CODE,organization_id:scope.organization_id,establishment_id:scope.establishment_id,
  authority_user_id:source.source_protocol.authority_user_id,source_historical_report_id:'39556285-21ee-4962-9892-da3b4f0e8ca3',
  source_protocol_id:source.source_protocol.id,source_protocol_sha256:source.source_protocol.sha256,source_snapshot_sha256:source.source_protocol.snapshot_sha256,
  source_historical_run_id:'3294262e-8946-41c0-b9c4-463a4fe27e74',configuration_id:AUDIT_ECONOMY_CONFIG.id,
  configuration_sha256:registry.config_sha256,instruction_sha256:registry.instruction_sha256,threshold_sha256:registry.threshold_sha256,
  policy:TARGETED_POLICY,policy_sha256:await hybridHash(TARGETED_POLICY),criteria,criteria_sha256:await hybridHash(criteria),
  request_template:{model:'jev-latest',questions:AUDIT_ECONOMY_CONFIG.questions},reviews,source_reviews_sha256:await hybridHash(reviews),
  baseline,baseline_sha256:await hybridHash(baseline),request_manifest_sha256:await hybridHash(reviews.map(r=>({review_id:r.id,request_sha256:r.request_sha256,request_raw_sha256:r.request_raw_sha256}))),
  status:'sealed_preparation_only',expected_review_count:9,expected_theme_results:225,
  expected_requests:9,new_paid_calls:0,spending_authorization:null,run_id:null,production_enabled:false,
  evaluation_scope:'diagnostic_regression_on_seen_examples_not_independent_validation',
  result_contract:{persist_raw_before_parse:true,all_25_themes:true,native_choices_and_probabilities:true,thresholded_choices_separate:true,
   request_and_response_sha256:true,actual_model_tokens_latency_errors:true,model_drift_must_be_reported:true,
   rejected_or_incomplete_output_preserved:true,old_results_read_only:true,qualitative_audit:'user_analysis_chat',no_automatic_quality_score:true}};
 return {body,sha256:await hybridHash(body)};
}
export type TargetedProtocol=Awaited<ReturnType<typeof prepareTargetedJev>>;
export async function verifyTargetedJev(p:TargetedProtocol){
 const b=p.body;
 if(await hybridHash(b)!==p.sha256||b.version!==TARGETED_VERSION||b.code_commit!==TARGETED_CODE||b.policy_sha256!==await hybridHash(TARGETED_POLICY)||
  b.criteria_sha256!==await hybridHash(b.criteria)||b.baseline_sha256!==await hybridHash(b.baseline))throw Error('TARGETED_PROTOCOL_CHANGED');
 const rebuilt=await prepareTargetedJev({source_protocol:{id:b.source_protocol_id,sha256:b.source_protocol_sha256,snapshot_sha256:b.source_snapshot_sha256,authority_user_id:b.authority_user_id},reviews:b.reviews},b.criteria,b.baseline);
 if(rebuilt.sha256!==p.sha256)throw Error('TARGETED_PROTOCOL_CHANGED');
 return true;
}
export async function parseTargetedJevResult(p:TargetedProtocol,review_id:string,raw:unknown){
 await verifyTargetedJev(p);const r=p.body.reviews.find(r=>r.id===review_id);if(!r)throw Error('TARGETED_REVIEW_OUT_OF_SCOPE');
 const answers=(raw as {answers?:unknown})?.answers;
 if(!answers||typeof answers!=='object'||Object.keys(answers).length!==25)throw Error('TARGETED_ALL_25_REQUIRED');
 const parsed=parseThemes(raw);
 return {review_id,analysis_text_sha256:r.analysis_text_sha256,configuration_id:p.body.configuration_id,request_sha256:r.request_sha256,
  native:parsed.decision,theme_results:economicThemeResults(parsed.decision),usage:parsed.usage,served_model:parsed.model,
  model_differs_from_historical_baseline:parsed.model!==p.body.baseline.find(b=>b.review_id===review_id)!.served_model,
  response_sha256:await hybridHash(raw),human_validated:false,quality_audit:'user_analysis_chat',historical_results_modified:false};
}
