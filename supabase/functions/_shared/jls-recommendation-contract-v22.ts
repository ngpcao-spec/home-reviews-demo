// Future-only contract. No historical result is replayed or rewritten by deployment.
// deno-lint-ignore no-import-prefix
import {z} from 'npm:zod@4.6.5';
import {recommendationResponseV2,recommendationSchemaV2,ACTION_FOCUS_V2} from './jls-recommendation-contract-v2.ts';
import {buildRecommendationDraftV21,CONFIG_V21} from './jls-recommendation-contract-v21.ts';
import {validatePrioritizedBindings,type BoundResponse} from './jev-luna-sol-prioritized-validation.ts';
import {editorialReportControls} from './jls-editorial-validation.ts';
import {JLS_DISCLOSURE_VALIDATOR} from './jls-fee-disclosure.ts';
import {actionSupportV2} from './jls-order-evidence-v2.ts';
import {reservationConfirmationSignal,beverageDelaySpan,negativeDrinkQuality,beverageActionIsDelay} from './jls-service-boundaries-v21.ts';
import {requestedCustomizationSignal,commercialCommunicationSignal,parkingFeeSignal,auditAssociationBoundary} from './jls-audit-boundaries-v22.ts';
import {AUDIT_BOUNDARIES_VERSION} from './jev-audit-boundaries-v22.ts';
import {hybridHash} from './jev-hybrid-evidence.ts';
import {negativeHash} from './negative-validation-core.ts';
import {attachPlanTokenMemo,planTokenMemo,planTokens,tokenCertificate} from './jls-token-memo.ts';
import {solRequestSize} from './jls-sol-size.ts';
import type {JlsPlan,JlsDecision} from './jev-luna-sol.ts';
import type {PilotSnapshot} from './jev-pilot-core.ts';
export const CONTRACT_V22='jls-recommendation-contract-v2.2-audit-boundaries';
export const ACTION_FOCUS_V22=Object.freeze({...ACTION_FOCUS_V2,
 order_customization:{theme:'order_accuracy',claims:[]},commercial_communication:{theme:'communication',claims:[]},
 parking_fee_clarification:{theme:'billing',claims:[]}});
export const CONFIG_V22=Object.freeze({...CONFIG_V21,version:CONTRACT_V22,
 validator_version:'jls-audit-boundary-validation-v2.2',classification_boundary_version:AUDIT_BOUNDARIES_VERSION,
 selector_version:AUDIT_BOUNDARIES_VERSION,paid_enabled:false,production_enabled:false});
const oldRec=recommendationResponseV2.shape.report.shape.recommendations.element;
export const recommendationResponseV22=recommendationResponseV2.extend({report:recommendationResponseV2.shape.report.extend({
 recommendations:z.array(oldRec.extend({proposed_action:oldRec.shape.proposed_action.extend({
 focus:z.enum(Object.keys(ACTION_FOCUS_V22) as [string,...string[]])}).strict()}).strict()).max(5)}).strict()}).strict();
