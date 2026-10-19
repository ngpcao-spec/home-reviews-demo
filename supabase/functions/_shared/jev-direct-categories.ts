// Independent experimental taxonomy. No import or aggregation of the 25 themes.
import {UNTRUSTED,parseUsage,type JevUsage,type SystemOnePayload} from './jev.ts';
import {analysisTextSha256} from './analysis-text.ts';

export const DIRECT_CATEGORY_KEYS=['service','price','quality','ambiance'] as const;
export type DirectCategory=typeof DIRECT_CATEGORY_KEYS[number];
export const DIRECT_LABELS=['positive','negative','mixed','neutral','not_mentioned'] as const;
export type DirectLabel=typeof DIRECT_LABELS[number];
// Abstention is NOT a sixth sentiment and is never converted to not_mentioned.
export const DIRECT_NATIVE_CHOICES=[...DIRECT_LABELS,'uncertain'] as const;
export type DirectNativeChoice=typeof DIRECT_NATIVE_CHOICES[number];
export const DIRECT_DEFINITIONS={
 service:{label_fr:'Service',scope_fr:'Accueil, personnel, attention, attente, commandes, explications et réservations.',
  scope_en:'Welcome and reception, staff, customer attention, waiting and speed of service, order handling, explanations and reservations.'},
 price:{label_fr:'Prix',scope_fr:'Niveau de prix, rapport qualité/prix, facture, frais et clarté des tarifs.',
  scope_en:'Price level, value for money, bill, charges and fees, and clarity or disclosure of prices and charges.'},
 quality:{label_fr:'Qualité des plats',scope_fr:'Goût, fraîcheur, cuisson, température et maintien au chaud, quantité, présentation, choix du menu et boissons.',
  scope_en:'Taste, freshness, cooking and preparation, food serving temperature and keeping food warm, food quantity, presentation, menu choice and availability, and beverage quality.'},
 ambiance:{label_fr:'Ambiance',scope_fr:'Atmosphère, décoration, bruit, confort et propreté des lieux.',
  scope_en:'Atmosphere, decoration, noise, physical comfort and cleanliness of the premises.'},
} as const;
export const DIRECT_CRITERIA={
 positive:'Only favorable appreciation of this category is expressed. No unfavorable appreciation of this category.',
 negative:'Only unfavorable appreciation of this category is expressed. No favorable appreciation of this category.',
 mixed:'Both favorable AND unfavorable appreciations are expressed within this same category, including different facets of that category.',
 neutral:'An explicitly neutral or middling appreciation of this category, such as neither good nor bad, with no favorable or unfavorable appreciation.',
 not_mentioned:'No appreciation of this category is expressed. Mere facts without evaluation do not establish an appreciation. This is not uncertainty.',
 uncertain:'The text appears to concern this category but its category attachment or evaluative meaning cannot be determined reliably from the text. Abstain; do not call this not_mentioned.',
} as const;
export const DIRECT_RULES=[
 'Classify this category DIRECTLY from analysis_text. Evaluate the four categories independently; a review may evaluate several categories. Do not first classify or aggregate narrower themes.',
 'Use only the customer text, never stars, ratings, presumed reputation, other reviews or metadata. Do not infer an appreciation from a fact alone.',
 'CATEGORY BOUNDARIES: Good service alone is service positive ONLY; it does not establish food quality, price or ambiance. Good beverages with slow delivery means quality positive and service negative. Beverage waiting time is service; beverage taste is quality.',
 'WITHIN-CATEGORY MIXING: Friendly staff but slow service is service mixed. Delicious food but poor drinks is quality mixed because food and beverages belong to the same category here. A favorable appreciation in one category and an unfavorable appreciation in another do not make either category mixed.',
 'PRICE FACTS: A monetary amount alone, a listed price, or the mere presence of tax is not a price opinion. Explicit unclear fees or poorly announced charges can concern price transparency; do not invent an arithmetic error, overcharge, illegality or who is responsible.',
 'NEUTRAL VERSUS ABSENCE: Average or neither good nor bad may be explicitly neutral. Mere description with no category appreciation is not_mentioned. Neutral does not mean uncertain. A neutral remark alongside a clear favorable-only appreciation does not create mixed; mixed requires favorable AND unfavorable appreciations.',
 'QUALIFIED LANGUAGE: Not extraordinary alone must not automatically become negative. Preserve context: good but not extraordinary can remain positive; explicitly middling/neutral may be neutral. If evaluative polarity remains ambiguous, use uncertain rather than inventing criticism or absence.',
 'NEGATION AND CONTEXT: Respect negation, comparisons, irony, mixed opinions, who is speaking, changes over time and later resolution. Do not erase a reported problem solely because it was later addressed; do not invent an earlier or continuing problem either.',
 'SCOPE: Geographic location, distance, directions and accessibility are not automatically ambiance. Do not force an out-of-scope remark into any category. Vessel or utensil dimensions alone do not judge food quantity; ordering too many dishes alone does not judge portion size.',
 'CAUSALITY: Preserve customer hypotheses as hypotheses. Reported symptoms after a meal do not establish a medical cause or responsibility. Do not infer a cause, fault or responsible party absent textual support.',
 'UNCERTAINTY: Use the separate uncertain choice for unresolved attachment or sentiment. Do not use not_mentioned as a substitute for ambiguity. No confidence threshold is specified; return the native supported choice format only.',
 UNTRUSTED,
].join('\n');
function freeze<T>(x:T):T{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;}
export const DIRECT_CONFIG=freeze({id:'jev_categories4_direct_1pass_v1',question_set:'categories4_direct_v1',
 version:'jev-direct-categories-v1',parser_version:'jev-direct-categories-parser-v1',requested_model:'jev-latest',
 endpoint_contract:'typesafe-systemone-choice-criteria-v1',repeat_count:1,max_attempts_per_review:1,
 automatic_retry:false,model_probe_calls:0,confidence_threshold:null,threshold_policy:'native_choice_no_confidence_filter',
 categories:DIRECT_DEFINITIONS,labels:DIRECT_LABELS,abstention_choice:'uncertain',
 questions:Object.fromEntries(DIRECT_CATEGORY_KEYS.map(k=>[k,{type:'choice',
  instructions:`Classify the appreciation of this category: ${DIRECT_DEFINITIONS[k].scope_en}\n${DIRECT_RULES}`,
  criteria:{...DIRECT_CRITERIA}}])),paid_enabled:false,production_enabled:false});

