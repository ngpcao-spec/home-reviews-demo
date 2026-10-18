// Offline compilation and deterministic aggregation. No provider transport or consent.
import {auditBoundaryManifest,auditEconomyPayload,AUDIT_ECONOMY_CONFIG} from './jev-audit-boundaries-v22.ts';
import {verifyTargetedJev,parseTargetedJevResult,type TargetedProtocol} from './jev-boundaries-targeted-protocol.ts';
import {economicThemeResults} from './jev-economy-cache.ts';
import {THEME_KEYS,parseThemes,type ThemeDecision} from './jev-themes.ts';
import {hybridHash} from './jev-hybrid-evidence.ts';
import {negativeHash} from './negative-validation-core.ts';
import type {PilotReview} from './jev-pilot-core.ts';
import type {Target9Record} from './jev-targeted9-worker.ts';
export const CHILL80_VERSION='jev-chill-reanalysis80-boundaries-v1';
export const CHILL80_KIND='jev_chill_reanalysis80_protocol_v1';
export const CHILL80_BENCHMARK='b9d96984-fe68-42ad-b1fe-d552473d2f16';
export const CHILL80_TARGETED='3f6ab86c-7557-431b-9389-4fa85054a00e';
export const CHILL80_SOURCE='39556285-21ee-4962-9892-da3b4f0e8ca3';
export const CHILL80_ESTABLISHMENT='a9a6ec1c-cbb3-4e39-a498-86f2e68bd4b8';
export interface Chill80Baseline {id:string;review_id:string;organization_id:string;establishment_id:string;configuration_id:string;
 analysis_text_sha256:string;instruction_sha256:string;threshold_sha256:string;served_model:string;status:string;
 response:ThemeDecision;theme_results:ReturnType<typeof economicThemeResults>}
export interface Chill80Source {id:string;sha256:string;body:{organization_id:string;establishment_id:string;authority_user_id:string;
 snapshot:{source_sha256:string;source:{reviews:PilotReview[]}};frozen_v2?:{historical_run_id:string};[key:string]:unknown}}
export interface Chill80Input {source:Chill80Source;benchmark_protocol:TargetedProtocol&{id:string};benchmark_execution:Target9Record;
 benchmark_records:Target9Record[];baseline:Chill80Baseline[]}
export interface Chill80Analysis {review_id:string;analysis_text_sha256:string;configuration_id:string;served_model:string;
 native:ThemeDecision;theme_results:ReturnType<typeof economicThemeResults>;usage:{input_tokens:number;output_tokens:number};
 duration_ms:number;provenance:{kind:'reused_benchmark'|'new_execution';result_id:string;receipt_id:string;result_sha256:string;receipt_sha256:string};}
