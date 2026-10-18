// New experimental identity. V11/V12/V13 and the original economy config stay frozen.
import {ECONOMY_CONFIG} from './jev-economy-config.ts';
import {V12_COMMON_RULES} from './jev-v12-config.ts';
import {THEME_DEFINITIONS,type ThemeKey} from './jev-themes.ts';
import {UNTRUSTED} from './jev.ts';
import {economyIdentity,type EconomyIdentity} from './jev-economy-cache.ts';
import {negativeHash} from './negative-validation-core.ts';
import {canonicalJson} from './jev-exploratory-core.ts';
export const AUDIT_BOUNDARIES_VERSION='jev-audit-boundaries-v2.2';
export const AUDIT_ECONOMY_ID='v12_economy_audit_boundaries_v2_1pass_v1';
export const AUDIT_QUESTION_SET='themes_v12_audit_boundaries_v2';
export const AUDIT_BOUNDARIES=Object.freeze({
 portions:'Evaluate the quantity of FOOD actually served. A small pot rim, opening, vessel or utensil that makes scooping difficult is equipment usability, not evidence of too little food. Ordering too many dishes for the party describes the customers ordering choice, not automatically an oversized or insufficient portion. A separately explicit judgment that the served portion itself was too small, generous or excessive can qualify. Do not transfer either polarity from vessel size or the number of dishes ordered.',
 order_accuracy:'Retain wrong/missing items and include an explicitly requested food customization reported as not followed: for example less chilli requested but the received dish still had no reduced spiciness. Keep this reported request/outcome signal even when the customer speculates about a cause. A conjecture that food was prepared in advance is not an established preparation fact. Spicy food alone, a request without its outcome, or an expressly fulfilled request does not establish an order error.',
 communication:'Retain direct customer interaction, explanations, understanding and evaluated information. Also include explicit criticism of commercial information communicated to diners, such as lunch buffet offers advertised during dinner. Such criticism can be negative communication despite overall praise; it does not by itself prove deception, an unavailable menu or a billing error. A neutral mention of an advertisement or a generic hypothetical concern is insufficient. Preserve unclear/contradictory reservation messages and any later resolution.',
 billing:'Fees, bills, surcharges and explicitly unclear fee information, including parking. A customer reporting an unclear parking charge or asking the restaurant to clarify whether a fee exists and its amount can express a negative billing-transparency signal, even without a known amount or completed payment. A bare hypothetical question without a reported unclear experience remains ambiguous. Preserve uncertainty about fee existence, amount and who operates parking. Do not infer overcharging, arithmetic error, illegality, restaurant fault, high price or poor value from that request.',
 coordination:'Evaluate described service organization, coordination or workflow: synchronized courses, staff handoffs, allocation of tables or explicit organizational breakdowns. Good service or excellent service ALONE does not establish positive coordination. Timing or friendliness alone also does not establish coordination. Do not apply this narrower coordination boundary to attentiveness or professionalism: retain their complete validated V12 definitions, including evaluated customer care and evaluated service execution without requiring explicit expertise.',
 drinks:'Evaluate beverage quality, taste or preparation. Waiting for a beverage belongs to wait_time, not drinks quality. Beverage quality and arrival time may have different polarities. Do not transfer a beverage-delay verdict to a drinks-quality association or conversely.',
} satisfies Partial<Record<ThemeKey,string>>);
const freeze=<T>(v:T):T=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const questions=structuredClone(ECONOMY_CONFIG.questions);
for(const theme of Object.keys(AUDIT_BOUNDARIES) as (keyof typeof AUDIT_BOUNDARIES)[]){
 const q=questions[theme] as Record<string,unknown>;
 // Replace, rather than append to, the contradictory inherited coordination rule.
 q.instructions=`Determine whether the analytical review expresses an opinion about ${THEME_DEFINITIONS[theme]}. ${V12_COMMON_RULES} ${AUDIT_BOUNDARIES[theme]} ${UNTRUSTED}`;
}
export const AUDIT_ECONOMY_CONFIG=freeze({...structuredClone(ECONOMY_CONFIG),id:AUDIT_ECONOMY_ID,
 question_set:AUDIT_QUESTION_SET,instruction_version:AUDIT_QUESTION_SET,questions,
 instruction_baseline:'V12 full definitions plus versioned audit boundaries; not a new supplier model',
 semantic_diagnostic_version:AUDIT_BOUNDARIES_VERSION,paid_enabled:false,production_enabled:false});
export function auditEconomyPayload(review_alias:string,analysis_text:string){
 if(!analysis_text.trim()||!review_alias.trim())throw Error('ECONOMY_TEXTLESS');
 return {model:'jev-latest',state:{review_alias,analysis_text},questions:structuredClone(AUDIT_ECONOMY_CONFIG.questions)};
}
export async function auditEconomyIdentity(org:string,est:string,review:string,text:string,served:string):Promise<EconomyIdentity>{
 const old=await economyIdentity(org,est,review,text,served);
 return {...old,configuration_id:AUDIT_ECONOMY_ID,instruction_version:AUDIT_QUESTION_SET,
 instruction_sha256:await negativeHash(canonicalJson(AUDIT_ECONOMY_CONFIG.questions))};
}
export async function auditBoundaryManifest(){return {version:AUDIT_BOUNDARIES_VERSION,
 configuration:AUDIT_ECONOMY_CONFIG,config_sha256:await negativeHash(canonicalJson(AUDIT_ECONOMY_CONFIG)),
 instruction_sha256:await negativeHash(canonicalJson(AUDIT_ECONOMY_CONFIG.questions)),
 threshold_sha256:await negativeHash(canonicalJson(AUDIT_ECONOMY_CONFIG.thresholds)),
 new_paid_calls:0,spending_authorization:null,production_enabled:false};}
