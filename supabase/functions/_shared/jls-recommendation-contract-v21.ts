// Explicit new preparation/validator identity; historical V2 stays frozen.
import {buildRecommendationDraftV2,recommendationResponseV2,RECOMMENDATION_CONFIG,ACTION_FOCUS_V2} from "./jls-recommendation-contract-v2.ts";
import {validatePrioritizedBindings,type BoundResponse} from "./jev-luna-sol-prioritized-validation.ts";
import {editorialReportControls} from "./jls-editorial-validation.ts";
import {JLS_DISCLOSURE_VALIDATOR} from "./jls-fee-disclosure.ts";
import {actionSupportV2} from "./jls-order-evidence-v2.ts";
import {reservationConfirmationSignal,beverageDelaySpan,beverageActionIsDelay,negativeDrinkQuality,SERVICE_BOUNDARIES_V21,SERVICE_CLASSIFICATION_INSTRUCTIONS} from "./jls-service-boundaries-v21.ts";
import {hybridHash} from "./jev-hybrid-evidence.ts";
import {negativeHash} from "./negative-validation-core.ts";
import {attachPlanTokenMemo,planTokenMemo,planTokens,tokenCertificate} from "./jls-token-memo.ts";
import {solRequestSize} from "./jls-sol-size.ts";
import type {JlsPlan,JlsDecision} from "./jev-luna-sol.ts";
import type {PilotSnapshot} from "./jev-pilot-core.ts";
export const CONTRACT_V21="jls-recommendation-contract-v2.1";
export const VALIDATOR_V21="jls-reservation-beverage-validation-v2.1";
export const CONFIG_V21=Object.freeze({...RECOMMENDATION_CONFIG,version:CONTRACT_V21,validator_version:VALIDATOR_V21,
 selector_version:SERVICE_BOUNDARIES_V21,classification_boundary_version:SERVICE_BOUNDARIES_V21,
 reservation_policy:"confirmation_ambiguity_not_established_fault_v1",beverage_delay_policy:"wait_time_service_delay_exact_accepted_only_v1"});
export async function buildRecommendationDraftV21(sourcePlan:JlsPlan,decisions:JlsDecision[],language:"fr"|"vi"=sourcePlan.language){
 const p={...sourcePlan};await attachPlanTokenMemo(p);
 const old=await buildRecommendationDraftV2(p,decisions,language);
 const prompt=old.prompt+"\n"+SERVICE_CLASSIFICATION_INSTRUCTIONS+"\n"+[
  "RESERVATION ACTION: communication may support clarifying or reviewing reservation confirmations ONLY when the accepted quote and context explicitly describe conflicting/unclear messages with staff. A customer question alone is insufficient. Report the customer's uncertainty, never conclude that double booking or a staff fault is established. Distinguish a room reservation from a buffet option and retain any later clarification or resolution.",
  "BEVERAGE DELAY ACTION: An action about waiting for drinks uses wait_time, axis service, topic service_flow and focus service_delay, with an exact compatible Luna ACCEPTED wait_time negative quotation. Direct frequencies must be wait_time:negative. A drinks verdict, even on the same sentence or review, cannot transfer to wait_time. If no compatible accepted proof exists, omit this action or leave it for review. Beverage taste or preparation remains drinks. Do not rewrite JEV statistics.",
 ].join("\n");
 const config={...old.config,...CONFIG_V21,input_budget_tokens:old.config.input_budget_tokens},packet={...old.packet,editorial_version:CONTRACT_V21,
  service_boundary_policy:{version:SERVICE_BOUNDARIES_V21,booking:"reported_confirmation_ambiguity_not_double_booking_fact",beverage_wait:"wait_time:negative; service_delay; new_verification_if_binding_changes"}};
 const request={...old.request,input:[{role:"system",content:prompt},{role:"user",content:JSON.stringify(packet)}]};
 const certificate=await tokenCertificate(p),measurement=solRequestSize(request,p.sol_size_policy,planTokenMemo(p)?.count);
 return {...old,version:CONTRACT_V21,config,packet,prompt,request,config_sha256:await hybridHash(config),
  prompt_sha256:await negativeHash(prompt),dossier_sha256:await hybridHash(packet),request_sha256:await hybridHash(request),
  measurement,local_request_tokens:planTokens(p,JSON.stringify(request)),token_certificate:certificate,token_certificate_sha256:await hybridHash(certificate),
  new_paid_calls:0,spending_authorization:null,execution_protocol:null};
}
const bookingAction=(a:{text:string;kind:string})=>["clarify","review"].includes(a.kind)&&
 /réservation|confirmation|đặt (?:phòng|bàn|chỗ)|xác nhận|booking|reservation/iu.test(a.text);
