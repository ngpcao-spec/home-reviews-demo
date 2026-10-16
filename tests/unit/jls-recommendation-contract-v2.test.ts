import {beforeAll,afterAll,expect,it,vi} from "vitest";
import {prioritizedFixture} from "../fixtures/jev-luna-sol-prioritized";
import {hybridHash} from "../../supabase/functions/_shared/jev-hybrid-evidence";
import {negativeHash} from "../../supabase/functions/_shared/negative-validation-core";
import {prioritizedSchema,ACTION_FOCUS} from "../../supabase/functions/_shared/jev-luna-sol-prioritized";
import {validatePrioritizedReport} from "../../supabase/functions/_shared/jev-luna-sol-prioritized-validation";
import {buildRecommendationDraftV2,validateRecommendationReportV2,RECOMMENDATION_VERSION,recommendationSchemaV2,recommendationInstructionsV2} from "../../supabase/functions/_shared/jls-recommendation-contract-v2";
import {autonomousOrderSpan,explicitOrderError,explicitServingTemperature,refineOrderEvidence} from "../../supabase/functions/_shared/jls-order-evidence-v2";
import {structuralRecommendationRevision} from "../../supabase/functions/_shared/jls-recommendation-review-v2";

let net:ReturnType<typeof vi.spyOn>;
beforeAll(()=>{net=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("PROVIDER_NETWORK_FORBIDDEN"));});
afterAll(()=>{expect(net).not.toHaveBeenCalled();net.mockRestore();});
type Fixture=Awaited<ReturnType<typeof prioritizedFixture>>;
let base:Promise<Fixture>,temp:Promise<Fixture>,price:Promise<Fixture>;
function fixture(kind="base"){const f=()=>prioritizedFixture("fr",undefined,kind==="temp"?{2:{text:"The soup arrived cold. The waiter later apologised.",themes:["temperature:negative"]}}:kind==="price"?{2:{text:"The prices are expensive but the meal is worth the money.",themes:["price_level:negative","value:positive"]}}:{});
 if(kind==="temp")return temp??=f();if(kind==="price")return price??=f();return base??=f();}
