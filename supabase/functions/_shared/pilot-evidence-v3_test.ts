import {
  parseReviewV3,
  semanticV3Port,
  verifyGraphV3,
} from "./pilot-evidence-v3.ts";
import { THEME_KEYS } from "./jev-themes.ts";
const assert = (ok: unknown) => {
  if (!ok) throw new Error("TEST_ASSERTION_FAILED");
};
Deno.test("V3 no network, 25 themes, entity/polarity separation and exact evidence", () => {
  assert(THEME_KEYS.length === 25);
  const text = "The coffee was excellent but the pancakes were terrible.";
  const graph = parseReviewV3(text);
  assert(
    verifyGraphV3(graph, "drinks", "positive").status === "supported_by_rule",
  );
  const c = verifyGraphV3(graph, "food_quality", "negative");
  assert(
    c.statement &&
      text.slice(c.statement.start, c.statement.end) === c.statement.quote,
  );
  assert(
    verifyGraphV3(graph, "food_quality", "positive").status !==
      "supported_by_rule",
  );
  assert(
    verifyGraphV3(
      parseReviewV3("Excellent service."),
      "professionalism",
      "positive",
    ).status === "unsupported_by_rule",
  );
  assert(
    verifyGraphV3(parseReviewV3("Friendly staff."), "attentiveness", "positive")
      .status === "unsupported_by_rule",
  );
});
Deno.test("V3 paid port disabled", async () => {
  assert(!semanticV3Port.enabled);
  let blocked = false;
  try {
    await semanticV3Port.request();
  } catch {
    blocked = true;
  }
  assert(blocked);
});
