import {auditEconomyPayload,AUDIT_ECONOMY_CONFIG} from '../functions/_shared/jev-audit-boundaries-v22.ts';
import {ECONOMY_CONFIG} from '../functions/_shared/jev-economy-config.ts';
import {portionBoundary,requestedCustomizationSignal,commercialCommunicationSignal,parkingFeeSignal,genericCoordinationOnly} from '../functions/_shared/jls-audit-boundaries-v22.ts';
const eq=(a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('ASSERTION_FAILED');};
globalThis.fetch=()=>{throw Error('PROVIDER_NETWORK_FORBIDDEN');};
Deno.test('configuration: 25 choices, unchanged thresholds and attention/professionalism',()=>{
 eq(Object.keys(auditEconomyPayload('r','English review.').questions).length,25);
 eq(AUDIT_ECONOMY_CONFIG.thresholds,ECONOMY_CONFIG.thresholds);
 eq(AUDIT_ECONOMY_CONFIG.questions.attentiveness,ECONOMY_CONFIG.questions.attentiveness);
 eq(AUDIT_ECONOMY_CONFIG.questions.professionalism,ECONOMY_CONFIG.questions.professionalism);
});
Deno.test('portion rule diagnostics, not JEV predictions',()=>{
 eq(portionBoundary('The hot pot rim was too small to scoop broth.').exclude_portion_inference,true);
 eq(portionBoundary('We ordered too many dishes.').exclude_portion_inference,true);
 eq(portionBoundary('The portion was too small.').explicit_food_quantity,true);
});
Deno.test('request mismatch versus spicy food alone and hypothetical outcome',()=>{
 eq(requestedCustomizationSignal('I asked for less spice, but the dish was still very spicy.').supported,true);
 eq(requestedCustomizationSignal('The dish was very spicy.').supported,false);
 eq(requestedCustomizationSignal('If I ordered less spice but it was still spicy, I would complain.').supported,false);
});
Deno.test('commercial communication criticism versus neutral information',()=>{
 eq(commercialCommunicationSignal('I would caution them not to advertise lunch buffet specials during dinner.'),true);
 eq(commercialCommunicationSignal('They advertised a lunch buffet.'),false);
});
Deno.test('parking clarification preserves uncertainty and does not invent a fee or fault',()=>{
 eq(parkingFeeSignal('The guard said the parking fee was negotiable; I am not sure if a fee exists, please clarify the parking fee.').supported,true);
 eq(parkingFeeSignal('Could you clarify the parking fee?').supported,false);
});
Deno.test('generic service is not organization',()=>{
 eq(genericCoordinationOnly('Good service.'),true);
 eq(genericCoordinationOnly('Good service; the staff worked together and courses arrived together.'),false);
});