export function directCanonical(value:unknown):string{
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(directCanonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+directCanonical((value as Record<string,unknown>)[k])).join(',')+'}';
 throw Error('JEV_DIRECT_NON_JSON_VALUE');
}
export const directHash=(value:unknown)=>analysisTextSha256(directCanonical(value));
export function directCategoryPayload(review_alias:string,analysis_text:string):SystemOnePayload{
 if(!review_alias.trim()||!analysis_text.trim())throw Error('JEV_DIRECT_TEXT_REQUIRED');
 return {model:DIRECT_CONFIG.requested_model,state:{review_alias,analysis_text},questions:structuredClone(DIRECT_CONFIG.questions)};
}
function object(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('JEV_DIRECT_INVALID_RESPONSE');return value as Record<string,unknown>;
}
function probability(value:unknown){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)throw Error('JEV_DIRECT_INVALID_PROBABILITY');return value;}
export interface DirectCategoryAnswer {native_choice:DirectNativeChoice|null;classification:DirectLabel|null;
 status:'classified'|'uncertain'|'refused';probabilities:Record<DirectNativeChoice,number>|null;
 native_confidence:number|null;raw_answer:Record<string,unknown>}
export interface DirectCategoryResult {version:string;model:string;usage:JevUsage|null;telemetry_warnings:string[];
 categories:Record<DirectCategory,DirectCategoryAnswer>;raw_response:Record<string,unknown>;
 probability_diagnostics?:DirectProbabilityDiagnostic[]}
