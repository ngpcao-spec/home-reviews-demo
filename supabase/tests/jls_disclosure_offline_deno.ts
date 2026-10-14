import { explicitFeeDisclosureComplaint } from "../functions/_shared/jls-fee-disclosure.ts";
Deno.test("fee notice: original curly and straight apostrophes, no network",()=>{
 globalThis.fetch=()=>{throw Error("NETWORK_FORBIDDEN");};
 for(const apostrophe of ["'","’"]){if(!explicitFeeDisclosureComplaint(`The bill included tax and I haven${apostrophe}t seen a note about that anywhere.`))throw Error("NOTICE_MISSED");}
 for(const text of ["The tax was clearly announced.","The bill included tax.","If tax was not announced I would complain.","Perhaps I haven't seen a note about the fee."]){if(explicitFeeDisclosureComplaint(text))throw Error("UNJUSTIFIED_SUPPORT");}
});
