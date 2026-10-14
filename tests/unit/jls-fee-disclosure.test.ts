import { expect, it, vi } from "vitest";
import { explicitFeeDisclosureComplaint,legacyFeeDisclosure,JLS_LEGACY_VALIDATOR } from "../../supabase/functions/_shared/jls-fee-disclosure";
import { validatePrioritizedReport } from "../../supabase/functions/_shared/jev-luna-sol-prioritized-validation";
import { buildPrioritizedRevalidation,verifyPrioritizedRevalidation } from "../../supabase/functions/_shared/jls-prioritized-revalidation";
import { hybridHash } from "../../supabase/functions/_shared/jev-hybrid-evidence";
import { negativeHash } from "../../supabase/functions/_shared/negative-validation-core";
import { prioritizedFixture } from "../fixtures/jev-luna-sol-prioritized";
import type { PrioritizedExecutionResult } from "../../supabase/functions/_shared/jls-prioritized-worker";
const actual="They include 10% of the price to the bill (8 VAT and 2 service) and I haven’t seen a note about that anywhere.";
it.each([actual,actual.replace("haven’t","haven't"),"We have not seen any notice about the service fee.","I didn't see a notice about the tax.","The bill included a service fee. We hadn't seen a note about that.","The service fee was not disclosed.","There was no mention of VAT."])("explicit disclosure complaint: %s",s=>expect(explicitFeeDisclosureComplaint(s)).toBe(true));
it.each(["The tax and service fee were clearly announced.","The bill includes tax and a service fee.","If a service fee wasn't announced, I would complain.","Maybe I haven't seen a note about the fee.","I'm not sure whether the tax was announced.","Was the tax not announced?","I haven't seen a problem with the tax notice.","The bill includes tax. I haven't seen a note about opening hours.","The bill includes tax and I haven't seen a note about opening hours.","The fee was not unannounced.","I can't say the tax was not disclosed.","The service fee was explained before we ordered, although I hadn't seen a note."])("positive, bare, hypothetical or ambiguous remains cautious: %s",s=>expect(explicitFeeDisclosureComplaint(s)).toBe(false));
async function feeFixture() {
  const f=await prioritizedFixture("vi",actual),a=f.raw.report.recommendations[0],e=f.draft.packet.evidence.find(x=>x.theme_key==="billing")!;
  a.axis="price";a.topic="fee_disclosure";a.evidence_ids=[e.evidence_id];
  a.title="Kiểm tra thông báo phí";a.proposed_action={kind:"clarify",focus:"billing_disclosure",text:"Làm rõ thông báo phí trước khi gọi món."};
  a.observations=[{text:"Khách không thấy thông báo phí.",evidence_id:e.evidence_id,theme_key:"billing",polarity:"negative",quote:e.quote,quote_sha256:e.quote_sha256,context_quote:e.context,context_sha256:e.context_sha256,context_summary:"Khách phản ánh khoản cộng thêm trên hóa đơn."}];
  return f;
}
it("reproduces old block, fixes both apostrophes without modifying source or invoking fetch",async()=>{
  expect(legacyFeeDisclosure(actual)).toBe(false);
  const f=await feeFixture(),before=await hybridHash(f),net=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("NETWORK_FORBIDDEN"));
  try {
    const old=await validatePrioritizedReport(f.raw,f.p,f.snapshot,f.decisions,"vi",JLS_LEGACY_VALIDATOR);
    expect(old.report.recommendations[0].reasons).toContain("PRECISE_DISCLOSURE_SUPPORT_REQUIRED");
    const next=await validatePrioritizedReport(f.raw,f.p,f.snapshot,f.decisions);
    expect(next.report.recommendations[0]).toMatchObject({visible:true,reasons:[]});
    expect(next.statistics).toEqual(old.statistics);expect(await hybridHash(f)).toBe(before);expect(net).not.toHaveBeenCalled();
    f.raw.report.recommendations[0].proposed_action.focus="billing_accuracy";
    expect((await validatePrioritizedReport(f.raw,f.p,f.snapshot,f.decisions)).report.recommendations[0].reasons).toContain("BILLING_DISCLOSURE_IS_NOT_CALCULATION_ERROR");
  } finally {net.mockRestore();}
});
it("revalidation is reproducible, source-bound and rejects forged provenance or content",async()=>{
  const f=await feeFixture(),response={model:"gpt-6.1-sol",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(f.raw)}]}]},rawText=JSON.stringify(response);
  const body={version:"jls-prioritized-vi-execution-result-v1",controls:{json_valid:true,model_matches:true,usage_complete:true,report_validation_passed:false,error_code:null},response,raw_response_text:rawText,raw_response_sha256:await negativeHash(rawText),response_sha256:await hybridHash(response),served_model:"gpt-6.1-sol",decisions_sha256:f.draft.decisions_sha256,
    validated_report:await validatePrioritizedReport(f.raw,f.p,f.snapshot,f.decisions,"vi",JLS_LEGACY_VALIDATOR)} as PrioritizedExecutionResult;
  const original={body,sha256:await hybridHash(body)},before=await hybridHash(original),provenance={commit:"a".repeat(40),files:{validator:"b".repeat(64),disclosure:"c".repeat(64),revalidation:"d".repeat(64)}};
  const net=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("NETWORK_FORBIDDEN"));
  try{
    const r=await buildPrioritizedRevalidation("synthetic-run",original,f.p,f.snapshot,f.decisions,provenance);
    expect(r.body.controls).toMatchObject({report_validation_passed:true,remaining_reasons:[],source_content_unchanged:true});
    expect(r.body.new_paid_calls).toBe(0);expect(await verifyPrioritizedRevalidation(r,"synthetic-run",original,f.p,f.snapshot,f.decisions)).toEqual(r);
    expect((await buildPrioritizedRevalidation("synthetic-run",original,f.p,f.snapshot,f.decisions,provenance)).sha256).toBe(r.sha256);
    const changed=structuredClone(r);changed.body.validation.report.recommendations[0].title="invented";changed.sha256=await hybridHash(changed.body);
    await expect(verifyPrioritizedRevalidation(changed,"synthetic-run",original,f.p,f.snapshot,f.decisions)).rejects.toThrow("JLS_PRI_REVALIDATION_CHANGED");
    expect(await hybridHash(original)).toBe(before);expect(net).not.toHaveBeenCalled();
  }finally{net.mockRestore();}
});
