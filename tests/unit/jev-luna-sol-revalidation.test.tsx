import { beforeAll, expect, it } from "vitest";
import { jlsFixture, mockJlsLuna, mockJlsReport } from "../fixtures/jev-luna-sol";
import { parseJlsLuna } from "../../supabase/functions/_shared/jev-luna-sol";
import { validateJlsReport } from "../../supabase/functions/_shared/jev-luna-sol-validation";
import { hybridHash } from "../../supabase/functions/_shared/jev-hybrid-evidence";
import { JLS_REVALIDATION_VERSION, verifyJlsRevalidation, type JlsRevalidation } from "../../supabase/functions/_shared/jev-luna-sol-revalidation";
let original: Parameters<typeof verifyJlsRevalidation>[2], revision: JlsRevalidation;
beforeAll(async () => {
  const f = await jlsFixture(), decisions = (await Promise.all(f.jls.luna_groups.map(async g =>
    (await parseJlsLuna(f.jls, g, mockJlsLuna(g))).decisions))).flat();
  const sol_result = await validateJlsReport(mockJlsReport(f.jls, decisions.map(d => d.evidence_id)), f.jls, f.snapshot, decisions);
  const body = { sol_result };
  original = { body, result_sha256: await hybridHash(body) };
  const revisionBody: JlsRevalidation["body"] = { version: JLS_REVALIDATION_VERSION, run_id: "test-run",
    original_result_sha256: original.result_sha256, validator_commit: "a".repeat(40), new_paid_calls: 0, sol_result };
  revision = { body: revisionBody, sha256: await hybridHash(revisionBody) };
});
it("reads a separately hashed revision without changing the original", async () => {
  const before = JSON.stringify(original);
  expect(await verifyJlsRevalidation(revision, "test-run", original)).toEqual(revision);
  expect(JSON.stringify(original)).toBe(before);
});
it("rejects another run even with a valid hash", async () => {
  await expect(verifyJlsRevalidation(revision, "other-run", original)).rejects.toThrow("CHANGED");
});
it("rejects a tampered revision", async () => {
  const r = structuredClone(revision); r.body.sol_result.report.conclusion.text = "changed";
  await expect(verifyJlsRevalidation(r, "test-run", original)).rejects.toThrow("CHANGED");
});
it.each(["source", "decisions", "statistics", "conclusion"])("rejects a rehashed out-of-scope %s change", async kind => {
  const r = structuredClone(revision), s = r.body.sol_result;
  if(kind === "source")s.raw_response_sha256 = "f".repeat(64);
  if(kind === "decisions")s.luna_decisions = [];
  if(kind === "statistics")s.statistics_sha256 = "f".repeat(64);
  if(kind === "conclusion")s.report.conclusion.text = "changed";
  r.sha256 = await hybridHash(r.body);
  await expect(verifyJlsRevalidation(r, "test-run", original)).rejects.toThrow("SCOPE_CHANGED");
});

import { cleanup, render, screen } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n";
import { JlsDelegatedStatus } from "../../src/pages/JevLunaSolPage";
import { executionCosts } from "../../supabase/functions/_shared/jev-luna-sol-delegation";
it.each(["fr", "vi"] as const)("displays the revised report and historical status in %s", language => {
  const r = structuredClone(revision);
  r.body.sol_result.report.conclusion.text = "Synthetic revised display";
  render(<I18nProvider language={language}><JlsDelegatedStatus data={{
    ready: true, plan_id: "test-plan", protocol: null, tasks: [], dossier: null,
    run: {id:"test-run",status:"needs_review",consent_source:"test",consent_sha256:"test",expires_at:"2026-10-14T00:00:00Z",gate:null,error_code:null},
    result: original, revalidation: r, costs: executionCosts([]),
  }}/></I18nProvider>);
  expect(screen.getByText("Synthetic revised display")).toBeVisible();
  expect(screen.getByText(language === "fr" ? /Rapport revalidé sans nouvel appel payant/ : /Báo cáo đã được kiểm tra lại/)).toHaveTextContent("needs_review");
  expect(screen.getByText(/jls-quote-bound-actions-v1/)).toBeVisible();
  cleanup();
});
