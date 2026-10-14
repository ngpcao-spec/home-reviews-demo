import { beforeAll, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n";
import { PrioritizedJlsReport } from "../../src/components/analysis/PrioritizedJlsReport";
import { prioritizedFixture } from "../fixtures/jev-luna-sol-prioritized";
import { buildPrioritizedDraft, verifyPrioritizedDraft, prioritizedSchema, prioritizedInstructions, JLS_PRIORITIZED_CONFIG } from "../../supabase/functions/_shared/jev-luna-sol-prioritized";
import { validatePrioritizedReport } from "../../supabase/functions/_shared/jev-luna-sol-prioritized-validation";
import { hybridHash } from "../../supabase/functions/_shared/jev-hybrid-evidence";
import { readFileSync } from "node:fs";
let f: Awaited<ReturnType<typeof prioritizedFixture>>;
beforeAll(async () => { f = await prioritizedFixture(); });
const validate = (raw = f.raw) => validatePrioritizedReport(raw, f.p, f.snapshot, f.decisions);
it("free independent version preserves historical plan/decisions/statistics and provider caps", async () => {
  const before = await hybridHash([f.p, f.decisions]), net = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("FORBIDDEN_PROVIDER"));
  try {
    await verifyPrioritizedDraft(f.draft, f.p, f.decisions); await validate();
    expect(await hybridHash([f.p, f.decisions])).toBe(before); expect(net).not.toHaveBeenCalled();
    expect(f.draft.packet.statistics.themes).toHaveLength(25); expect(f.draft.packet.statistics).toEqual(f.p.statistics);
    expect(f.draft.packet).not.toHaveProperty("action_catalog"); expect(f.draft.spending_authorization).toBeNull(); expect(f.draft.result).toBeNull();
    expect(JLS_PRIORITIZED_CONFIG).toMatchObject({ max_sol_calls: 1, max_luna_calls: 24, automatic_retry: false, paid_enabled: false });
  } finally { net.mockRestore(); }
});
it("one recommendation is valid without padding, quoted reaction/compensation survives", async () => {
  const r = await validate(); expect(r.report.recommendations).toHaveLength(1);
  expect(r.report.recommendations[0]).toMatchObject({ status: "technically_bound_proposal", visible: true, semantic_truth_guaranteed: false });
  expect(r.report.recommendations[0].observations[0].context_quote).toContain("discount");
});
it("zero recommendations valid if evidence insufficient", async () => {
  const raw = structuredClone(f.raw); raw.report.recommendations = []; expect((await validate(raw)).report.recommendations).toEqual([]);
});
it("omitted compensation or staff response must remain review_needed",async()=>{
  const raw=structuredClone(f.raw);raw.report.recommendations[0].observations[0].context_summary="Le contexte est disponible.";
  expect((await validate(raw)).report.recommendations[0].reasons).toContain("COMPENSATION_CONTEXT_OMITTED");
  expect((await validate(raw)).report.recommendations[0].reasons).toContain("STAFF_RESPONSE_CONTEXT_OMITTED");
});
it("redundant recommendation remains hidden, never padded", async () => {
  const raw = structuredClone(f.raw), duplicate = structuredClone(raw.report.recommendations[0]); duplicate.priority.rank = 2; raw.report.recommendations.push(duplicate);
  expect((await validate(raw)).report.recommendations[1]).toMatchObject({ visible: false, reasons: expect.arrayContaining(["REDUNDANT_RECOMMENDATION_TOPIC"]) });
});
it.each(["quote", "quote_sha256", "context_quote", "context_sha256", "theme_key", "polarity"])("changed observation %s is never accepted", async key => {
  const raw = structuredClone(f.raw), o = raw.report.recommendations[0].observations[0];
  (o as unknown as Record<string, unknown>)[key] = key === "theme_key" ? "communication" : key === "polarity" ? "positive" : "fabricated";
  expect((await validate(raw)).report.recommendations[0].visible).toBe(false);
});
it("Luna rejected evidence cannot ground a new observation", async () => {
  const d = structuredClone(f.decisions), x = d.find(x => x.evidence_id === f.raw.report.recommendations[0].evidence_ids[0])!;
  x.native_choice = "unsupported"; x.status = "REJECTED"; x.probabilities = { supported: .02, unsupported: .96, uncertain: .02 };
  const r = await validatePrioritizedReport(f.raw, f.p, f.snapshot, d); expect(r.report.recommendations[0].visible).toBe(false);
});
it("actual theme frequency remains distinct from selected quotation counts", async () => {
  const raw = structuredClone(f.raw), a = raw.report.recommendations[0]; a.priority.basis = "theme_frequency"; a.priority.frequency_keys = ["wait_time:negative"];
  const r = await validate(raw); expect(r.report.recommendations[0].frequency[0]).toMatchObject({ distinct_reviews: 1, mentions: 1, denominator: 6 });
});
it("missing reliable frequency causes abstention, never manufactured recurrence", async () => {
  const p = structuredClone(f.p); p.statistics.theme_frequency_denominator = 0; p.statistics_sha256 = await hybridHash(p.statistics);
  const raw = structuredClone(f.raw); raw.statistics_sha256 = p.statistics_sha256; raw.report.recommendations[0].priority.basis = "theme_frequency"; raw.report.recommendations[0].priority.frequency_keys = ["wait_time:negative"];
  expect((await validatePrioritizedReport(raw, p, f.snapshot, f.decisions)).report.recommendations[0].reasons).toContain("UNRELIABLE_OR_UNRELATED_FREQUENCY");
});
it.each(["Le problème est récurrent.", "L'attente est due à un manque de formation.", "Atteindre un délai de 5 minutes.", "Garantira une meilleure satisfaction.", "Ces frais sont illégaux."])("unsupported claim hidden: %s", async prose => {
  const raw = structuredClone(f.raw); raw.report.recommendations[0].proposed_action.text = prose;
  expect((await validate(raw)).report.recommendations[0].visible).toBe(false);
});
it("delay never proves training; distance never proves wayfinding", async () => {
  const raw = structuredClone(f.raw); raw.report.recommendations[0].proposed_action.text = "Revoir la formation du personnel.";
  expect((await validate(raw)).report.recommendations[0].reasons).toContain("DELAY_DOES_NOT_ESTABLISH_TRAINING_NEED");
  raw.report.recommendations[0].proposed_action.text = "Revoir les indications d’accès.";
  expect((await validate(raw)).report.recommendations[0].reasons).toContain("DISTANCE_IS_NOT_WAYFINDING");
});
it("unannounced fees never become a calculation error", async () => {
  const raw = structuredClone(f.raw), a = raw.report.recommendations[0], e = f.draft.packet.evidence.find(x => x.theme_key === "billing")!;
  a.axis = "price"; a.topic = "fee_disclosure"; a.evidence_ids = [e.evidence_id]; a.proposed_action.focus = "billing_accuracy";
  a.observations = [{ text: "Un client signale des frais non annoncés.", evidence_id: e.evidence_id, theme_key: "billing", polarity: "negative", quote: e.quote, quote_sha256: e.quote_sha256, context_quote: e.context, context_sha256: e.context_sha256, context_summary: "Le personnel a donné une explication ensuite." }];
  expect((await validate(raw)).report.recommendations[0].reasons).toContain("BILLING_DISCLOSURE_IS_NOT_CALCULATION_ERROR");
  a.proposed_action.focus = "billing_disclosure"; a.proposed_action.text = "Clarifier les frais avant la commande.";
  expect((await validate(raw)).report.recommendations[0].reasons).toEqual([]);
});
it("mixed evidence retains portion/taste, travel/ambiance, food/drink distinctions", () => {
  expect(f.draft.packet.evidence.find(e => e.theme_key === "portions")!.context).toContain("soup was delicious");
  expect(f.draft.packet.evidence.find(e => e.theme_key === "location")!.context).toContain("atmosphere was lovely");
  expect(f.draft.packet.evidence.find(e => e.theme_key === "cooking")!.context).toContain("coffee was delicious");
});
it("input budget and costs use recorded tariffs; unknown rates remain unknown", async () => {
  expect(f.draft.estimates.estimated_input_tokens).toBeLessThanOrEqual(20000);
  expect(f.draft.estimates.estimated_cost_usd).toBe((f.draft.estimates.estimated_input_tokens * 2 + f.draft.estimates.estimated_output_tokens * 10) / 1e6);
  const p = structuredClone(f.p); p.estimates.sol.rates.sol_output = null;
  expect((await buildPrioritizedDraft(p, f.decisions)).estimates.estimated_cost_usd).toBeNull();
});
it("strict schema has required fields and closed objects; no fixed phrase action catalogue", () => {
  const visit = (x: unknown) => { if (!x || typeof x !== "object") return; const v = x as Record<string, unknown>; if (v.type === "object") { expect(v.additionalProperties).toBe(false); expect(v.required).toEqual(Object.keys(v.properties as object)); } Object.values(v).forEach(visit); };
  visit(prioritizedSchema()); expect(prioritizedInstructions("vi")).toContain("Vietnamese");
});
it.each(["fr", "vi"] as const)("mobile report renderer %s separates observation/proposal and method note", async lang => {
  const g = await prioritizedFixture(lang), result = await validatePrioritizedReport(g.raw, g.p, g.snapshot, g.decisions);
  render(<I18nProvider language={lang}><PrioritizedJlsReport result={result} /></I18nProvider>);
  expect(screen.getByText(lang === "fr" ? "Ce que les clients rapportent" : "Nội dung khách hàng phản ánh")).toBeInTheDocument();
  expect(screen.getByText(lang === "fr" ? "Action proposée au restaurateur" : "Hành động đề xuất cho nhà hàng")).toBeInTheDocument();
  expect(screen.getByText(lang === "fr" ? "Note méthodologique" : "Ghi chú phương pháp")).toBeInTheDocument();
});
it("new preparation cannot create a paid job or authorization; existing worker remains pinned", () => {
  const sql = readFileSync("supabase/migrations/20261014090443_jls_prioritized_recommendations_preparation.sql", "utf8");
  expect(sql).not.toMatch(/insert into public.analysis_jev_luna_sol_(runs|tasks)|create.*authorize/i);
  expect(sql).toContain("security invoker"); expect(sql).toContain("from public,anon,authenticated");
});
