import {explicitOrderError,autonomousOrderSpan,explicitServingTemperature} from "../functions/_shared/jls-order-evidence-v2.ts";
import {ACTION_FOCUS_V2,recommendationInstructionsV2,recommendationSchemaV2,RECOMMENDATION_CONFIG} from "../functions/_shared/jls-recommendation-contract-v2.ts";
import {ACTION_FOCUS} from "../functions/_shared/jev-luna-sol-prioritized.ts";
const assert=(x:unknown)=>{if(!x)throw Error("ASSERTION");};
Deno.test("versioned schema has temperature without changing historical cooking scope",()=>{
 assert(ACTION_FOCUS_V2.food_temperature.theme==="temperature"&&ACTION_FOCUS.food_preparation.theme==="cooking");
 assert(!("food_temperature" in ACTION_FOCUS));
 assert(JSON.stringify(recommendationSchemaV2()).includes("comparison_context")&&recommendationInstructionsV2("vi").includes("DIRECT"));
 assert(RECOMMENDATION_CONFIG.paid_enabled===false&&RECOMMENDATION_CONFIG.production_enabled===false);
});
Deno.test("order excerpt is autonomous, exact and distinct from generic service criticism",()=>{
 const source="They got things wrong. They only brought one drink instead of the two ordered.";
 const span=autonomousOrderSpan(source);assert(span&&source.slice(span.start,span.end)===span.quote&&explicitOrderError(span.quote));
 assert(!explicitOrderError("They got things wrong."));
});
Deno.test("temperature context stays separate from beverages and intended cold food",()=>{
 assert(explicitServingTemperature({quote:"The soup arrived cold.",context:"The soup arrived cold."}));
 assert(!explicitServingTemperature({quote:"The beer was served cold.",context:"The beer was served cold."}));
 assert(!explicitServingTemperature({quote:"The soup arrived cold.",context:"It was meant to be served cold."}));
});