export const AUDIT_REPORT_INSTRUCTIONS=[
 'AUDIT BOUNDARIES V2.2: Vessel usability and customers ordering too much are not automatically food-quantity complaints. Do not recommend increasing portions from those statements. Do not rewrite JEV frequencies.',
 'ORDER CUSTOMIZATION: Use order_customization for an exact ACCEPTED order_accuracy negative quote describing the requested change and reported unmet outcome. Preserve a speculative pre-made explanation as the customer hypothesis, not an established cause; preserve subsequent correction.',
 'COMMERCIAL INFORMATION: Use commercial_communication for exact ACCEPTED communication negative evidence criticizing lunch promotions displayed during dinner. Review timing and clarity, without asserting deception or unavailable dishes.',
 'PARKING FEES: Use parking_fee_clarification for exact ACCEPTED billing negative evidence reporting unclear parking fee existence or amount. Propose checking/clarifying the fee; retain uncertainty and any later explanation. Do not infer overcharging, calculation errors, illegality, or who is responsible.',
 'JEV attention and professionalism retain full V12 definitions. Evidence-selection rules do not narrow their historical classification meaning. Generic good service alone does not establish coordination.',
].join('\n');
export async function buildRecommendationDraftV22(plan:JlsPlan,decisions:JlsDecision[],language:'fr'|'vi'=plan.language){
 const p={...plan};await attachPlanTokenMemo(p);const old=await buildRecommendationDraftV21(p,decisions,language);
 const prompt=old.prompt+'\n'+AUDIT_REPORT_INSTRUCTIONS,schema=recommendationSchemaV2();
 schema.properties!.report.properties!.recommendations.items!.properties!.proposed_action.properties!.focus.enum=Object.keys(ACTION_FOCUS_V22);
 const config={...old.config,...CONFIG_V22},packet={...old.packet,editorial_version:CONTRACT_V22,action_focus:ACTION_FOCUS_V22};
 const request={...old.request,input:[{role:'system',content:prompt},{role:'user',content:JSON.stringify(packet)}],
 text:{format:{...old.request.text.format,name:'jls_recommendations_v22',schema}}};
 const measurement=solRequestSize(request,p.sol_size_policy,planTokenMemo(p)?.count),local_request_tokens=planTokens(p,JSON.stringify(request)),certificate=await tokenCertificate(p);
 return {...old,version:CONTRACT_V22,config,packet,prompt,schema,request,config_sha256:await hybridHash(config),
 prompt_sha256:await negativeHash(prompt),schema_sha256:await hybridHash(schema),dossier_sha256:await hybridHash(packet),
 request_sha256:await hybridHash(request),measurement,local_request_tokens,token_certificate:certificate,token_certificate_sha256:await hybridHash(certificate)};
}
const bookingAction=(a:{kind:string;text:string})=>['clarify','review'].includes(a.kind)&&/réservation|confirmation|đặt (?:phòng|bàn|chỗ)|xác nhận|booking|reservation/iu.test(a.text);
export async function validateRecommendationReportV22(raw:unknown,p:JlsPlan,snapshot:PilotSnapshot,decisions:JlsDecision[],language:'fr'|'vi'=p.language,
 prepared?:Awaited<ReturnType<typeof buildRecommendationDraftV22>>){
 const parsed=recommendationResponseV22.parse(raw),draft=prepared??await buildRecommendationDraftV22(p,decisions,language);
 const base=await validatePrioritizedBindings(raw,parsed as BoundResponse,p,snapshot,decisions,language,JLS_DISCLOSURE_VALIDATOR,draft,ACTION_FOCUS_V22,true,(e,focus)=>{
  if(auditAssociationBoundary(e.theme_key,e.polarity,e.quote,e.context).status==='explicitly_contested')return false;
  if(focus==='order_customization')return requestedCustomizationSignal(e.quote,e.context).supported;
  if(focus==='commercial_communication')return commercialCommunicationSignal(e.quote,e.context);
  if(focus==='parking_fee_clarification')return parkingFeeSignal(e.quote,e.context).supported;
  if(focus==='communication'&&reservationConfirmationSignal(e.quote,e.context).supported)
   return parsed.report.recommendations.some(a=>a.proposed_action.focus===focus&&a.evidence_ids.includes(e.evidence_id)&&bookingAction(a.proposed_action));
  if(focus==='service_delay'&&beverageDelaySpan(e.quote))return e.theme_key==='wait_time';
  if(focus==='drinks'&&beverageDelaySpan(e.quote)&&!negativeDrinkQuality(e.quote))return false;
  return actionSupportV2(e,focus);
 });
 const controlled=editorialReportControls(base.report,p,language),recommendations=controlled.recommendations.map(a=>{
  const reasons=[...a.reasons],focus=a.proposed_action.focus,prose=[a.title,a.proposed_action.text,...a.observations.flatMap(o=>[o.text,o.context_summary])].join(' ');
  if(['order_customization','commercial_communication','parking_fee_clarification'].includes(focus)&&!['clarify','inspect','review'].includes(a.proposed_action.kind))reasons.push('AUDIT_ACTION_MUST_REMAIN_A_PROPOSAL');
  if(focus==='order_customization'&&/préparé.{0,15}avance|pre.?made|làm sẵn|chuẩn bị sẵn/iu.test(prose)&&
   !/hypothèse|suppose|semble|selon le client|dường như|có vẻ|khách.{0,20}(?:cho rằng|phỏng đoán)/iu.test(prose))reasons.push('CUSTOMER_PREPARATION_HYPOTHESIS_NOT_FACT');
  if(focus==='order_customization'&&a.observations.some(o=>requestedCustomizationSignal(o.quote,o.context_quote).later_corrected)&&
   !/corrig|remplac|résolu|sửa|thay|khắc phục/iu.test(prose))reasons.push('CUSTOMIZATION_RESOLUTION_OMITTED');
  if(focus==='parking_fee_clarification'){
   if(/surfactur|trop factur|erreur de calcul|fraude|illégal|trách nhiệm.{0,10}nhà hàng|thu (?:sai|thừa)|tính sai|bất hợp pháp|lừa đảo/iu.test(prose))reasons.push('PARKING_CLARIFICATION_IS_NOT_OVERCHARGE_OR_FAULT');
   if(a.observations.some(o=>parkingFeeSignal(o.quote,o.context_quote).later_clarified)&&!a.observations.every(o=>/clarifi|expliqu|résolu|làm rõ|giải thích|giải quyết/iu.test(o.context_summary)))reasons.push('PARKING_LATER_CLARIFICATION_OMITTED');
  }
  if(focus==='communication'&&a.observations.some(o=>reservationConfirmationSignal(o.quote,o.context_quote).supported)){
   if(!bookingAction(a.proposed_action))reasons.push('RESERVATION_CLARIFICATION_ACTION_REQUIRED');
   if(/double réservation|surbooking|double.book|faute du personnel|lỗi nhân viên|đặt trùng|trùng đặt/iu.test(prose))reasons.push('RESERVATION_FAULT_NOT_ESTABLISHED');
   if(a.observations.some(o=>reservationConfirmationSignal(o.quote,o.context_quote).resolved)&&!a.observations.every(o=>/résolu|clarifié|alternative|réglé|đã.{0,25}(?:giải quyết|làm rõ|khắc phục)|phương án khác|sắp xếp lại/iu.test(o.context_summary)))reasons.push('RESERVATION_RESOLUTION_CONTEXT_OMITTED');
  }
  if(beverageActionIsDelay(a.proposed_action.text)&&focus!=='service_delay')reasons.push('BEVERAGE_DELAY_REQUIRES_WAIT_TIME_EVIDENCE');
  return {...a,reasons:[...new Set(reasons)],visible:!reasons.length,status:reasons.length?'review_needed' as const:'technically_bound_proposal' as const};
 });
 return {...base,editorial_version:CONTRACT_V22,validator_version:CONFIG_V22.validator_version,configuration_sha256:draft.config_sha256,
 report:{...controlled,recommendations},priority_coverage:draft.coverage,translation_fidelity_guaranteed:false,priority_selection_semantically_verified:false};
}
