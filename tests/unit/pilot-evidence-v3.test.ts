import { describe, expect, it } from "vitest";
import {
  parseReviewV3,
  semanticV3Port,
  verifyGraphV3,
} from "../../supabase/functions/_shared/pilot-evidence-v3";
import { THEME_KEYS } from "../../supabase/functions/_shared/jev-themes";
import { ARTISAN_EVIDENCE_CASES } from "../fixtures/pilot-evidence";
const check = (
  text: string,
  theme: Parameters<typeof verifyGraphV3>[1],
  polarity: "positive" | "negative" = "positive",
) => verifyGraphV3(parseReviewV3(text), theme, polarity);
describe("V3 bounded entity and predicate checks, no model calls", () => {
  it("a resolved hygiene problem is not current negative evidence", () => {
    const text =
      "Today the restroom is immaculately clean, every trace of the black mold has been removed.";
    expect(check(text, "cleanliness", "negative").status).not.toBe(
      "supported_by_rule",
    );
    expect(check(text, "cleanliness", "positive").status).toBe(
      "supported_by_rule",
    );
  });
  it("keeps 25 themes", () => expect(THEME_KEYS).toHaveLength(25));
  it.each(["Excellent service.", "Great service.", "Top-notch service."])(
    "general praise cannot prove competence: %s",
    (s) =>
      expect(check(s, "professionalism").status).toBe("unsupported_by_rule"),
  );
  it("explicit professional conduct", () =>
    expect(
      check("The waiter was professional and knowledgeable.", "professionalism")
        .status,
    ).toBe("supported_by_rule"));
  it("external medical expertise is not staff expertise", () =>
    expect(
      check("A professional doctor helped my wife.", "professionalism").status,
    ).not.toBe("supported_by_rule"));
  it("friendliness is not customer care", () =>
    expect(check("Friendly staff.", "attentiveness").status).toBe(
      "unsupported_by_rule",
    ));
  it("language barrier is communication, not care", () => {
    expect(
      check("There was a language barrier.", "communication", "negative")
        .status,
    ).toBe("supported_by_rule");
    expect(
      check("There was a language barrier.", "attentiveness", "negative")
        .status,
    ).toBe("unsupported_by_rule");
  });
  it("concrete follow up", () =>
    expect(check("The staff checked on our table.", "attentiveness").status)
      .toBe("supported_by_rule"));
  it("response to request", () =>
    expect(
      check(
        "We asked for a fan, and they brought one right away.",
        "attentiveness",
      ).status,
    ).toBe("supported_by_rule"));
  it("a drink cannot prove food quality", () => {
    expect(check("Excellent coffee.", "drinks").status).toBe(
      "supported_by_rule",
    );
    expect(check("Excellent coffee.", "food_quality").status).toBe(
      "unsupported_by_rule",
    );
  });
  it.each([
    "Delicious pancakes.",
    "The shakshuka was delicious.",
    "The cinnamon buns were fantastic.",
  ])(
    "food aliases and plurals %s",
    (s) => expect(check(s, "food_quality").status).toBe("supported_by_rule"),
  );
  it("separates sentiments across food and drinks", () => {
    const g = parseReviewV3(
      "The coffee was excellent but the pasta was terrible.",
    );
    expect(verifyGraphV3(g, "drinks", "positive").status).toBe(
      "supported_by_rule",
    );
    expect(verifyGraphV3(g, "food_quality", "negative").status).toBe(
      "supported_by_rule",
    );
    expect(verifyGraphV3(g, "food_quality", "positive").status).not.toBe(
      "supported_by_rule",
    );
  });
  it("negation binds locally", () => {
    expect(check("The food was not good.", "food_quality", "negative").status)
      .toBe("supported_by_rule");
    expect(check("The food was not good.", "food_quality").status).not.toBe(
      "supported_by_rule",
    );
  });
  it("double negation", () =>
    expect(check("The food was not bad.", "food_quality").status).toBe(
      "supported_by_rule",
    ));
  it("hypothetical and ambiguous antecedent remain pending", () => {
    expect(check("Maybe the food is good.", "food_quality").status).toBe(
      "review_needed",
    );
    expect(
      check("We ordered toast and juice. It was delicious.", "food_quality")
        .status,
    ).toBe("review_needed");
  });
  it("no forced resolution of contradiction", () =>
    expect(
      check("The food was excellent. The food was terrible.", "food_quality")
        .status,
    ).toBe("review_needed"));
  it("a historical defect does not support current action", () => {
    const c = check(
      "Previously the restroom was dirty. Now the restroom is clean.",
      "cleanliness",
      "negative",
    );
    expect(c.status).toBe("review_needed");
  });
  it("price and value are different polarities", () => {
    expect(check("Expensive but worth it.", "price_level", "negative").status)
      .toBe("supported_by_rule");
    expect(check("Expensive but worth it.", "value").status).toBe(
      "supported_by_rule",
    );
    expect(check("Expensive but worth it.", "value", "negative").status).not
      .toBe("supported_by_rule");
  });
  it("price alone does not prove value", () =>
    expect(check("Expensive.", "value", "negative").status).toBe(
      "unsupported_by_rule",
    ));
  it("distance claim is not wayfinding", () => {
    const c = check("It is too far away.", "location", "negative");
    expect(c.statement?.claim).toBe("distance_problem");
    expect(
      check("The entrance is hard to find.", "location", "negative").statement
        ?.claim,
    ).toBe("wayfinding_problem");
  });
  it("generic delay does not prove competence or care", () => {
    expect(check("Slow service.", "wait_time", "negative").status).toBe(
      "supported_by_rule",
    );
    expect(check("Slow service.", "professionalism", "negative").status).not
      .toBe("supported_by_rule");
    expect(check("Slow service.", "attentiveness", "negative").status).not.toBe(
      "supported_by_rule",
    );
  });
  it("taste alone is not cooking or freshness", () => {
    expect(check("Terrible food.", "cooking", "negative").status).not.toBe(
      "supported_by_rule",
    );
    expect(check("Terrible food.", "freshness", "negative").status).not.toBe(
      "supported_by_rule",
    );
  });
  it("symptoms do not establish causality", () => {
    const g = parseReviewV3("I felt sick after dinner.");
    expect(g.flags).toContain("CUSTOMER_REPORTED_HEALTH_SIGNAL_NO_CAUSALITY");
    expect(g.statements).toHaveLength(0);
  });
  it("exact quote offsets", () => {
    const s = "Good coffee. The pancakes were delicious!";
    const c = check(s, "food_quality");
    expect(c.statement).not.toBeNull();
    expect(s.slice(c.statement!.start, c.statement!.end)).toBe(
      c.statement!.quote,
    );
  });
  it("semantic paid interface cannot be enabled", async () => {
    expect(semanticV3Port.enabled).toBe(false);
    await expect(semanticV3Port.request()).rejects.toThrow(
      "SEMANTIC_PAID_VERIFICATION_DISABLED",
    );
  });
  it("three real regressions: communication, general service and unassuming location", () => {
    const [communication, generic, location] = ARTISAN_EVIDENCE_CASES;
    expect(check(communication.text, "attentiveness", "negative").status).toBe(
      "unsupported_by_rule",
    );
    expect(check(communication.text, "communication", "negative").status).toBe(
      "supported_by_rule",
    );
    expect(check(generic.text, "professionalism").status).toBe(
      "unsupported_by_rule",
    );
    expect(check(location.text, "location", "negative").status).toBe(
      "unsupported_by_rule",
    );
  });
  it("negated events never become proof of the claimed action", () => {
    expect(check("The staff never checked on us.", "attentiveness").status).not
      .toBe("supported_by_rule");
    expect(check("There was no long wait.", "wait_time", "negative").status).not
      .toBe("supported_by_rule");
  });
  it("visual appearance does not establish food taste", () =>
    expect(check("The food looked delicious.", "food_quality").status).not.toBe(
      "supported_by_rule",
    ));
  it.each(
    [
      ["food_quality", "Delicious pancakes."],
      ["freshness", "The food was fresh."],
      ["cooking", "The steak was perfectly cooked."],
      ["temperature", "The meal was served hot."],
      ["portions", "Generous portions."],
      ["presentation", "Beautifully plated."],
      ["drinks", "Excellent coffee."],
      ["variety", "Many menu options."],
      ["consistency", "Consistent quality."],
      ["friendly_staff", "Friendly staff."],
      ["attentiveness", "The staff checked on us."],
      ["wait_time", "Prompt service."],
      ["coordination", "Service was well organized."],
      ["communication", "The waiter clearly explained the menu."],
      ["order_accuracy", "The order was correct."],
      ["professionalism", "The waiter was knowledgeable."],
      ["atmosphere", "Wonderful atmosphere."],
      ["decor", "Beautiful interior."],
      ["noise", "The music was quiet."],
      ["comfort", "Comfortable seats."],
      ["cleanliness", "The restroom was clean."],
      ["location", "Good location."],
      ["value", "Good value."],
      ["billing", "Correct bill."],
      ["price_level", "Affordable prices."],
    ] as const,
  )(
    "explicit coverage for %s",
    (theme, text) =>
      expect(check(text, theme).status).toBe("supported_by_rule"),
  );
});
