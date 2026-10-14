import {vietnameseDishReasons,editorialProseReasons} from "../functions/_shared/jls-editorial-validation.ts";
import {prioritizedFixture} from "../../tests/fixtures/jev-luna-sol-prioritized.ts";
import {buildEditorialDraft} from "../functions/_shared/jls-prioritized-editorial.ts";
Deno.test("synthetic relation and internal prose tripwires, no network",()=>{
 globalThis.fetch=()=>{throw Error("PROVIDER_NETWORK_BLOCKED");};
 if(!vietnameseDishReasons("an omelet with salted fish","món trứng cá mặn").length)throw Error("RELATION_MISSED");
 if(vietnameseDishReasons("an omelet with salted fish","trứng chiên với cá muối").length)throw Error("CORRECT_RELATION_BLOCKED");
 if(!editorialProseReasons("khóa tần suất").length)throw Error("JARGON_MISSED");
});
Deno.test("future preparation changes hashes, preserves quotes and prevents implicit spending",async()=>{
 const f=await prioritizedFixture("vi"),d=await buildEditorialDraft(f.p,f.decisions);
 if(d.request_sha256===f.draft.request_sha256||d.spending_authorization!==null||d.execution_protocol!==null||d.new_paid_calls!==0)throw Error("VERSION_OR_SPENDING_FAILED");
 if(d.schema_sha256!==f.draft.schema_sha256||d.coverage.length!==25||JSON.stringify(d.packet.evidence)!==JSON.stringify(f.draft.packet.evidence))throw Error("SOURCE_CHANGED");
});
