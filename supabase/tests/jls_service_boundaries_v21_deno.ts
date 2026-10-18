import {reservationConfirmationSignal,beverageDelaySpan,negativeDrinkQuality,SERVICE_CLASSIFICATION_INSTRUCTIONS} from "../functions/_shared/jls-service-boundaries-v21.ts";
const assert=(v:unknown)=>{if(!v)throw Error("ASSERTION");};
Deno.test("a customer question alone is not reservation contradiction",()=>{
 assert(!reservationConfirmationSignal("Was my table reserved?","Was my table reserved?").supported);
});
Deno.test("confirmation conflict remains reported ambiguity, including later resolution",()=>{
 const q="They confirmed our table, then said it was unavailable.";
 const signal=reservationConfirmationSignal(q,q+" They later resolved the misunderstanding.");
 assert(signal.supported&&signal.resolved&&!signal.established_fault);
});
Deno.test("clear and negated confirmations do not create a complaint",()=>{
 assert(!reservationConfirmationSignal("They confirmed our table.","They confirmed our table. Everything was ready.").supported);
 assert(!reservationConfirmationSignal("They did not confirm our table.","They did not confirm our table.").supported);
});
Deno.test("timing and beverage quality stay distinct",()=>{
 assert(beverageDelaySpan("The drinks took a long time.")&&!negativeDrinkQuality("The drinks took a long time."));
 assert(!beverageDelaySpan("We did not wait for our drinks."));assert(negativeDrinkQuality("The coffee tasted bad."));
 assert(SERVICE_CLASSIFICATION_INSTRUCTIONS.includes("wait_time")&&SERVICE_CLASSIFICATION_INSTRUCTIONS.includes("no historical Luna verdict"));
});