export class Chill80CompatibilityError extends Error {
 constructor(public compatible_reviews:number,public rejected:{review_id:string;reason:string}[]){
  super('CHILL80_REUSE_BLOCKED_'+compatible_reviews+'_OF_9_NEEDED_'+(80-compatible_reviews));
 }
}
export function chill80Counts(rows:{review_id:string;native:ThemeDecision;theme_results:ReturnType<typeof economicThemeResults>}[],mode:'native'|'thresholded'){
 if(new Set(rows.map(r=>r.review_id)).size!==rows.length)throw Error('CHILL80_DUPLICATE_RESULT');
 return Object.fromEntries(THEME_KEYS.map(k=>{
  const choice=(r:typeof rows[number])=>mode==='native'?r.native.themes[k].choice:r.theme_results[k].choice;
  const ids=(polarity:'positive'|'negative')=>rows.filter(r=>choice(r)===polarity||choice(r)==='both').map(r=>r.review_id).sort();
  const positive=ids('positive'),negative=ids('negative');return [k,{positive_review_count:positive.length,negative_review_count:negative.length,
   both_review_count:rows.filter(r=>choice(r)==='both').length,absent_review_count:rows.filter(r=>choice(r)==='absent').length,
   distinct_mentioned_review_count:new Set([...positive,...negative]).size,polarity_mentions:positive.length+negative.length,
   positive_review_ids:positive,negative_review_ids:negative}];
 }));
}
export async function prepareChill80(input:Chill80Input){
 const {source,benchmark_protocol:bp,benchmark_execution:execution,benchmark_records:records,baseline}=input;
 const manifest=await auditBoundaryManifest(),reviews=source.body.snapshot.source.reviews;
 if(source.sha256!==await hybridHash(source.body)||source.body.establishment_id!==CHILL80_ESTABLISHMENT||
 source.body.frozen_v2?.historical_run_id!==CHILL80_SOURCE||reviews.length!==100||new Set(reviews.map(r=>r.id)).size!==100||
 bp.id!==CHILL80_TARGETED||bp.body.source_protocol_id!==source.id||bp.body.source_protocol_sha256!==source.sha256||
 bp.body.source_snapshot_sha256!==source.body.snapshot.source_sha256||bp.body.organization_id!==source.body.organization_id)throw Error('CHILL80_SOURCE_CHANGED');
 await verifyTargetedJev(bp);
 const text=reviews.filter(r=>r.original_text.trim()),textless=reviews.filter(r=>!r.original_text.trim());
 if(text.length!==80||textless.length!==20||baseline.length!==80||new Set(baseline.map(c=>c.review_id)).size!==80)throw Error('CHILL80_SCOPE_100_80_REQUIRED');
 for(const r of reviews){
  if(r.organization_id!==source.body.organization_id||r.establishment_id!==source.body.establishment_id||await negativeHash(r.original_text)!==r.original_text_sha256||
   (r.original_text.trim()?(r.analysis_language!=='en'||!r.analysis_text?.trim()||await negativeHash(r.analysis_text)!==r.analysis_text_sha256):!!r.analysis_text?.trim()))throw Error('CHILL80_FROZEN_TEXT_CHANGED');
 }
 if(bp.body.configuration_id!==AUDIT_ECONOMY_CONFIG.id||bp.body.configuration_sha256!==manifest.config_sha256||
 bp.body.instruction_sha256!==manifest.instruction_sha256||bp.body.threshold_sha256!==manifest.threshold_sha256)throw Error('CHILL80_CONFIGURATION_CHANGED');
 const baselineRefs=[];
 for(const r of text){const b=baseline.find(c=>c.review_id===r.id);
  if(!b||b.status!=='completed'||b.organization_id!==r.organization_id||b.establishment_id!==r.establishment_id||
   b.configuration_id!=='v12_economy_1pass_v1'||b.analysis_text_sha256!==r.analysis_text_sha256||
   await hybridHash(b.theme_results)!==await hybridHash(economicThemeResults(b.response)))throw Error('CHILL80_HISTORICAL_BASELINE_CHANGED');
  baselineRefs.push({review_id:r.id,cache_id:b.id,analysis_text_sha256:b.analysis_text_sha256,configuration_id:b.configuration_id,
   instruction_sha256:b.instruction_sha256,threshold_sha256:b.threshold_sha256,served_model:b.served_model,
   response_sha256:await hybridHash(b.response),theme_results_sha256:await hybridHash(b.theme_results),purpose:'comparison_only_never_reused'});
 }
 if(execution.id!==CHILL80_BENCHMARK||execution.sha256!==await hybridHash(execution.body)||
 execution.body.targeted_protocol_id!==bp.id||execution.body.protocol_sha256!==bp.sha256)throw Error('CHILL80_BENCHMARK_CHANGED');
 for(const r of records)if(r.sha256!==await hybridHash(r.body)||r.body.execution_id!==execution.id)throw Error('CHILL80_RECORD_CHANGED');
 const reused:Chill80Analysis[]=[],rejected:{review_id:string;reason:string}[]=[];
 for(const old of bp.body.reviews){try{
  const r=text.find(r=>r.id===old.id),suffix=String(old.position).padStart(2,'0');
  const matches=(kind:string)=>records.filter(x=>x.kind===kind+'_'+suffix);
  if(matches('jev_targeted9_result').length!==1||matches('jev_targeted9_receipt').length!==1||matches('jev_targeted9_attempt').length!==1)throw Error('RESULT_RECEIPT_OR_ATTEMPT_MISSING');
  const result=matches('jev_targeted9_result')[0],receipt=matches('jev_targeted9_receipt')[0],attempt=matches('jev_targeted9_attempt')[0];
  if(!r||r.analysis_text!==old.analysis_text||r.analysis_text_sha256!==old.analysis_text_sha256||
   r.original_text_sha256!==old.original_text_sha256||r.analysis_language!==old.analysis_language||
   await hybridHash(r.translation_provenance)!==await hybridHash(old.translation_provenance))throw Error('TEXT_OR_TRANSLATION_CHANGED');
  if(result.body.status!=='completed'||result.body.error!==null||result.body.configuration_sha256!==manifest.config_sha256||
   result.body.protocol_sha256!==bp.sha256||receipt.body.protocol_sha256!==bp.sha256||
   result.body.receipt_id!==receipt.id||result.body.attempt_id!==attempt.id||receipt.body.attempt_id!==attempt.id||
   result.body.review_id!==r.id||receipt.body.review_id!==r.id||attempt.body.review_id!==r.id||
   receipt.body.http_status!==200||attempt.body.attempt_count!==1||receipt.body.attempt_count!==1||
   receipt.body.request_sha256!==old.request_sha256||attempt.body.request_sha256!==old.request_sha256||
   result.body.request_sha256!==old.request_sha256||receipt.body.request_raw_sha256!==old.request_raw_sha256||
   receipt.body.requested_model!=='jev-latest'||receipt.body.analysis_text_sha256!==r.analysis_text_sha256||
   typeof receipt.body.raw_response_text!=='string'||await negativeHash(receipt.body.raw_response_text)!==receipt.body.response_raw_sha256)throw Error('RESULT_PROVENANCE_INCOMPATIBLE');
  const raw=JSON.parse(receipt.body.raw_response_text),parsed=await parseTargetedJevResult(bp,r.id,raw);
  if(await hybridHash(parsed)!==await hybridHash(result.body.result)||parsed.served_model!=='jev-1.13.0')throw Error('MODEL_OR_CLASSIFICATION_INCOMPATIBLE');
  reused.push({review_id:r.id,analysis_text_sha256:r.analysis_text_sha256!,configuration_id:manifest.configuration.id,
   served_model:parsed.served_model,native:parsed.native,theme_results:parsed.theme_results,usage:parsed.usage,
   duration_ms:Number(receipt.body.duration_ms),provenance:{kind:'reused_benchmark',result_id:result.id,receipt_id:receipt.id,result_sha256:result.sha256,receipt_sha256:receipt.sha256}});
 }catch(e){rejected.push({review_id:old.id,reason:e instanceof Error?e.message:'INCOMPATIBLE'});}}
 if(reused.length!==9)throw new Chill80CompatibilityError(reused.length,rejected);
 const pending=[];let alias=10;
 for(const r of text)if(!reused.some(x=>x.review_id===r.id)){
  const payload=auditEconomyPayload('review_'+String(alias++).padStart(2,'0'),r.analysis_text!);
  pending.push({position:pending.length+1,review_id:r.id,analysis_text_sha256:r.analysis_text_sha256!,request_state:payload.state,
   request_sha256:await hybridHash(payload),request_raw_sha256:await negativeHash(JSON.stringify(payload))});
 }
 const policy={max_jev_calls:71,expected_analysed_reviews:80,total_snapshot_reviews:100,textless_reviews:20,expected_classifications:2000,
  max_calls_per_review:1,repeat_count:1,client_max_attempts:1,concurrency:1,automatic_retry:false,no_fallback_api:true,
  no_model_probe_call:true,requested_model:'jev-latest',required_served_model:'jev-1.13.0',model_drift:'stop_without_retry_preserve_receipt',
  uncertain_dispatch_is_consumed:true,reserve_atomically_before_dispatch:true,max_luna_calls:0,max_sol_calls:0,max_apify_calls:0,
  reports_generated:0,new_specific_authenticated_go_required:true,production_enabled:false};
 const body={version:CHILL80_VERSION,classification_code_commit:bp.body.code_commit,organization_id:source.body.organization_id,establishment_id:source.body.establishment_id,
  authority_user_id:source.body.authority_user_id,source_protocol_id:source.id,source_protocol_sha256:source.sha256,
  source_historical_report_id:CHILL80_SOURCE,source_snapshot_sha256:source.body.snapshot.source_sha256,
  reviews,source_reviews_sha256:await hybridHash(reviews),configuration_id:manifest.configuration.id,configuration_sha256:manifest.config_sha256,
  instruction_sha256:manifest.instruction_sha256,threshold_sha256:manifest.threshold_sha256,
  requested_model:'jev-latest',required_served_model:'jev-1.13.0',request_template:{model:'jev-latest',questions:manifest.configuration.questions},
  policy,policy_sha256:await hybridHash(policy),reused, reuses_sha256:await hybridHash(reused),pending,
  pending_sha256:await hybridHash(pending),baseline:baselineRefs,baseline_sha256:await hybridHash(baselineRefs),
  benchmark:{protocol_id:bp.id,protocol_sha256:bp.sha256,execution_id:execution.id,execution_sha256:execution.sha256},
  star_distribution_100:Object.fromEntries([1,2,3,4,5].map(n=>[n,reviews.filter(r=>r.rating===n).length])),
  star_distribution_80:Object.fromEntries([1,2,3,4,5].map(n=>[n,text.filter(r=>r.rating===n).length])),
  result_contract:{all_25_native_distributions:true,thresholded_results_separate:true,persist_raw_before_parse:true,
   actual_usage_and_duration:true,reused_usage_separate_from_new_usage:true,distinct_review_counts:true,historical_delta_cells:2000,
   textless_have_no_themes:true,denominators:[100,80],historical_data_read_only:true,qualitative_audit:'user_analysis_chat'},
  status:'sealed_preparation_only',spending_authorization:null,run_id:null,supplier_calls:0,production_enabled:false};
 return {body,sha256:await hybridHash(body)};
}
export type Chill80Protocol=Awaited<ReturnType<typeof prepareChill80>>;
export async function verifyChill80(p:Chill80Protocol){
 const b=p.body,m=await auditBoundaryManifest();
 if(p.sha256!==await hybridHash(b)||b.version!==CHILL80_VERSION||b.configuration_sha256!==m.config_sha256||
 b.instruction_sha256!==m.instruction_sha256||b.threshold_sha256!==m.threshold_sha256||b.pending.length!==71||b.reused.length!==9||
 b.reviews.length!==100||new Set([...b.reused.map(r=>r.review_id),...b.pending.map(r=>r.review_id)]).size!==80||
 b.source_reviews_sha256!==await hybridHash(b.reviews)||b.reuses_sha256!==await hybridHash(b.reused)||
 b.pending_sha256!==await hybridHash(b.pending)||b.baseline_sha256!==await hybridHash(b.baseline)||
 b.policy_sha256!==await hybridHash(b.policy)||b.policy.max_jev_calls!==71||b.policy.client_max_attempts!==1||b.policy.automatic_retry!==false||
 b.policy.no_model_probe_call!==true||b.policy.max_luna_calls!==0||b.policy.max_sol_calls!==0||b.policy.max_apify_calls!==0||
 b.required_served_model!=='jev-1.13.0'||await hybridHash(b.request_template)!==await hybridHash({model:'jev-latest',questions:m.configuration.questions}))throw Error('CHILL80_PROTOCOL_CHANGED');return true;
}
export async function parseChill80(p:Chill80Protocol,review_id:string,raw:unknown){
 const r=p.body.reviews.find(r=>r.id===review_id);if(!r?.analysis_text||!p.body.pending.some(x=>x.review_id===review_id))throw Error('CHILL80_REVIEW_OUT_OF_SCOPE');
 if(!raw||typeof raw!=='object'||Object.keys((raw as {answers:object}).answers??{}).length!==25)throw Error('JEV_ALL_25_REQUIRED');
 const parsed=parseThemes(raw);
 if(parsed.model!==p.body.required_served_model)throw Error('CHILL80_MODEL_DRIFT_NO_RETRY');
 return {review_id,analysis_text_sha256:r.analysis_text_sha256!,configuration_id:p.body.configuration_id,served_model:parsed.model,
  native:parsed.decision,theme_results:economicThemeResults(parsed.decision),usage:parsed.usage,response_sha256:await hybridHash(raw)};
}
export async function aggregateChill80(p:Chill80Protocol,analyses:Chill80Analysis[],baseline:Chill80Baseline[]){
 await verifyChill80(p);
 if(analyses.length!==80||new Set(analyses.map(r=>r.review_id)).size!==80||baseline.length!==80||new Set(baseline.map(r=>r.review_id)).size!==80)throw Error('CHILL80_COMPLETE_80_REQUIRED');
 for(const a of analyses){const r=p.body.reviews.find(r=>r.id===a.review_id),old=p.body.baseline.find(b=>b.review_id===a.review_id),b=baseline.find(b=>b.id===old?.cache_id);
  if(!r?.analysis_text||a.analysis_text_sha256!==r.analysis_text_sha256||a.configuration_id!==p.body.configuration_id||
   a.served_model!==p.body.required_served_model||await hybridHash(a.theme_results)!==await hybridHash(economicThemeResults(a.native))||
   !b||await hybridHash(b.response)!==old?.response_sha256||await hybridHash(b.theme_results)!==old?.theme_results_sha256)throw Error('CHILL80_AGGREGATE_INCOMPATIBLE');
  const reuse=p.body.reused.find(r=>r.review_id===a.review_id);
  if(reuse?await hybridHash(a)!==await hybridHash(reuse):a.provenance.kind!=='new_execution'||!a.provenance.result_id||!a.provenance.receipt_id)throw Error('CHILL80_RESULT_PROVENANCE_CHANGED');
 }
 const ordered=[...analyses].sort((a,b)=>a.review_id.localeCompare(b.review_id));
 const differences=ordered.flatMap(a=>{const b=baseline.find(b=>b.review_id===a.review_id)!;return THEME_KEYS.map(theme_key=>({review_id:a.review_id,theme_key,
  historical_native:b.response.themes[theme_key],new_native:a.native.themes[theme_key],historical_thresholded:b.theme_results[theme_key],new_thresholded:a.theme_results[theme_key],
  native_choice_changed:b.response.themes[theme_key].choice!==a.native.themes[theme_key].choice,
  thresholded_choice_changed:b.theme_results[theme_key].choice!==a.theme_results[theme_key].choice}));});
 const usage=(rows:Chill80Analysis[])=>({reviews:rows.length,input_tokens:rows.reduce((n,r)=>n+r.usage.input_tokens,0),output_tokens:rows.reduce((n,r)=>n+r.usage.output_tokens,0),duration_ms:rows.reduce((n,r)=>n+r.duration_ms,0)});
 return {version:'jev-chill-reanalysis80-dataset-v1',protocol_sha256:p.sha256,denominators:{all_reviews:100,with_text:80,analysed:80,without_text:20},
  analyses:ordered,counts:{native:chill80Counts(ordered,'native'),thresholded:chill80Counts(ordered,'thresholded')},
  historical_counts:{native:chill80Counts(baseline.map(b=>({...b,native:b.response})),'native'),thresholded:chill80Counts(baseline.map(b=>({...b,native:b.response})),'thresholded')},
  differences,usage:{reused_historical:usage(analyses.filter(a=>a.provenance.kind==='reused_benchmark')),new_calls:usage(analyses.filter(a=>a.provenance.kind==='new_execution'))},
  textless_review_ids:p.body.reviews.filter(r=>!r.original_text.trim()).map(r=>r.id),historical_data_modified:false,qualitative_audit:'user_analysis_chat'};
}
