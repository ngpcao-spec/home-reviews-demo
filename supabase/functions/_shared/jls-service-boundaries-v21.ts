// Narrow experimental rules. Historical V12, V3 and V2 rules stay immutable.
import {negativeHash} from "./negative-validation-core.ts";
import {hybridHash,HYBRID_LIMITS,type HybridEvidence} from "./jev-hybrid-evidence.ts";
import {futureRecommendationCandidates} from "./jls-order-evidence-v2.ts";
import {selectBalancedEvidence} from "./jev-hybrid-balanced.ts";
import {estimateDecisionPayload} from "./decisions-preparation.ts";
import type {PilotSnapshot} from "./jev-pilot-core.ts";
import type {EconomyCache} from "./jev-economy-cache.ts";
import type {JlsPlan} from "./jev-luna-sol.ts";
export const SERVICE_BOUNDARIES_V21="jls-reservation-beverage-boundaries-v2.1";
export const SERVICE_CLASSIFICATION_INSTRUCTIONS=[
 "Classify only the exact quotation in its full context. Drinks means beverage quality, taste or preparation; waiting for beverages is wait_time, not drinks quality. A mixed review can praise beverages and criticize their arrival time independently. Never infer a theme from Google stars.",
 "Communication includes explicitly conflicting or unclear reservation confirmations exchanged with staff. A customer's question alone does not prove a contradiction, a double booking or staff fault. Preserve ambiguity about the room versus a buffet option, negations, later clarification and resolution. Do not broaden other communication criteria.",
 "A different theme, quote, polarity, question or configuration requires fresh verification; no historical Luna verdict transfers to it."
].join("\n");
const norm=(s:string)=>s.replace(/[’‘ʼ]/g,"'").toLowerCase();
const booking=/\b(?:reserv(?:ation|ed|e)|booking|booked|room|table)\b/;
export function reservationConfirmationSignal(quote:string,context:string){
 const q=norm(quote),c=norm(context);
 const result={supported:false,resolved:false,customer_question:q.includes("?"),established_fault:false};
 if(!context.includes(quote)||!booking.test(q)||/\b(?:if|hypothetically|might|would have|perhaps)\b/.test(q))return result;
 if(/\b(?:never|did not|didn't|had not|hadn't|not)\s+(?:actually\s+)?(?:confirm|confirmed|reserve|reserved)\b/.test(c)||
  /\b(?:never|did not|didn't) (?:say|said|tell|told|state|stated).{0,45}(?:confirmed|reserved)\b/.test(c)||
  /\b(?:no|not|without) (?:conflict|contradiction|confusion)|\b(?:i|we) (?:misread|misunderstood)|\bactually.{0,40}(?:never|not) confirm/.test(c))return result;
 const confirmed=/\b(?:staff|they|restaurant|host|manager|waiter|receptionist)\b.{0,70}(?:confirmed (?:our|my|the|your) (?:booking|reservation|table|room)|(?:reserved|held) (?:the |a |our |your )?(?:room|table) for (?:you|us|me)|(?:said|replied|informed).{0,100}(?:reserved|held) (?:the |a |our |your )?(?:room|table) for (?:you|us|me)|(?:said|replied|informed).{0,80}(?:room|table).{0,25}(?:was |is )?reserved)\b/.test(c);
 const conflict=/\b(?:said|told|replied|informed).{0,80}(?:already reserved|reserved|booked).{0,35}(?:another|other) (?:customer|party|guest)|\b(?:later|then).{0,50}(?:said|told|informed).{0,45}(?:unavailable|not available|not reserved)|\b(?:conflicting|contradictory|unclear) (?:booking |reservation )?(?:confirmations?|messages?)\b/.test(c);
 const explicit=/\b(?:staff|they|restaurant).{0,50}(?:sent|gave|provided).{0,40}(?:conflicting|contradictory|unclear).{0,35}(?:booking|reservation|confirmation)\b/.test(q);
 const resolved=/\b(?:later|eventually|finally).{0,45}(?:resolved|sorted|clarified|cleared up|fixed)|\boffered (?:us |me )?an alternative\b/.test(c)&&
  !/\b(?:not|never|wasn't|was not) resolved\b/.test(c);
 return {...result,supported:confirmed&&conflict||explicit,resolved};
}
export function beverageDelaySpan(text:string){
 for(const m of text.matchAll(/[^.!?\n]+(?:[.!?]+|$)/g)){
  const q=norm(m[0]);
  if(/\?|\b(?:if|hypothetically|might|would|perhaps)\b|\b(?:no|not|never) (?:long )?(?:wait|delay)|\b(?:didn't|did not) (?:wait|take long)|\b(?:weren't|were not|wasn't|was not|not|never) (?:actually )?(?:late|delayed)|\b(?:actually|mistaken).{0,35}\b(?:on time|quickly)\b/.test(q))continue;
  if(/\b(?:drinks?|beverages?|coffee|tea|coca-cola|cocktails?|beer)\b.{0,70}\b(?:took (?:too long|a long time)|(?:arrived|came) (?:very )?late|were delayed)|\bwait(?:ed|ing)?\b.{0,15}\blong\b.{0,35}\b(?:drinks?|beverages?|coffee|tea|coca-cola|beer)\b/.test(q)){
   const start=m.index+m[0].length-m[0].trimStart().length,end=m.index+m[0].trimEnd().length;
   if(end-start<=HYBRID_LIMITS.quote_characters)return {start,end,quote:text.slice(start,end)};
  }
 }
 return null;
}
export function negativeDrinkQuality(quote:string){
 const q=norm(quote);
 return /\b(?:drinks?|coffee|tea|beverages?|cocktails?|beer)\b.{0,35}\b(?:tasted? (?:bad|awful|terrible|sour)|(?:was|were) (?:bad|awful|terrible|watery|bitter|too sweet))|\b(?:bad|awful|terrible|watery|bitter) (?:drinks?|coffee|tea|beverages?)\b/.test(q)&&
  !/\b(?:not|never) (?:bad|awful|terrible|watery|bitter)\b|\b(?:if|hypothetically|perhaps|might)\b/.test(q);
}
export function beverageActionIsDelay(text:string){
 return /\b(?:wait|waiting|delay|arrival|attente|délais?|acheminement)\b|thời gian|chờ|đến chậm|ra bàn/iu.test(text)&&
  /\b(?:drinks?|beverages?|coffee|tea|coca-cola|boissons?|café|thé)\b|đồ uống|trà|cà phê/iu.test(text);
}
export async function refineServiceEvidence<T extends HybridEvidence>(e:T,text:string){
 if(e.status==="explicitly_contested"||e.polarity!=="negative")return e;
 if(await negativeHash(text)!==e.analysis_text_sha256)throw Error("JLS_SERVICE_SELECTOR_TEXT_CHANGED");
 const delay=beverageDelaySpan(text);
 if(e.theme_key==="drinks"&&delay&&!negativeDrinkQuality(e.quote))return {...e,
  quality:{...("quality" in e?e.quality as object:{}),eligible:false,reason:"BEVERAGE_DELAY_NOT_DRINK_QUALITY"}};
 if(e.theme_key!=="wait_time"||!delay)return e;
 // Retain its actual JEV wait_time association. Never retag a drinks verdict.
 const context=text,quote_sha256=await negativeHash(delay.quote),context_sha256=await negativeHash(context);
 return {...e,evidence_id:await hybridHash({version:SERVICE_BOUNDARIES_V21,review_id:e.review_id,theme_key:e.theme_key,
  polarity:e.polarity,analysis_text_sha256:e.analysis_text_sha256,quote_sha256,context_sha256}),
  quote:delay.quote,quote_start:delay.start,quote_end:delay.end,quote_sha256,context,context_start:0,context_end:text.length,context_sha256,
  context_truncated:false,status:"sol_candidate" as const,v3_status:"review_needed",v3_reason:"NEW_SERVICE_QUOTE_REQUIRES_VERIFICATION",
  excerpt_method:SERVICE_BOUNDARIES_V21,prior_evidence_id:e.evidence_id,requires_new_luna_verification:true,luna_verdict:null,
  quality:{...("quality" in e?e.quality as object:{}),eligible:true,reason:"EXPLICIT_BEVERAGE_WAIT_NO_TRANSFERRED_VERDICT"}};
}
export async function futureServiceCandidates(snapshot:PilotSnapshot,cache:EconomyCache[]){
 const old=await futureRecommendationCandidates(snapshot,cache);
 const candidates=await Promise.all(old.candidates.map(e=>refineServiceEvidence(e,snapshot.source.reviews.find(r=>r.id===e.review_id)!.analysis_text!)));
 return {version:SERVICE_BOUNDARIES_V21,candidates,selected:selectBalancedEvidence(candidates,32),new_paid_calls:0,
  spending_authorization:null,production_enabled:false};
}
// Free, versioned grouped questions for a future protocol, never old verdicts.
export async function futureServiceQuestions(p:JlsPlan){
 const groups=await Promise.all(p.luna_groups.map(async g=>{
  const payload=structuredClone(g.payload);
  payload.questions=payload.questions.map(q=>({...q,instructions:q.instructions+"\n"+SERVICE_CLASSIFICATION_INSTRUCTIONS}));
  return {...g,payload,request_sha256:await hybridHash(payload),questions_sha256:await hybridHash(payload.questions),
   estimated_input_tokens:estimateDecisionPayload(payload).estimated_input_tokens};
 }));
 return {version:SERVICE_BOUNDARIES_V21,configuration_sha256:await hybridHash({source:p.config_sha256,instructions:SERVICE_CLASSIFICATION_INSTRUCTIONS}),
  source_configuration_sha256:p.config_sha256,groups,manifest_sha256:await hybridHash(groups),max_calls:groups.length,
  paid_enabled:false,spending_authorization:null};
}
