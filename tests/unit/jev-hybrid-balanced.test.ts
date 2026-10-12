import { expect, it, vi } from "vitest";
import { balancedExcerpt, balancedSummary, buildBalancedPlan, selectBalancedEvidence, verifyBalancedPlan, type BalancedEvidence } from "../../supabase/functions/_shared/jev-hybrid-balanced";
import { hybridFixture } from "../fixtures/jev-hybrid";
import { hybridHash, type HybridEvidence } from "../../supabase/functions/_shared/jev-hybrid-evidence";
import { negativeHash } from "../../supabase/functions/_shared/negative-validation-core";
import type { ThemeKey } from "../../supabase/functions/_shared/jev-themes";
import frozen from "../fixtures/hybrid-balanced-artisan.json";

const evidence = (theme_key: ThemeKey, polarity: "positive" | "negative") => ({ theme_key, polarity } as HybridEvidence);
const c = (id: number, rating: number, axis = "quality", polarity: "positive" | "negative" = "negative") => ({
  evidence_id: String(id), review_id: String(id), rating, axis, polarity, theme_key: "food_quality", quote: ["unique","isolated","specific"].map(w=>w+String.fromCharCode(97+Math.floor(id/26),97+id%26)).join(" "),
  status: "sol_candidate", quality: { eligible: true, specificity: 40, flags: [], reason: "explicit_test_fixture", human_validated: false },
  mixed_review: false, selection_stage: "diversification", selection_reason: "explicit_test_fixture",
} as BalancedEvidence);

