import {expect,it,vi,afterEach} from "vitest";
import {render,screen,cleanup} from "@testing-library/react";
import {I18nProvider} from "../../src/i18n";
import {JlsEditorialPreparation} from "../../src/components/analysis/JlsEditorialPreparation";
import {PrioritizedJlsReport} from "../../src/components/analysis/PrioritizedJlsReport";
import {prioritizedFixture} from "../fixtures/jev-luna-sol-prioritized";
import {buildEditorialDraft,editorialInstructions,JLS_EDITORIAL_CONFIG,verifyEditorialDraft} from "../../supabase/functions/_shared/jls-prioritized-editorial";
import {validateEditorialReport,vietnameseDishReasons,editorialProseReasons} from "../../supabase/functions/_shared/jls-editorial-validation";
import {validatePrioritizedReport} from "../../supabase/functions/_shared/jev-luna-sol-prioritized-validation";
import {hybridHash} from "../../supabase/functions/_shared/jev-hybrid-evidence";
import {readFileSync} from "node:fs";
afterEach(cleanup);
it.each(["trứng chiên với cá muối","trứng rán cùng cá muối","món omelet with salted fish, theo cách gọi của khách"])("synthetic dish relation preserved: %s",s=>expect(vietnameseDishReasons("an omelet with salted fish",s)).toEqual([]));
it("synthetic fish eggs substitution flagged without restaurant identity",()=>{
 expect(vietnameseDishReasons("an omelette filled with smoked fish","món trứng cá")).toContain("DISH_INGREDIENT_RELATION_NEEDS_REVIEW");
 expect(vietnameseDishReasons("an omelet with salted fish","món trứng cá mặn")).toContain("DISH_INGREDIENT_RELATION_NEEDS_REVIEW");
 expect(vietnameseDishReasons("salted fish eggs","trứng cá muối")).toEqual([]);
 expect(vietnameseDishReasons("an unspecified dish","một món chưa rõ")).toEqual([]);
});
it.each(["khóa tần suất hỗ trợ ưu tiên","frequency_keys", "wait_time", "priority.reason", "evidence_id", "ACCEPTED", "a".repeat(64)])("technical manager prose rejected: %s",s=>expect(editorialProseReasons(s)).toContain("INTERNAL_VOCABULARY_IN_MANAGER_PROSE"));
it("plain manager explanation does not invent VIP recurrence",()=>expect(editorialProseReasons("Phản ánh về thời gian chờ cần xem xét; chưa biết trường hợp tại khu vực riêng có lặp lại hay không.")).toEqual([]));
it("new version leaves historical draft, report, consent scopes untouched and needs no provider",async()=>{
 const f=await prioritizedFixture("vi"),before=await hybridHash([f.p,f.raw,f.decisions,f.draft]),net=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("NETWORK_BLOCKED"));
 try{
  const d=await buildEditorialDraft(f.p,f.decisions);await verifyEditorialDraft(d,f.p,f.decisions);
  expect(d.schema_sha256).toBe(f.draft.schema_sha256);expect(d.request_sha256).not.toBe(f.draft.request_sha256);expect(d.prompt_sha256).not.toBe(f.draft.prompt_sha256);
  expect(d).toMatchObject({spending_authorization:null,execution_protocol:null,new_paid_calls:0,result:null});
  expect(d.config).toMatchObject({max_sol_calls:1,automatic_retry:false,minimum_recommendations:0,maximum_recommendations:5,paid_enabled:false});
  expect(d.coverage).toHaveLength(25);expect(d.packet.statistics.themes).toEqual(f.p.statistics.themes);
  expect(d.packet.evidence).toEqual(f.draft.packet.evidence);expect(await hybridHash([f.p,f.raw,f.decisions,f.draft])).toBe(before);
  expect(net).not.toHaveBeenCalled();
 }finally{net.mockRestore();}
});
it("frequent theme without ACCEPTED evidence is a coverage gap, not forced recommendation",async()=>{
 const f=await prioritizedFixture(),p=structuredClone(f.p),t=p.statistics.themes.find(t=>t.theme_key==="price_level")!;
 t.negative_reviews=5;t.negative_mentions=5;p.statistics_sha256=await hybridHash(p.statistics);
 const d=await buildEditorialDraft(p,f.decisions);expect(d.coverage.find(x=>x.theme_key==="price_level")).toMatchObject({negative_reviews:5,accepted_negative_reviews:0,coverage_status:"missing_accepted_evidence"});
 const raw=structuredClone(f.raw);raw.statistics_sha256=p.statistics_sha256;raw.report.recommendations=[];
 expect((await validateEditorialReport(raw,p,f.snapshot,f.decisions)).report.recommendations).toEqual([]);
});
it("theme count does not become incident count; isolated serious signal stays conditional",async()=>{
 const f=await prioritizedFixture(),r=await validateEditorialReport(f.raw,f.p,f.snapshot,f.decisions);
 expect(r.report.recommendations[0].priority.basis).toBe("isolated_signal_to_verify");
 expect(r.report.recommendations[0].observations[0].customer_report_not_established_fact).toBe(true);
 const raw=structuredClone(f.raw);raw.report.recommendations[0].priority.reason="Le problème dans cette zone est récurrent.";
 expect((await validateEditorialReport(raw,f.p,f.snapshot,f.decisions)).report.recommendations[0].visible).toBe(false);
 raw.report.recommendations=[];expect((await validateEditorialReport(raw,f.p,f.snapshot,f.decisions)).report.recommendations).toEqual([]);
});
it("new validator masks jargon without changing historical validation or exact English quotes",async()=>{
 const f=await prioritizedFixture("vi"),old=await validatePrioritizedReport(f.raw,f.p,f.snapshot,f.decisions),raw=structuredClone(f.raw);
 raw.report.recommendations[0].priority.reason="Khóa tần suất hỗ trợ ưu tiên.";
 const next=await validateEditorialReport(raw,f.p,f.snapshot,f.decisions);
 expect(next.report.recommendations[0]).toMatchObject({visible:false,reasons:expect.arrayContaining(["INTERNAL_VOCABULARY_IN_MANAGER_PROSE"])});
 expect(next.report.recommendations[0].observations[0].quote).toBe(old.report.recommendations[0].observations[0].quote);
 expect(await validatePrioritizedReport(f.raw,f.p,f.snapshot,f.decisions)).toEqual(old);
 expect(next.translation_fidelity_guaranteed).toBe(false);
});
it.each(["fr","vi"] as const)("future-only FR/VI display and disabled spending: %s",async language=>{
 const f=await prioritizedFixture(language),draft=await buildEditorialDraft(f.p,f.decisions,language);
 render(<I18nProvider language={language}><JlsEditorialPreparation draft={draft}/></I18nProvider>);
 expect(screen.getByText(language==="fr"?"Nouvelles consignes — générations futures uniquement":"Hướng dẫn mới — chỉ cho báo cáo tương lai")).toBeVisible();
 expect(screen.getByRole("button")).toBeDisabled();
 expect(screen.getByText(language==="fr"?"Exemple synthétique — aucun rapport généré":"Ví dụ giả lập — chưa tạo báo cáo")).toBeVisible();
});
it("prompt explains multi-factor priorities and preserves dish ambiguity, no automatic discount",()=>{
 const prompt=editorialInstructions("vi");expect(prompt).toContain("Preserve the dish, ingredients, preparation and their relationships");
 expect(prompt.toLowerCase()).toContain("frequency alone");expect(prompt).toContain("specificity");expect(prompt).toContain("price reduction");
 expect(JLS_EDITORIAL_CONFIG.new_execution_consent_required).toBe(true);
 expect(readFileSync("supabase/functions/_shared/jls-prioritized-execution.ts","utf8")).not.toContain("jls-prioritized-editorial");
});
it("future renderer localizes theme counts and keeps internal keys in audit details",async()=>{
 const f=await prioritizedFixture("vi");f.raw.report.recommendations[0].priority.basis="theme_frequency";f.raw.report.recommendations[0].priority.frequency_keys=["wait_time:negative"];
 const r=await validateEditorialReport(f.raw,f.p,f.snapshot,f.decisions);
 render(<I18nProvider language="vi"><PrioritizedJlsReport result={r}/></I18nProvider>);
 expect(screen.getByText(/Đánh giá đã phân tích/)).toBeVisible();
 expect(screen.getByText("Chi tiết kỹ thuật về ưu tiên")).toBeVisible();
 expect(screen.queryByText(/^wait_time:negative —/)).toBeNull();
 expect(screen.getByText(/"key": "wait_time:negative"/)).not.toBeVisible();
});