// Parser policy only: the frozen supplier configuration and its cache identity stay unchanged.
export const DIRECT_ROUNDING_PARSER_VERSION='jev-direct-categories-parser-v1.1-rounding';
export const DIRECT_PROBABILITY_SUM_TOLERANCE=0.01;
export interface DirectProbabilityDiagnostic {category:DirectCategory;code:'PROBABILITY_SUM_ROUNDING'|'PROBABILITY_SUM_OUTSIDE_TOLERANCE';
 received_sum:number;absolute_deviation:number;absolute_tolerance:number;floating_margin:string;normalized:false}
export function parseDirectCategories(raw:unknown):DirectCategoryResult{
 return parseCategories(raw,false);
}
export function parseDirectCategoriesRounded(raw:unknown):DirectCategoryResult{
 return parseCategories(raw,true);
}
function parseCategories(raw:unknown,rounding:boolean):DirectCategoryResult{
 const data=object(raw),answers=object(data.answers),categories={} as Record<DirectCategory,DirectCategoryAnswer>;
 const diagnostics:DirectProbabilityDiagnostic[]=[];
 if(typeof data.model!=='string'||!data.model.trim()||Object.keys(answers).sort().join()!==[...DIRECT_CATEGORY_KEYS].sort().join())throw Error('JEV_DIRECT_FOUR_ANSWERS_REQUIRED');
 for(const k of DIRECT_CATEGORY_KEYS){
  const a=object(answers[k]);
  if(a.type==='refusal'){
   // Defensive preservation, not a claim that the provider supports this variant.
   categories[k]={native_choice:null,classification:null,status:'refused',probabilities:null,native_confidence:null,raw_answer:structuredClone(a)};continue;
  }
  if(a.type!=='choice'||!DIRECT_NATIVE_CHOICES.includes(a.choice as DirectNativeChoice))throw Error('JEV_DIRECT_INVALID_CHOICE');
  const choice=a.choice as DirectNativeChoice;let probabilities:Record<DirectNativeChoice,number>|null=null;
  if(a.probabilities!==undefined&&a.probabilities!==null){const p=object(a.probabilities);
   if(Object.keys(p).sort().join()!==[...DIRECT_NATIVE_CHOICES].sort().join())throw Error('JEV_DIRECT_INVALID_DISTRIBUTION');
   probabilities=Object.fromEntries(DIRECT_NATIVE_CHOICES.map(c=>[c,probability(p[c])])) as Record<DirectNativeChoice,number>;
   // Numerical format validity only. This is NOT a confidence/classification threshold.
   const sum=Object.values(probabilities).reduce((s,n)=>s+n,0),deviation=Math.abs(sum-1);
   if(rounding){
    // Bound floating-point addition error for six finite probabilities; not an extra statistical tolerance.
    const margin=8*Number.EPSILON*Math.max(1,Math.abs(sum),DIRECT_NATIVE_CHOICES.length);
    const outside=deviation>DIRECT_PROBABILITY_SUM_TOLERANCE+margin;
    const diagnostic:DirectProbabilityDiagnostic={category:k,code:outside?'PROBABILITY_SUM_OUTSIDE_TOLERANCE':'PROBABILITY_SUM_ROUNDING',
     // Lossless string avoids JS/JSONB canonical-hash differences for this very small exponent.
     received_sum:sum,absolute_deviation:deviation,absolute_tolerance:DIRECT_PROBABILITY_SUM_TOLERANCE,floating_margin:String(margin),normalized:false};
    if(outside)throw Object.assign(Error('JEV_DIRECT_DISTRIBUTION_OUTSIDE_TOLERANCE'),{diagnostic});
    if(deviation>margin)diagnostics.push(diagnostic);
   }else if(deviation>1e-6)throw Error('JEV_DIRECT_INVALID_DISTRIBUTION');
  }
  categories[k]={native_choice:choice,classification:choice==='uncertain'?null:choice,status:choice==='uncertain'?'uncertain':'classified',
   probabilities,native_confidence:a.confidence===undefined||a.confidence===null?null:probability(a.confidence),raw_answer:structuredClone(a)};
 }
 let usage:JevUsage|null=null;const telemetry_warnings:string[]=[];
 try{usage=parseUsage(data.usage);}catch{telemetry_warnings.push('USAGE_MISSING_OR_INVALID');}
 return {version:rounding?DIRECT_ROUNDING_PARSER_VERSION:DIRECT_CONFIG.parser_version,model:data.model,usage,telemetry_warnings,categories,raw_response:structuredClone(data),
  ...(rounding?{probability_diagnostics:diagnostics}:{})};
}
export interface DirectCountRow {review_id:string;result:DirectCategoryResult|null}
export function directCategoryCounts(expectedReviewIds:readonly string[],rows:DirectCountRow[]){
 if(new Set(expectedReviewIds).size!==expectedReviewIds.length||new Set(rows.map(r=>r.review_id)).size!==rows.length||
  rows.some(r=>!expectedReviewIds.includes(r.review_id)))throw Error('JEV_DIRECT_DUPLICATE_OR_FOREIGN_REVIEW');
 for(const row of rows)if(row.result){
  const r=row.result,rounded=r.version===DIRECT_ROUNDING_PARSER_VERSION;
  if(!rounded&&r.version!==DIRECT_CONFIG.parser_version)throw Error('JEV_DIRECT_RESULT_CHANGED');
  const verified=rounded?parseDirectCategoriesRounded(r.raw_response):parseDirectCategories(r.raw_response);
  if(directCanonical(verified.categories)!==directCanonical(r.categories)||
   (rounded&&directCanonical(verified.probability_diagnostics)!==directCanonical(r.probability_diagnostics??null)))throw Error('JEV_DIRECT_RESULT_CHANGED');
 }
 const byCategory=Object.fromEntries(DIRECT_CATEGORY_KEYS.map(k=>{
  const ids=(status:string)=>expectedReviewIds.filter(id=>{const a=rows.find(r=>r.review_id===id)?.result?.categories[k];
   if(status==='unavailable')return !a;if(!a)return false;
   return status==='uncertain'||status==='refused'?a.status===status:a.status==='classified'&&a.classification===status;});
  const exclusive=Object.fromEntries([...DIRECT_LABELS,'uncertain','refused','unavailable'].map(c=>[c,ids(c).length]));
  const positive=[...new Set([...ids('positive'),...ids('mixed')])].sort(),negative=[...new Set([...ids('negative'),...ids('mixed')])].sort();
  const mentioned=[...new Set([...positive,...negative,...ids('neutral')])].sort();
  return [k,{exclusive,positive_including_mixed:positive.length,negative_including_mixed:negative.length,
   distinct_mentioned_reviews:mentioned.length,positive_review_ids:positive,negative_review_ids:negative,
   mentioned_review_ids:mentioned,denominator_reviews:expectedReviewIds.length}];
 })) as Record<DirectCategory,{exclusive:Record<string,number>;positive_including_mixed:number;negative_including_mixed:number;
  distinct_mentioned_reviews:number;positive_review_ids:string[];negative_review_ids:string[];mentioned_review_ids:string[];denominator_reviews:number}>;
 return {total_reviews:expectedReviewIds.length,received_results:rows.filter(r=>r.result).length,
  any_category_mentioned_reviews:new Set(Object.values(byCategory).flatMap(c=>c.mentioned_review_ids)).size,
  categories:byCategory,aggregation:'one_review_once_per_category; mixed_in_both_polarities; total_is_unique_source_reviews_never_sum_of_categories',
  confidence_filter_applied:false,human_reference:false};
}
