import { expect, it } from "vitest";
import { syntheticEvidenceV3 } from "../fixtures/pilot-evidence-v3";
import {
  buildV3Audit,
  nearDuplicate,
  v3Hash,
  v3Recommendation,
  verifyV3Audit,
} from "../../supabase/functions/_shared/pilot-evidence-v3-audit";
import {
  exportV3Control,
  selectV3Control,
} from "../../supabase/functions/_shared/pilot-evidence-v3-control";
import { negativeHash } from "../../supabase/functions/_shared/negative-validation-core";
it("selects 40 unique reviews and freezes IDs before additional annotations", async () => {
  const f = await syntheticEvidenceV3(),
    ids = f.control.body.items.map((c) => c.review_id);
  expect(new Set(ids).size).toBe(40);
  expect(ids.some((id) => f.posthoc.cases.some((c) => c.review_id === id)))
    .toBe(false);
  expect(f.control.body.items.every((c) => c.reference_annotation === null))
    .toBe(true);
  expect(
    (await selectV3Control(f.snapshot, f.base.result, f.posthoc, f.posthocSha))
      .sha,
  ).toBe(f.control.sha);
  expect(
    exportV3Control(f.control.body).cases.every((c) =>
      c.choice === null && !("polarity" in c) && !("v21_status" in c)
    ),
  ).toBe(true);
  for (const c of f.audit.checks.filter((c) => ids.includes(c.review_id))) {
    expect(c.status).toBe("review_needed");
    expect(c.statement).toBeNull();
  }
});
it("retains all JEV associations and source hashes without changing reference data", async () => {
  const f = await syntheticEvidenceV3(),
    before = JSON.stringify({
      source: f.snapshot,
      base: f.base,
      posthoc: f.posthoc,
    });
  await buildV3Audit(f.snapshot, f.base, f.posthoc, f.posthocSha, f.control);
  expect(
    JSON.stringify({ source: f.snapshot, base: f.base, posthoc: f.posthoc }),
  ).toBe(before);
  expect(f.audit.checks).toHaveLength(f.base.result.checks.length);
  expect(f.audit.theme_coverage).toHaveLength(25);
  await verifyV3Audit(f.snapshot, f.base, f.audit, f.sha, f.control.sha);
  for (const c of f.audit.checks) {
    if (c.statement) {
      expect(c.analysis_text.slice(c.statement.start, c.statement.end)).toBe(
        c.statement.quote,
      );
      expect(await negativeHash(c.statement.quote)).toBe(c.quote_sha256);
    }
  }
});
it("rejects modified text, quote, reference identity and control hashes", async () => {
  const f = await syntheticEvidenceV3();
  let a = structuredClone(f.audit);
  a.checks[0].analysis_text += " modified";
  await expect(
    verifyV3Audit(f.snapshot, f.base, a, await v3Hash(a), f.control.sha),
  ).rejects.toThrow("V3_PREDICTION_CHANGED");
  a = structuredClone(f.audit);
  const c = a.checks.find((c) => c.statement)!;
  c.statement!.quote = "invented";
  await expect(
    verifyV3Audit(f.snapshot, f.base, a, await v3Hash(a), f.control.sha),
  ).rejects.toThrow("V3_QUOTE_CHANGED");
  await expect(
    buildV3Audit(f.snapshot, f.base, f.posthoc, f.posthocSha, {
      ...f.control,
      sha: "x",
    }),
  ).rejects.toThrow("V3_CONTROL_CHANGED");
});
it("one action cannot borrow unrelated same-axis evidence; missing proof blocks action", async () => {
  const f = await syntheticEvidenceV3(),
    r = f.audit.recommendations.find((c) => c.status === "grounded_by_rules")!;
  expect(r.proof_ids.length).toBeGreaterThan(0);
  const removed = f.audit.checks.filter((c) =>
      !r.proof_ids.includes(c.binding_id)
    ),
    bad = v3Recommendation(f.audit.selected, removed, r.axis);
  expect(bad.status).toBe("review_needed");
  expect(bad.action_fr).toBeNull();
  expect(
    f.audit.recommendations.every((c) =>
      !(c.action_fr ?? "").includes("formation")
    ),
  ).toBe(true);
});
it("suppresses near-duplicate quotes", () =>
  expect(
    nearDuplicate(
      "The pancakes were delicious.",
      "The pancakes were delicious!",
    ),
  ).toBe(true));