async function rawFor(kind="base",theme="wait_time"){
 const f=await fixture(kind),raw=structuralRecommendationRevision(f.raw,f.p.statistics_sha256).raw;
 if(theme!=="wait_time"){
  const e=f.p.selected.find(e=>e.theme_key===theme&&e.polarity==="negative")!;
  const rec=raw.report.recommendations[0];Object.assign(rec,{axis:e.axis,topic:theme==="temperature"?"food_execution":"price_value",evidence_ids:[e.evidence_id],
   observations:[{text:"Un client décrit son expérience.",evidence_id:e.evidence_id,theme_key:e.theme_key,polarity:e.polarity,quote:e.quote,
    quote_sha256:e.quote_sha256,context_quote:e.context,context_sha256:await negativeHash(e.context),context_summary:"Le personnel a présenté des excuses ; le client décrit aussi son repas."}]});
  rec.proposed_action={text:theme==="temperature"?"Vérifier la température des plats au moment du service.":"Examiner les prix indiqués.",kind:"inspect",focus:theme==="temperature"?"food_temperature":"price_level"};
  rec.priority={rank:1,reason:"Ce signal précis mérite une vérification.",basis:"theme_frequency",frequency_keys:[theme+":negative"],comparison_context:[]};
 }
 return {f,raw};
}
it("V2 schema adds temperature and comparison contract without changing V1",async()=>{
 const before=await hybridHash(prioritizedSchema());const f=await fixture();const d=await buildRecommendationDraftV2(f.p,f.decisions);
 expect("food_temperature" in ACTION_FOCUS).toBe(false);expect(await hybridHash(prioritizedSchema())).toBe(before);
 expect(JSON.stringify(recommendationSchemaV2())).toContain("food_temperature");expect(JSON.stringify(recommendationSchemaV2())).toContain("comparison_context");
 expect(d.format_version).toBe(RECOMMENDATION_VERSION);expect(d.request.model).toBe("gpt-6.1-sol");expect(d.spending_authorization).toBeNull();
 expect(d.measurement.guarded_input_tokens).toBeLessThanOrEqual(32768);expect(recommendationInstructionsV2("vi")).toContain("no inherited Luna verdict");
 expect((await validatePrioritizedReport(f.raw,f.p,f.snapshot,f.decisions)).report.recommendations[0].visible).toBe(true);
});
it("explicit accepted food serving temperature supports its own focus",async()=>{
 const {f,raw}=await rawFor("temp","temperature"),v=await validateRecommendationReportV2(raw,f.p,f.snapshot,f.decisions);
 expect(v.report.recommendations[0].visible).toBe(true);
});
it("temperature never establishes cooking",async()=>{
 const {f,raw}=await rawFor("temp","temperature");raw.report.recommendations[0].proposed_action.focus="food_preparation";
 expect((await validateRecommendationReportV2(raw,f.p,f.snapshot,f.decisions)).report.recommendations[0].reasons).toContain("PRECISE_ACTION_REQUIRES_REVIEW");
});
it.each([
 ["The soup arrived cold.","The soup arrived cold.",true],
 ["The soup was not served cold.","The soup was not served cold.",false],
 ["The soup might be served cold.","The soup might be served cold.",false],
 ["The beer was served cold.","The beer was served cold.",false],
 ["The soup arrived cold.","This soup was meant to be served cold.",false],
 ["The soup arrived cold.","A cold beer was fine. The soup arrived cold.",true],
 ["The soup was great but the beer arrived cold.","The soup was great but the beer arrived cold.",false],
 ["The soup wasn't served cold.","The soup wasn't served cold.",false],
])("temperature distinction: %s",(quote,context,expected)=>expect(explicitServingTemperature({quote,context})).toBe(expected));
it.each([
 ["They served the wrong dish instead of the soup we ordered.",true],
 ["They only brought out one drink instead of the two ordered.",true],
 ["Not great: Despite the thousands of staff, they kept getting things wrong.",false],
 ["If they served the wrong dish we would complain.",false],
 ["Nothing was missing from the order.",false],
 ["We chose the wrong dish ourselves.",false],
 ["They didn't serve the wrong dish.",false],
])("autonomous order complaint: %s",(q,expected)=>expect(explicitOrderError(q)).toBe(expected));
it("real frozen order wording prioritizes the autonomous shortage, never the ambiguous second",()=>{
 const text="Not great: Despite the thousands of staff, they kept getting things wrong. Our shrimp rolls came out cold, they only brought out one drink instead of the two ordered, didn’t bring ice on the second, everything felt rushed and nobody was particularly friendly.";
 expect(autonomousOrderSpan(text)?.quote).toBe("they only brought out one drink instead of the two ordered");
});
it("new exact order quote gets a different identity and no inherited Luna acceptance",async()=>{
 const f=await fixture(),e={...f.p.selected[0],theme_key:"order_accuracy" as const,polarity:"negative" as const,
 quote:"They got things wrong.",quote_start:0,quote_end:22,context_start:0,context_end:100};
 const text="They got things wrong. They served the wrong dish instead of the soup we ordered.";
 e.analysis_text_sha256=await negativeHash(text);e.context=text;e.context_end=text.length;const hash=await hybridHash(e);
 const next=await refineOrderEvidence(e,text);
 expect(next.evidence_id).not.toBe(e.evidence_id);expect(next.status).toBe("sol_candidate");
 expect("luna_verdict" in next&&next.luna_verdict).toBeNull();expect(await hybridHash(e)).toBe(hash);
 await expect(refineOrderEvidence(e,text+" changed")).rejects.toThrow("ORDER_SELECTOR_TEXT_CHANGED");
});
it("direct frequencies stay bound to observations; global comparison has its own snapshot identity",async()=>{
 const {f,raw}=await rawFor("price","price_level");const a=raw.report.recommendations[0];
 a.priority.comparison_context=[{key:"value:positive",statistics_sha256:f.p.statistics_sha256}];
 const valid=await validateRecommendationReportV2(raw,f.p,f.snapshot,f.decisions);expect(valid.report.recommendations[0].visible).toBe(true);
 expect(valid.report.recommendations[0].comparison_frequency?.[0]).toMatchObject({key:"value:positive",scope:"snapshot_theme_comparison_not_incident_frequency"});
 a.priority.frequency_keys.push("value:positive");
 expect((await validateRecommendationReportV2(raw,f.p,f.snapshot,f.decisions)).report.recommendations[0].reasons).toContain("UNRELIABLE_OR_UNRELATED_FREQUENCY");
 a.priority.frequency_keys.pop();a.priority.comparison_context[0].statistics_sha256="0".repeat(64);
 expect((await validateRecommendationReportV2(raw,f.p,f.snapshot,f.decisions)).report.recommendations[0].reasons).toContain("COMPARISON_STATISTICS_CHANGED");
});
it("global context cannot replace direct frequency support or establish incident recurrence",async()=>{
 const {f,raw}=await rawFor("price","price_level");raw.report.recommendations[0].priority.frequency_keys=[];
 raw.report.recommendations[0].priority.comparison_context=[{key:"value:positive",statistics_sha256:f.p.statistics_sha256}];
 const v=await validateRecommendationReportV2(raw,f.p,f.snapshot,f.decisions);expect(v.report.recommendations[0].reasons).toContain("PRIORITY_FREQUENCY_BASIS_MISMATCH");
 raw.report.recommendations[0].priority.reason="Cet incident est récurrent.";
 expect((await validateRecommendationReportV2(raw,f.p,f.snapshot,f.decisions)).report.recommendations[0].reasons).toContain("UNSUPPORTED_FREQUENCY_NUMERIC_OR_CAUSAL_CLAIM");
});
it.each(["quote","context","polarity","hash"])("%s protection remains active in V2",async kind=>{
 const {f,raw}=await rawFor("temp","temperature"),o=raw.report.recommendations[0].observations[0] as unknown as Record<string,unknown>;
 if(kind==="quote")o.quote="A different quotation.";if(kind==="context")o.context_quote="Different context.";
 if(kind==="polarity")o.polarity="positive";if(kind==="hash")o.quote_sha256="0".repeat(64);
 expect((await validateRecommendationReportV2(raw,f.p,f.snapshot,f.decisions)).report.recommendations[0].visible).toBe(false);
});
it("zero recommendations is valid; structural derivation never changes the original prose or sources",async()=>{
 const {f,raw}=await rawFor("temp","temperature"),before=await hybridHash(raw);raw.report.recommendations=[];
 expect((await validateRecommendationReportV2(raw,f.p,f.snapshot,f.decisions)).report.recommendations).toEqual([]);
 expect(await hybridHash(raw)).not.toBe(before);const original=structuredClone(f.raw),sourceHash=await hybridHash(original);
 const d=structuralRecommendationRevision(original,f.p.statistics_sha256);expect(await hybridHash(original)).toBe(sourceHash);
 expect(d.raw.report.recommendations[0].proposed_action.text).toBe(original.report.recommendations[0].proposed_action.text);
});