it.each([
  ["Excellent service.", "professionalism", "positive", false],
  ["The waiter was knowledgeable and professional.", "professionalism", "positive", true],
  ["Beautiful atmosphere.", "food_quality", "positive", false],
  ["The coffee was delicious.", "food_quality", "positive", false],
  ["The coffee was delicious.", "drinks", "positive", true],
  ["Only the beef steak was too tough.", "food_quality", "negative", true],
  ["Restaurant far from the center.", "location", "negative", true],
  ["Maybe I chose the wrong menu item, but expected more from the fried eggs.", "order_accuracy", "negative", false],
  ["They brought the wrong order.", "order_accuracy", "negative", true],
  ["We waited 45 minutes for a burger.", "wait_time", "negative", true],
  ["We waited 45 minutes for a burger.", "attentiveness", "negative", false],
  ["The staff didn't speak English and it was difficult to understand.", "communication", "negative", true],
  ["Friendly staff.", "attentiveness", "positive", false],
] as const)("theme boundaries: %s / %s", (text, theme, polarity, exists) => {
  expect(!!balancedExcerpt(text, evidence(theme, polarity))).toBe(exists);
});
it("Bot expensive is flagged, never silently corrected to Not/But", () => {
  const s = balancedExcerpt("Bot expensive, but really nice food.", evidence("price_level", "negative"))!;
  expect(s.quote).toBe("Bot expensive, but really nice food.");
  expect(s.flags).toContain("AMBIGUOUS_TYPO_PRICE");
});
it("not cheap but worth it retains comparison/context and separate price/value", () => {
  const text = "Not cheap, but worth it. The meal was delicious.";
  for (const [theme, polarity] of [["price_level","negative"],["value","positive"]] as const) {
    const s = balancedExcerpt(text,evidence(theme,polarity))!;
    expect(s.context).toBe(text); expect(s.flags).toContain("SCOPED_CONTRAST_OR_LIMITED_CLAIM");
  }
});
it("corrections over time and scoped negation remain in the context", () => {
  const text = "The food used to be cold. Now it is hot and the problem has been corrected.";
  const s = balancedExcerpt(text,evidence("temperature","negative"))!;
  expect(s.context).toBe(text); expect(s.flags).toContain("TEMPORAL_OR_RESOLUTION_CONTEXT");
});
it("real frozen Artisan regression texts retain their SHA256",async()=>{
  for(const r of frozen.cases)expect(await negativeHash(r.text)).toBe(r.sha);
});
it("real one-star passages concern tasteless food, communication and explicitly overcooked meat",()=>{
  const a=frozen.cases.find(r=>r.id.startsWith("9f65"))!,b=frozen.cases.find(r=>r.id.startsWith("17bbc"))!,d=frozen.cases.find(r=>r.id.startsWith("dd36"))!;
  expect(balancedExcerpt(a.text,evidence("food_quality","negative"))!.quote).toContain("food is completely tasteless");
  expect(balancedExcerpt(b.text,evidence("communication","negative"))!.quote).toContain("difficult to understand");
  expect(balancedExcerpt(d.text,evidence("cooking","negative"))!.quote).toContain("overcooked");
});
it("real order error selects missing drink, not merely poor taste or a customer's choice",()=>{
  const r=frozen.cases.find(r=>r.id.startsWith("4c950"))!;
  expect(balancedExcerpt(r.text,evidence("order_accuracy","negative"))!.quote).toContain("missing one");
  const choice=frozen.cases.find(r=>r.id.startsWith("ca5e8"))!;
  expect(balancedExcerpt(choice.text,evidence("order_accuracy","negative"))!.quote).toContain("instead of the promised cucumbers");
  expect(balancedExcerpt(choice.text,evidence("order_accuracy","negative"))!.quote).not.toContain("I chose the wrong menu item");
});
it("real Bot expensive stays ambiguous; never turns into a confirmed fact",()=>{
  const r=frozen.cases.find(r=>r.id.startsWith("1ea0"))!;
  expect(balancedExcerpt(r.text,evidence("price_level","negative"))!.flags).toContain("AMBIGUOUS_TYPO_PRICE");
});
it("conditional stratification retains three one-star criticisms, 35–45% low stars, four/five stars", () => {
  const pool = Array.from({length:100},(_,i)=>c(i,i<20?1:i<30?2:i<40?3:i<55?4:5));
  const selected = selectBalancedEvidence(pool,32), s = balancedSummary(selected);
  expect(s.total).toBe(32); expect(s.star_distribution["1"]).toBeGreaterThanOrEqual(3);
  expect(s.low_star_citations / s.total).toBeGreaterThanOrEqual(.35);
  expect(s.low_star_citations / s.total).toBeLessThanOrEqual(.45);
  expect(s.star_distribution["4"]).toBeGreaterThan(0); expect(s.star_distribution["5"]).toBeGreaterThan(0);
  expect(selectBalancedEvidence([...pool].reverse(),32)).toEqual(selected);
});
it("quotas never promote absent/bad/contested/ambiguous passages", () => {
  const bad=c(1,1);bad.quality.eligible=false;
  const contested=c(2,1);contested.status="explicitly_contested";
  const ambiguous=c(3,1);ambiguous.quality.specificity=0;ambiguous.quality.flags=["AMBIGUOUS_TYPO_PRICE"];
  const selected=selectBalancedEvidence([bad,contested,ambiguous,c(4,5)],2);
  expect(selected.some(e=>e.review_id==="1"||e.review_id==="2")).toBe(false);
  expect(selected.filter(e=>e.selection_reason==="one_star_concrete_criticism")).toHaveLength(0);
});
it("no low-star evidence available leaves a shortage, no synthetic citation", () => {
  const selected=selectBalancedEvidence([c(1,5),c(2,5)],32);
  expect(selected).toHaveLength(2); expect(selected.every(e=>e.rating===5)).toBe(true);
});
it("duplicates and normal per-review maximum two", () => {
  const pool=[c(1,1),c(2,1),c(3,1),c(4,4),c(5,5)];pool.slice(0,3).forEach(e=>e.review_id="same");pool[4].quote=pool[3].quote;
  const selected=selectBalancedEvidence(pool,32);
  expect(selected.filter(e=>e.review_id==="same").length).toBeLessThanOrEqual(2);
  expect(new Set(selected.map(e=>e.quote)).size).toBe(selected.length);
});
it("independent balanced plan, unchanged V1/statistics, local cost, no provider traffic", async () => {
  const f=await hybridFixture(), before=await hybridHash(f.plan), sourceBefore=await hybridHash(f.snapshot);
  const fetch=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("PROVIDER_FORBIDDEN"));
  try {
    const p=await buildBalancedPlan(f.snapshot,f.cache,[],"fr",f.plan);
    expect(p.version).toBe("jev-hybrid-evidence-report-v1.1-balanced");
    expect(await hybridHash(f.plan)).toBe(before); expect(await hybridHash(f.snapshot)).toBe(sourceBefore);
    expect(p.analytics).toEqual(f.plan.analytics); expect(p.statistics_sha256).toBe(f.plan.statistics_sha256);
    expect(p.estimates.estimated_input_tokens).toBeLessThanOrEqual(20000);
    expect(p.estimates.jev_new_requests).toBe(0); expect(p.paid_enabled).toBe(false); expect(p.sol_response).toBeNull();
    expect(p.estimates.estimated_sol_cost_usd).toBeCloseTo((p.estimates.estimated_input_tokens*f.snapshot.rates.sol_input!+p.estimates.estimated_output_tokens*f.snapshot.rates.sol_output!)/1e6,9);
    expect(fetch).not.toHaveBeenCalled();
    for(const e of p.selected){ const r=f.snapshot.source.reviews.find(r=>r.id===e.review_id)!;expect(r.analysis_text!.slice(e.quote_start,e.quote_end)).toBe(e.quote);expect(await negativeHash(e.quote)).toBe(e.quote_sha256); }
    await verifyBalancedPlan(p,f.snapshot);
    p.selected[0].quote="fabricated";await expect(verifyBalancedPlan(p,f.snapshot)).rejects.toThrow("BALANCED_");
  } finally { fetch.mockRestore(); }
});