export async function validateRecommendationReportV21(raw:unknown,p:JlsPlan,snapshot:PilotSnapshot,decisions:JlsDecision[],language:"fr"|"vi"=p.language,
 prepared?:Awaited<ReturnType<typeof buildRecommendationDraftV21>>){
 const parsed=recommendationResponseV2.parse(raw),draft=prepared??await buildRecommendationDraftV21(p,decisions,language);
 const base=await validatePrioritizedBindings(raw,parsed as BoundResponse,p,snapshot,decisions,language,JLS_DISCLOSURE_VALIDATOR,draft,ACTION_FOCUS_V2,true,(e,focus)=>{
  if(focus==="communication"){
   const signal=reservationConfirmationSignal(e.quote,e.context);
   if(signal.supported)return parsed.report.recommendations.some(a=>a.proposed_action.focus===focus&&a.evidence_ids.includes(e.evidence_id)&&bookingAction(a.proposed_action));
  }
  if(focus==="service_delay"&&beverageDelaySpan(e.quote))return e.theme_key==="wait_time";
  if(focus==="drinks"&&beverageDelaySpan(e.quote)&&!negativeDrinkQuality(e.quote))return false;
  return actionSupportV2(e,focus);
 });
 const controlled=editorialReportControls(base.report,p,language);
 const recommendations=controlled.recommendations.map(a=>{
  const reasons=[...a.reasons],signals=a.observations.map(o=>reservationConfirmationSignal(o.quote,o.context_quote));
  if(a.proposed_action.focus==="communication"&&signals.some(s=>s.supported)){
   if(!bookingAction(a.proposed_action))reasons.push("RESERVATION_CLARIFICATION_ACTION_REQUIRED");
   const prose=[a.title,a.proposed_action.text,...a.observations.flatMap(o=>[o.text,o.context_summary])].join(" ");
   if(/double réservation|surbooking|double.book(?:ed|ing)|faute (?:du personnel|établie)|lỗi (?:của )?nhân viên|đặt trùng|trùng đặt|đã xác nhận.{0,20}lỗi/iu.test(prose))reasons.push("RESERVATION_FAULT_NOT_ESTABLISHED");
   if(signals.some(s=>s.resolved)&&!a.observations.every(o=>/résolu|clarifié|alternative|réglé|đã.{0,25}(?:giải quyết|làm rõ|khắc phục)|phương án khác|sắp xếp lại/iu.test(o.context_summary)))reasons.push("RESERVATION_RESOLUTION_CONTEXT_OMITTED");
  }
  if(beverageActionIsDelay(a.proposed_action.text)&&a.proposed_action.focus!=="service_delay")reasons.push("BEVERAGE_DELAY_REQUIRES_WAIT_TIME_EVIDENCE");
  return {...a,reasons:[...new Set(reasons)],visible:!reasons.length,status:reasons.length?"review_needed" as const:"technically_bound_proposal" as const};
 });
 return {...base,editorial_version:CONTRACT_V21,validator_version:VALIDATOR_V21,report:{...controlled,recommendations},
  configuration_sha256:draft.config_sha256,priority_coverage:draft.coverage,
  translation_fidelity_guaranteed:false,priority_selection_semantically_verified:false};
}
