// Offline review and explicit structural derivative, never a rewritten Sol result.
import {hybridHash} from "./jev-hybrid-evidence.ts";
import {negativeHash} from "./negative-validation-core.ts";
import {validateEditorialReport} from "./jls-editorial-validation.ts";
import {buildRecommendationDraftV2,validateRecommendationReportV2,RECOMMENDATION_VERSION} from "./jls-recommendation-contract-v2.ts";
import {refineOrderEvidence,explicitOrderError,ORDER_SELECTOR_VERSION} from "./jls-order-evidence-v2.ts";
import {acceptedSolDossier,type JlsPlan,type JlsDecision} from "./jev-luna-sol.ts";
import type {PilotSnapshot} from "./jev-pilot-core.ts";
export const RECOMMENDATION_REVIEW_VERSION="jls-recommendation-review-v2";
export interface ReviewInput {run_id:string;operation_id:string;protocol_id:string;protocol_sha256:string;
 original:{body:Record<string,unknown>;sha256:string};plan:JlsPlan;snapshot:PilotSnapshot;decisions:JlsDecision[]}
type Native = Parameters<typeof validateEditorialReport>[0];
export function nativeSolReport(body:Record<string,unknown>){
 const response=body.response as {output:{type:string;content?:{type:string;text?:string}[]}[]};
 const texts=response?.output?.filter(x=>x.type==="message").flatMap(x=>x.content??[]).filter(x=>x.type==="output_text");
 if(texts?.length!==1||!texts[0].text)throw Error("RECOMMENDATION_SOURCE_RESPONSE_INVALID");
 return JSON.parse(texts[0].text);
}
export function structuralRecommendationRevision(source:unknown,statisticsSha:string){
 const raw=structuredClone(source) as {format_version:string;report:{recommendations:{proposed_action:{focus:string;text:string};observations:{theme_key:string;polarity:string}[];priority:{frequency_keys:string[];comparison_context?:{key:string;statistics_sha256:string}[]}}[]}};
 const changes:{path:string;before:unknown;after:unknown;reason:string}[]=[];
 const set=(target:Record<string,unknown>,key:string,value:unknown,path:string,reason:string)=>{
  changes.push({path,before:target[key]??null,after:value,reason});target[key]=value;
 };
 set(raw,"format_version",RECOMMENDATION_VERSION,"/format_version","EXPLICIT_DERIVED_FORMAT_NOT_PROVIDER_OUTPUT");
 for(const [i,a] of raw.report.recommendations.entries()){
  if(a.proposed_action.focus==="food_preparation"&&a.observations.some(o=>o.theme_key==="temperature"&&o.polarity==="negative")&&
   !a.observations.some(o=>o.theme_key==="cooking")&&/nhiệt độ|giữ ấm|nguội|temperature|chaud|froid|warm|cold/iu.test(a.proposed_action.text))
   set(a.proposed_action,"focus","food_temperature",`/report/recommendations/${i}/proposed_action/focus`,"TEMPERATURE_SCOPE_SEPARATE_FROM_COOKING");
  const direct=a.priority.frequency_keys.filter(key=>a.observations.some(o=>o.theme_key+":"+o.polarity===key));
  const global=a.priority.frequency_keys.filter(key=>!direct.includes(key)).map(key=>({key,statistics_sha256:statisticsSha}));
  if(global.length)set(a.priority,"frequency_keys",direct,`/report/recommendations/${i}/priority/frequency_keys`,"KEEP_ONLY_DIRECT_OBSERVATION_FREQUENCIES");
  set(a.priority,"comparison_context",global,`/report/recommendations/${i}/priority/comparison_context`,"GLOBAL_COUNTS_ARE_CONTEXT_NOT_INCIDENT_EVIDENCE");
 }
 return {raw,changes};
}
export async function buildRecommendationReview(input:ReviewInput,provenance:{commit:string;files:Record<string,string>}){
 const {original,plan:p,snapshot,decisions}=input,o=original.body;
 if(await hybridHash(o)!==original.sha256||!o.response||await hybridHash(o.response)!==o.response_sha256||
  typeof o.raw_response_text!=="string"||await negativeHash(o.raw_response_text)!==o.raw_response_sha256||
  !/^[a-f0-9]{40}$/.test(provenance.commit)||Object.keys(provenance.files).length<4)throw Error("RECOMMENDATION_REVIEW_SOURCE_CHANGED");
 const raw=nativeSolReport(o),originalReplay=await validateEditorialReport(raw as Native,p,snapshot,decisions,"vi");
 if(await hybridHash(originalReplay)!==await hybridHash(o.validated_report))throw Error("ORIGINAL_REPLAY_CHANGED");
 const native=await acceptedSolDossier(p,decisions);
 const order=p.selected.filter(e=>e.theme_key==="order_accuracy"&&e.polarity==="negative");
 const compatibleOrder=order.filter(e=>native.accepted_ids.includes(e.evidence_id)&&explicitOrderError(e.quote,e.context));
 const candidates=[];
 for(const e of order){
  const text=snapshot.source.reviews.find(r=>r.id===e.review_id)?.analysis_text;if(!text)throw Error("ORDER_SOURCE_MISSING");
  const next=await refineOrderEvidence(e,text);
  if(next.evidence_id!==e.evidence_id)candidates.push({...next,luna_verdict:null,status:"requires_luna",selector_version:ORDER_SELECTOR_VERSION});
 }
 const revision=structuralRecommendationRevision(raw,p.statistics_sha256);
 const validation=await validateRecommendationReportV2(revision.raw,p,snapshot,decisions,"vi");
 const future=await buildRecommendationDraftV2(p,decisions,"vi");
 const {estimates:_estimates,token_certificate:_certificate,...futureWithoutEstimates}=future;
 const body={version:RECOMMENDATION_REVIEW_VERSION,run_id:input.run_id,operation_id:input.operation_id,
  source_protocol_id:input.protocol_id,source_protocol_sha256:input.protocol_sha256,original_result_sha256:original.sha256,
  source_response_sha256:o.response_sha256,source_raw_response_sha256:o.raw_response_sha256,source_report_sha256:await hybridHash(raw),
  source_plan_sha256:await hybridHash(p),snapshot_sha256:await hybridHash(snapshot),decisions_sha256:await hybridHash(decisions),provenance,
  original_revalidation:{kind:"unchanged_original_content",validation:originalReplay,validation_sha256:await hybridHash(originalReplay),content_unchanged:true},
  derivative:{kind:"codex_offline_structural_revision_not_sol_output",source_report_sha256:await hybridHash(raw),raw:revision.raw,
   raw_sha256:await hybridHash(revision.raw),changes:revision.changes,validation,validation_sha256:await hybridHash(validation),text_and_sources_unchanged:true},
  order_candidates:candidates,compatible_accepted_order_evidence_ids:compatibleOrder.map(e=>e.evidence_id),
  future_preparation:futureWithoutEstimates,new_paid_calls:0,spending_authorization:null,new_paid_run:null,
  human_validated:false,semantic_truth_guaranteed:false,production_enabled:false};
 return {body,sha256:await hybridHash(body)};
}
export type RecommendationReview=Awaited<ReturnType<typeof buildRecommendationReview>>;

