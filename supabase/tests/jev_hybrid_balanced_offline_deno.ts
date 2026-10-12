import {
  type BalancedEvidence,
  balancedExcerpt,
  selectBalancedEvidence,
} from "../functions/_shared/jev-hybrid-balanced.ts";
import type { HybridEvidence } from "../functions/_shared/jev-hybrid-evidence.ts";
Deno.test("balanced boundary checks require no provider or network", () => {
  const s = balancedExcerpt(
    "Bot expensive, but really nice food.",
    { theme_key: "price_level", polarity: "negative" } as HybridEvidence,
  );
  if (!s?.flags.includes("AMBIGUOUS_TYPO_PRICE")) throw new Error("TYPO_GUARD");
  if (
    balancedExcerpt(
      "Excellent service.",
      { theme_key: "professionalism", polarity: "positive" } as HybridEvidence,
    )
  ) throw new Error("GENERIC_SERVICE");
  if (
    balancedExcerpt(
      "I chose the wrong menu item.",
      { theme_key: "order_accuracy", polarity: "negative" } as HybridEvidence,
    )
  ) throw new Error("SELF_SELECTION");
});
Deno.test("balanced quotas do not invent empty-stratum evidence", () => {
  const e = {
    evidence_id: "test",
    review_id: "test",
    quote: "Distinct mock text",
    rating: 5,
    axis: "quality",
    theme_key: "food_quality",
    polarity: "positive",
    status: "sol_candidate",
    quality: {
      eligible: true,
      specificity: 30,
      flags: [],
      reason: "explicit_mock",
      human_validated: false,
    },
  } as unknown as BalancedEvidence;
  const selected = selectBalancedEvidence([e], 32);
  if (selected.length !== 1 || selected[0].rating !== 5) {
    throw new Error("QUOTA_SYNTHETIC");
  }
});
