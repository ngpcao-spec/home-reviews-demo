import { prioritizedFixture } from "../../tests/fixtures/jev-luna-sol-prioritized.ts";
import { validatePrioritizedReport } from "../functions/_shared/jev-luna-sol-prioritized-validation.ts";
import { verifyPrioritizedDraft } from "../functions/_shared/jev-luna-sol-prioritized.ts";
const assert = (x: unknown) => { if (!x) throw new Error("ASSERT_FAILED"); };
Deno.test("offline versioned recommendation, no network permission or spend authorization", async () => {
  const f = await prioritizedFixture();
  await verifyPrioritizedDraft(f.draft, f.p, f.decisions);
  const r = await validatePrioritizedReport(f.raw, f.p, f.snapshot, f.decisions);
  assert(r.report.recommendations.length === 1 && r.report.recommendations[0].visible);
  assert(f.draft.spending_authorization === null && !f.draft.paid_enabled);
  assert(r.report.recommendations[0].observations[0].context_quote.includes("discount"));
});
Deno.test("invalid source, recurrence and redundant proposals abstain", async () => {
  const f = await prioritizedFixture(), raw = structuredClone(f.raw), a = raw.report.recommendations[0];
  a.observations[0].quote = "Invented"; a.priority.reason = "Un problème récurrent.";
  const b = structuredClone(a); b.priority.rank = 2; raw.report.recommendations.push(b);
  const r = await validatePrioritizedReport(raw, f.p, f.snapshot, f.decisions);
  assert(r.report.recommendations.every(a => !a.visible));
});
