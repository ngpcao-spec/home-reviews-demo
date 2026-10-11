import { expect, it, vi } from "vitest";
import {
  v3Handler,
  type V3Repository,
} from "../../supabase/functions/_shared/pilot-evidence-v3-api";
import { syntheticEvidenceV3 } from "../fixtures/pilot-evidence-v3";
it("GET never writes, all paid/report actions refused, denied roles read nothing", async () => {
  const f = await syntheticEvidenceV3(),
    save = vi.fn(),
    repo: V3Repository = {
      source: async () => ({
        snapshot: f.snapshot,
        base: f.base,
        posthoc: f.posthoc,
        posthoc_sha: f.posthocSha,
      }),
      read: async () => ({ record: null, control: null }),
      save,
    },
    h = v3Handler(async () => repo),
    req = (action: string) =>
      new Request("https://unit.test", {
        method: "POST",
        body: JSON.stringify({ action }),
      });
  expect((await h(new Request("https://unit.test"))).status).toBe(200);
  expect(save).not.toHaveBeenCalled();
  for (const action of ["jev", "sol", "semantic", "apify", "generate_report"]) {
    expect((await h(req(action))).status).toBe(405);
  }
  expect(save).not.toHaveBeenCalled();
  expect((await h(req("audit_free"))).status).toBe(200);
  expect(save).toHaveBeenCalledTimes(1);
  expect(
    (await v3Handler(async () => {
      throw new Error("FORBIDDEN");
    })(new Request("https://unit.test"))).status,
  ).toBe(403);
});
it("saved free audit survives readonly reload and detects tampering", async () => {
  const f = await syntheticEvidenceV3(),
    save = vi.fn(),
    record = {
      id: "id",
      result: f.audit,
      result_sha256: f.sha,
      created_at: "2026-10-11",
    },
    control = { id: "control", ...f.control },
    h = v3Handler(async () => ({
      source: async () => ({
        snapshot: f.snapshot,
        base: f.base,
        posthoc: f.posthoc,
        posthoc_sha: f.posthocSha,
      }),
      read: async () => ({ record, control }),
      save,
    }));
  expect((await h(new Request("https://unit.test"))).status).toBe(200);
  expect(save).not.toHaveBeenCalled();
  record.result_sha256 = "changed";
  expect((await h(new Request("https://unit.test"))).status).toBe(409);
});
