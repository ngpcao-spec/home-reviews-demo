// Future selector only. Never transfers an old Luna verdict to a new quote.
import {negativeHash} from "./negative-validation-core.ts";
import {hybridHash,HYBRID_LIMITS,type HybridEvidence} from "./jev-hybrid-evidence.ts";
import type {PilotSnapshot} from "./jev-pilot-core.ts";
import {balancedCandidates,selectBalancedEvidence} from "./jev-hybrid-balanced.ts";
import type {EconomyCache} from "./jev-economy-cache.ts";

export const ORDER_SELECTOR_VERSION="jls-autonomous-order-evidence-v2";
export function explicitOrderError(quote:string,context=quote){
 const q=quote.replace(/[’‘ʼ]/g,"'").toLowerCase(),c=context.replace(/[’‘ʼ]/g,"'").toLowerCase();
 if(/\?|\b(?:if|maybe|perhaps|might|would|hypothetically|not sure)\b/.test(q)||
  /\b(?:i|we) (?:chose|picked|selected|ordered).{0,25}\bwrong\b/.test(q)||
  /\b(?:did not|didn't|never).{0,20}(?:get|bring|serve|deliver|receive).{0,20}(?:wrong|incorrect)\b/.test(q)||
  /\b(?:no|not|nothing) (?:was )?(?:missing|wrong|incorrect|forgotten)|\b(?:correct|right) order\b/.test(q)||
  /\b(?:thought|assumed|mistaken).{0,80}(?:missing|wrong)|\b(?:actually|in fact).{0,30}(?:correct|right|nothing missing)/.test(c))return false;
 const item="(?:order|dish|item|meal|drink|coffee|tea|soup|starter|dessert|steak|pizza|roll|ice)";
 return new RegExp("\\b(?:wrong|incorrect|missing|forgotten)\\b.{0,35}\\b"+item,"i").test(q)||
  new RegExp("\\b"+item+".{0,20}\\b(?:was |were |is )?(?:missing|forgotten)\\b","i").test(q)||
  new RegExp("\\b(?:did not|didn't|never|failed to|forgot to).{0,20}(?:bring|serve|deliver).{0,35}\\b"+item,"i").test(q)||
  /\b(?:brought|served|delivered|received)\b.{0,25}\b(?:wrong|incorrect)\b/.test(q)||
  /\b(?:only|just)\b.{0,20}\b(?:brought|served|delivered|received|gave)\b.{0,80}\binstead of\b.{0,40}\border(?:ed)?\b/.test(q);
}
export function explicitServingTemperature(e:Pick<HybridEvidence,"quote"|"context">){
 const q=e.quote.replace(/[’‘ʼ]/g,"'").toLowerCase(),c=e.context.toLowerCase();
 if(/\?|\b(?:if|maybe|perhaps|might|would|hypothetically|not sure)\b/.test(q)||
  /\b(?:not|never|wasn't|weren't|isn't) (?:served|arrived) cold|\bnot cold\b/.test(q)||
  /\b(?:intended|supposed|meant) to be (?:served )?cold\b/.test(c))return false;
 // A narrow antecedent check: the last named entity before the serving
 // temperature must be food, rather than a drink or the room/weather.
 return [...q.matchAll(/\b(?:served|arrived) cold\b|\blukewarm\b/g)].some(m=>{
  const prefix=q.slice(0,m.index),food=[...prefix.matchAll(/\b(?:food|dishes?|meal|soup|steak|pasta|rice|noodles|rolls|pizza|chicken|fish|pots)\b/g)].at(-1)?.index??-1,
   other=[...prefix.matchAll(/\b(?:beer|coffee|tea|drink|juice|room|weather|air)\b/g)].at(-1)?.index??-1;
  return food>=0&&food>other;
 });
}
export function actionSupportV2(e:HybridEvidence,focus:string):boolean|undefined {
 if(focus==="food_temperature")return explicitServingTemperature(e);
 if(focus==="order_execution")return explicitOrderError(e.quote,e.context);
 return undefined;
}
export function autonomousOrderSpan(text:string){
 const spans=[...text.matchAll(/[^.!?\n]+(?:[.!?\n]+|$)/g)].flatMap(sentence=>{
  const all=[{index:sentence.index,text:sentence[0]}];
  for(const clause of sentence[0].matchAll(/[^,;]+/g))all.push({index:sentence.index+clause.index,text:clause[0]});
  return all.map(s=>{const start=s.index+s.text.length-s.text.trimStart().length,end=s.index+s.text.trimEnd().length;
   return {start,end,quote:text.slice(start,end)};});
 }).filter(s=>s.quote.length<=HYBRID_LIMITS.quote_characters&&
  !/\b(?:on|for|in|with) the (?:first|second|other)\b|\b(?:it|them|that one|this one)\b/i.test(s.quote)&&explicitOrderError(s.quote,text));
 return spans.sort((a,b)=>a.quote.length-b.quote.length||a.start-b.start)[0]??null;
}
export async function refineOrderEvidence<T extends HybridEvidence>(e:T,text:string){
 if(e.theme_key!=="order_accuracy"||e.polarity!=="negative"||e.status==="explicitly_contested")return e;
 if(await negativeHash(text)!==e.analysis_text_sha256)throw Error("ORDER_SELECTOR_TEXT_CHANGED");
 const span=autonomousOrderSpan(text);if(!span||span.quote===e.quote)return e;
 const contextStart=e.context_start<=span.start&&e.context_end>=span.end?e.context_start:0,
  contextEnd=e.context_start<=span.start&&e.context_end>=span.end?e.context_end:text.length;
 const quote_sha256=await negativeHash(span.quote),context=text.slice(contextStart,contextEnd);
 return {...e,evidence_id:await hybridHash({version:ORDER_SELECTOR_VERSION,review_id:e.review_id,theme_key:e.theme_key,
  polarity:e.polarity,analysis_text_sha256:e.analysis_text_sha256,quote_sha256,context_sha256:await negativeHash(context)}),
  quote:span.quote,quote_start:span.start,quote_end:span.end,quote_sha256,context,context_start:contextStart,context_end:contextEnd,
  context_sha256:await negativeHash(context),context_truncated:contextStart>0||contextEnd<text.length,
  status:"sol_candidate" as const,excerpt_method:ORDER_SELECTOR_VERSION,prior_evidence_id:e.evidence_id,
  v3_status:"review_needed",v3_reason:"NEW_QUOTE_REQUIRES_FRESH_VERIFICATION",
  v3_flags:[...e.v3_flags,"QUOTE_CHANGED_NO_INHERITED_VERDICT"],
  requires_new_luna_verification:true,luna_verdict:null,
  selection_reason:"AUTONOMOUS_ORDER_ERROR_NEW_QUOTE_NO_INHERITED_VERDICT"};
}
export async function futureRecommendationCandidates(snapshot:PilotSnapshot,cache:EconomyCache[]){
 const old=await balancedCandidates(snapshot,cache,[]);
 const candidates=await Promise.all(old.map(e=>refineOrderEvidence(e,snapshot.source.reviews.find(r=>r.id===e.review_id)!.analysis_text!)));
 return {version:ORDER_SELECTOR_VERSION,candidates,selected:selectBalancedEvidence(candidates,32),new_paid_calls:0,
  spending_authorization:null,production_enabled:false};
}

