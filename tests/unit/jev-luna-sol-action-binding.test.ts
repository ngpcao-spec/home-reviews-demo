import { describe, expect, it } from "vitest";
import { jlsActionEvidenceSupported } from "../../supabase/functions/_shared/jev-luna-sol-validation";
import { parseReviewV3, verifyGraphV3 } from "../../supabase/functions/_shared/pilot-evidence-v3";

type Evidence = Parameters<typeof jlsActionEvidenceSupported>[0];
function evidence(context: string, quote: string, theme_key: Evidence["theme_key"] = "wait_time", context_start = 0): Evidence {
  const quote_start = context_start + context.indexOf(quote);
  return { context, quote, theme_key, polarity: "negative", context_start,
    quote_start, quote_end: quote_start + quote.length };
}
const waitQuote = "We waited over an hour for an omelet with salted fish!";
const wait = evidence("I took off stars for the long wait. " + waitQuote, waitQuote);
const foodQuote = "The lasagna had practically no meat, the dough was overcooked and overly sweet, and the salad was simply bland.";
const food = evidence("The food was completely tasteless. We ordered lasagna and a chicken salad. " + foodQuote, foodQuote, "food_quality");

describe("JLS action binding within the selected citation", () => {
  it.each([["wait", wait, ["service_delays"]], ["food", food, undefined]] as const)(
    "accepts the cited %s statement even when V3 ranks a shorter statement elsewhere first", (_name, e, claims) => {
      const ranked = verifyGraphV3(parseReviewV3(e.context), e.theme_key, e.polarity);
      expect(ranked.status).toBe("supported_by_rule");
      expect(e.quote.includes(ranked.statement!.quote)).toBe(false);
      expect(jlsActionEvidenceSupported(e, claims)).toBe(true);
    });
  it("uses absolute source offsets correctly when the context starts mid-review", () => {
    expect(jlsActionEvidenceSupported(evidence(wait.context, wait.quote, "wait_time", 87), ["service_delays"])).toBe(true);
  });
  it("does not borrow a supporting statement from outside the selected citation", () => {
    const quote = "We ordered an omelet.";
    expect(jlsActionEvidenceSupported(evidence("Long wait. " + quote, quote), ["service_delays"])).toBe(false);
  });
  it("does not accept the wrong action claim", () => {
    expect(jlsActionEvidenceSupported(wait, ["order_error"])).toBe(false);
  });
  it("does not accept opposite polarity", () => {
    expect(jlsActionEvidenceSupported({ ...wait, polarity: "positive" }, ["service_delays"])).toBe(false);
  });
  it("keeps a negated event unsupported", () => {
    const quote = "There was no long wait.";
    expect(jlsActionEvidenceSupported(evidence(quote, quote), ["service_delays"])).toBe(false);
  });
  it("keeps historical evidence non-actionable", () => {
    const quote = "Last time we waited over an hour for food.";
    expect(jlsActionEvidenceSupported(evidence(quote, quote), ["service_delays"])).toBe(false);
  });
  it("preserves a reversal elsewhere in the context", () => {
    const quote = "Last time we waited over an hour for food.";
    expect(jlsActionEvidenceSupported(evidence(quote + " Now the service is quick.", quote), ["service_delays"])).toBe(false);
  });
  it("preserves unresolved contradictions from the full context", () => {
    const quote = "The food was tasteless.";
    const e = evidence("The food was delicious. " + quote, quote, "food_quality");
    expect(verifyGraphV3(parseReviewV3(e.context), e.theme_key, e.polarity).reason).toBe("UNRESOLVED_CONTRADICTION");
    expect(jlsActionEvidenceSupported(e)).toBe(false);
  });
  it("rejects mismatched citation offsets", () => {
    expect(jlsActionEvidenceSupported({ ...wait, quote_start: wait.quote_start + 1 }, ["service_delays"])).toBe(false);
  });
  it("does not reparse an isolated citation and lose full-context meaning", () => {
    const quote = "The food was tasteless.";
    expect(jlsActionEvidenceSupported(evidence("If we returned, " + quote, quote, "food_quality"))).toBe(false);
  });
});
