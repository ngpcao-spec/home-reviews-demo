import {it,expect,vi,beforeAll,afterAll} from "vitest";
import {prioritizedFixture} from "../fixtures/jev-luna-sol-prioritized";
import {structuralRecommendationRevision} from "../../supabase/functions/_shared/jls-recommendation-review-v2";
import {buildRecommendationDraftV2,validateRecommendationReportV2} from "../../supabase/functions/_shared/jls-recommendation-contract-v2";
import {buildRecommendationDraftV21,validateRecommendationReportV21,CONTRACT_V21} from "../../supabase/functions/_shared/jls-recommendation-contract-v21";
import {reservationConfirmationSignal,beverageDelaySpan,negativeDrinkQuality,refineServiceEvidence,futureServiceQuestions} from "../../supabase/functions/_shared/jls-service-boundaries-v21";
import {hybridHash} from "../../supabase/functions/_shared/jev-hybrid-evidence";
import {negativeHash} from "../../supabase/functions/_shared/negative-validation-core";
import {acceptedJlsEvidence} from "../../supabase/functions/_shared/jev-luna-sol";
let net:ReturnType<typeof vi.spyOn>;
beforeAll(()=>{net=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("PROVIDER_NETWORK_FORBIDDEN"));});
afterAll(()=>{expect(net).not.toHaveBeenCalled();net.mockRestore();});
export const bookingQuote="So, when the staff informed me that the room was reserved, did they make a note of it?";
const bookingContext='I contacted the staff via Messenger to book a room for my birthday party. They always replied, "I\'ve noted your request and reserved the room for you." When I suggested a buffet, they said it was already reserved by another customer. '+bookingQuote+' Luckily, no invitations were sent out yet.';
const drinkText="The food was delicious. The manager and staff were lovely, but we waited a long time for our drinks, even though we only ordered Coca-Cola and iced tea.";
it.each([
 [bookingQuote,bookingContext,true],
 ["Did they note my reservation?","Did they note my reservation?",false],
 ["They confirmed our table.","They confirmed our table. Our table was ready when we arrived.",false],
 ["They did not confirm our table.","They did not confirm our table. We only asked about availability.",false],
 ["They hadn't confirmed our booking.","They hadn't confirmed our booking. Another party had already booked it.",false],
 ["If they confirmed our table, it might be unavailable.","If they confirmed our table, it might be unavailable.",false],
 ["They sent conflicting reservation confirmations.","They sent conflicting reservation confirmations.",true],
 ["They sent no conflicting reservation confirmations.","They sent no conflicting reservation confirmations.",false],
 ["They confirmed our table, then said it was unavailable.","They confirmed our table, then said it was unavailable. They later resolved the misunderstanding.",true],
 ["The booking was fine.","The booking was fine. We misunderstood the date.",false],
 ["The staff were friendly.",bookingContext+" The staff were friendly.",false],
 ["I confirmed our table, then a friend said it was unavailable.","I confirmed our table, then a friend said it was unavailable.",false],
 ["They never said the room was reserved.","They never said the room was reserved. Another customer had booked it.",false],
])("narrow reservation signal: %s",(q,c,supported)=>expect(reservationConfirmationSignal(q,c).supported).toBe(supported));
it("a resolved complaint remains historical, with an explicit resolution qualifier",()=>{
 const q="They confirmed our table, then said it was unavailable.";
 expect(reservationConfirmationSignal(q,q+" They later resolved the misunderstanding.")).toMatchObject({supported:true,resolved:true,established_fault:false});
});
it.each([
 [drinkText,true],['The drinks were delicious.',false],['The drinks did not take long to arrive.',false],
 ['We did not wait for our drinks.',false],['If the drinks took a long time, we would complain.',false],
 ['The tea tasted bad.',false],['We waited a long time for our coffee.',true],
 ['We waited briefly for our drinks.',false],['We thought the drinks were delayed, but actually they were not delayed.',false],
])("beverage timing versus quality: %s",(q,yes)=>expect(!!beverageDelaySpan(q)).toBe(yes));
it("quality and timing can coexist without merging their themes",()=>{
 expect(negativeDrinkQuality('The coffee tasted bad.')).toBe(true);
 expect(negativeDrinkQuality('The coffee was not bad.')).toBe(false);
 expect(negativeDrinkQuality(drinkText)).toBe(false);
});
let fixturePromise:ReturnType<typeof prioritizedFixture>;
const fixture=()=>fixturePromise??=prioritizedFixture("fr",undefined,{0:{text:drinkText,themes:["wait_time:negative"]},5:{text:bookingContext,themes:["communication:negative"]},4:{text:"The drinks took too long to arrive. We were disappointed.",themes:["drinks:negative"]}});
async function recommendation(theme:"communication"|"drinks"|"wait_time",f=undefined as Awaited<ReturnType<typeof prioritizedFixture>>|undefined){
 f??=await fixture();const raw=structuralRecommendationRevision(f.raw,f.p.statistics_sha256).raw;
 const e=f.p.selected.find(e=>e.theme_key===theme&&e.polarity==="negative"&&(theme!=="wait_time"||e.context.includes("Coca-Cola")))!;
 if(!e)throw Error("SYNTHETIC_THEME_MISSING");
 const a=raw.report.recommendations[0];Object.assign(a,{axis:e.axis,topic:theme==="communication"?"communication":theme==="drinks"?"drinks":"service_flow",evidence_ids:[e.evidence_id],
 observations:[{text:theme==="communication"?"Le client s’interroge sur la confirmation reçue.":"Le client décrit une attente de ses boissons.",evidence_id:e.evidence_id,theme_key:theme,polarity:"negative",quote:e.quote,quote_sha256:e.quote_sha256,
 context_quote:e.context,context_sha256:await negativeHash(e.context),context_summary:theme==="communication"?"Le client a reçu une confirmation, puis une indication différente pour le buffet ; aucune invitation n’avait été envoyée.":"Le client apprécie les plats et le personnel tout en critiquant le délai des boissons."}]});
 a.proposed_action={kind:theme==="communication"?"clarify":"review",focus:theme==="wait_time"?"service_delay":theme,
 text:theme==="communication"?"Clarifier le contenu des confirmations de réservation.":"Examiner le délai d’arrivée des boissons."};
 a.priority={rank:1,reason:"Ce signal précis mérite une vérification.",basis:"theme_frequency",frequency_keys:[theme+":negative"],comparison_context:[]};
 return {f,raw,e};
}
it("new contract admits a sourced clarification, while original V2 remains unchanged",async()=>{
 const {f,raw}=await recommendation("communication"),before=await hybridHash(raw);
 const old=await validateRecommendationReportV2(raw,f.p,f.snapshot,f.decisions);
 const next=await validateRecommendationReportV21(raw,f.p,f.snapshot,f.decisions);
 expect(old.report.recommendations[0].visible).toBe(false);expect(next.report.recommendations[0].visible).toBe(true);
 expect(await hybridHash(raw)).toBe(before);expect(next.raw_response_sha256).toBe(old.raw_response_sha256);
});
it("booking clarification cannot establish double booking or staff fault",async()=>{
 const {f,raw}=await recommendation("communication");raw.report.recommendations[0].observations[0].text="Le personnel a commis une double réservation.";
 const v=await validateRecommendationReportV21(raw,f.p,f.snapshot,f.decisions);
 expect(v.report.recommendations[0].reasons).toContain("RESERVATION_FAULT_NOT_ESTABLISHED");
});
it("a later resolution must remain in the localized account",async()=>{
 const f=await prioritizedFixture("fr",undefined,{5:{text:bookingContext+" They later resolved the misunderstanding.",themes:["communication:negative"]}});
 const {raw}=await recommendation("communication",f);
 expect((await validateRecommendationReportV21(raw,f.p,f.snapshot,f.decisions)).report.recommendations[0].reasons).toContain("RESERVATION_RESOLUTION_CONTEXT_OMITTED");
 raw.report.recommendations[0].observations[0].context_summary+=" Le problème a ensuite été résolu.";
 expect((await validateRecommendationReportV21(raw,f.p,f.snapshot,f.decisions)).report.recommendations[0].visible).toBe(true);
});
it("does not accept a drink-quality verdict as a delay action",async()=>{
 const {f,raw}=await recommendation("drinks"),v=await validateRecommendationReportV21(raw,f.p,f.snapshot,f.decisions);
 expect(v.report.recommendations[0].visible).toBe(false);expect(v.report.recommendations[0].reasons).toContain("BEVERAGE_DELAY_REQUIRES_WAIT_TIME_EVIDENCE");
});
it("a delay action needs wait_time evidence and its direct frequency",async()=>{
 const {f,raw}=await recommendation("wait_time");
 expect((await validateRecommendationReportV21(raw,f.p,f.snapshot,f.decisions)).report.recommendations[0].visible).toBe(true);
 raw.report.recommendations[0].priority.frequency_keys=["drinks:negative"];
 expect((await validateRecommendationReportV21(raw,f.p,f.snapshot,f.decisions)).report.recommendations[0].reasons).toContain("UNRELIABLE_OR_UNRELATED_FREQUENCY");
});
it.each(["quote","context","polarity","decision"])("the new booking rule preserves %s binding checks",async kind=>{
 const {f,raw}=await recommendation("communication"),ds=structuredClone(f.decisions);
 if(kind==="quote")raw.report.recommendations[0].observations[0].quote+=" altered";
 if(kind==="context")raw.report.recommendations[0].observations[0].context_quote+=" altered";
 if(kind==="polarity")raw.report.recommendations[0].observations[0].polarity="positive";
 if(kind==="decision"){const d=ds.find(d=>d.evidence_id===raw.report.recommendations[0].evidence_ids[0])!;d.status="UNCERTAIN";d.native_choice="uncertain";}
 try{expect((await validateRecommendationReportV21(raw,f.p,f.snapshot,ds)).report.recommendations[0].visible).toBe(false);}catch(e){expect(kind).toBe("decision");expect(String(e)).toMatch(/LUNA/);}
});
it("future prompts change configuration/request hashes without altering old payloads",async()=>{
 const f=await fixture(),before=await hybridHash(f.p),old=await buildRecommendationDraftV2(f.p,f.decisions),next=await buildRecommendationDraftV21(f.p,f.decisions);
 expect(next.version).toBe(CONTRACT_V21);expect(next.prompt_sha256).not.toBe(old.prompt_sha256);expect(next.config_sha256).not.toBe(old.config_sha256);
 expect(next.schema_sha256).toBe(old.schema_sha256);expect(next.spending_authorization).toBeNull();expect(await hybridHash(f.p)).toBe(before);
 const groups=await futureServiceQuestions(f.p);expect(groups.groups.length).toBe(f.p.luna_groups.length);
 expect(groups.groups[0].request_sha256).not.toBe(f.p.luna_groups[0].request_sha256);
 expect(()=>acceptedJlsEvidence({...f.p,luna_groups:groups.groups},f.decisions)).toThrow();
});
it("new wait quotation has no inherited verdict and never changes a drinks evidence theme",async()=>{
 const {e}=await recommendation("wait_time"),before=await hybridHash(e),next=await refineServiceEvidence(e,drinkText);
 expect(next.theme_key).toBe("wait_time");expect(next.evidence_id).not.toBe(e.evidence_id);
 expect("luna_verdict" in next&&next.luna_verdict).toBeNull();expect(await hybridHash(e)).toBe(before);
 const drinks=(await recommendation("drinks")).e,excluded=await refineServiceEvidence(drinks,drinks.context);
 expect(excluded.theme_key).toBe("drinks");expect("quality" in excluded&&excluded.quality.eligible).toBe(false);
});
