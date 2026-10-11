import { assertMembership, requireUser } from "../_shared/auth.ts";
import {
  v3Handler,
  type V3Record,
  type V3View,
} from "../_shared/pilot-evidence-v3-api.ts";
import type { V3Base } from "../_shared/pilot-evidence-v3-audit.ts";
import type { PilotSnapshot } from "../_shared/jev-pilot-core.ts";
import { v3Hash, v3PipelineHash } from "../_shared/pilot-evidence-v3-audit.ts";
import type { V3Posthoc } from "../_shared/pilot-evidence-v3-control.ts";
import posthoc from "../../../docs/jev-economic-pilot-gpt6-posthoc-audit-20261011.json" with {
  type: "json",
};
const BASE = "854ae975-7a7e-4a73-ae9e-d2f4807d046a",
  POSTHOC_FILE_SHA =
    "100fb2ec6e57b5cf6e779a15e21801a077c4ce72776f31fc54c62c0b0d578276",
  POSTHOC_CANONICAL_SHA =
    "4f042118a0dbb7c3e953b8e56ae22ea1b922e57083ab13894bcef174b4c1ca54";
Deno.serve(v3Handler(async (request) => {
  const ctx = await requireUser(request);
  const { data: b, error } = await ctx.admin.from(
    "analysis_jev_pilot_evidence_v21",
  ).select("*").eq("id", BASE).single();
  if (error || !b) throw new Error("FORBIDDEN");
  await assertMembership(ctx.client, ctx.user.id, b.organization_id, [
    "owner",
    "admin",
    "manager",
  ]);
  if (await v3Hash(posthoc) !== POSTHOC_CANONICAL_SHA) {
    throw new Error("V3_POSTHOC_FILE_CHANGED");
  }
  return {
    source: async () => {
      const { data: s, error } = await ctx.admin.from(
        "analysis_jev_pilot_snapshots",
      ).select("*").eq("id", b.snapshot_id).eq(
        "organization_id",
        b.organization_id,
      ).single();
      if (error || !s) throw new Error("V3_SOURCE_FAILED");
      return {
        snapshot: s as PilotSnapshot,
        base: b as V3Base,
        posthoc: posthoc as V3Posthoc,
        posthoc_sha: POSTHOC_FILE_SHA,
      };
    },
    read: async () => {
      const { data: a, error: ae } = await ctx.admin.from(
          "analysis_jev_pilot_evidence_v3",
        ).select("*").eq("organization_id", b.organization_id).eq(
          "base_audit_id",
          BASE,
        ).eq("rule_sha256", await v3PipelineHash()).maybeSingle(),
        { data: c, error: ce } = await ctx.admin.from(
          "analysis_jev_pilot_evidence_v3_controls",
        ).select("*").eq("organization_id", b.organization_id).eq(
          "base_audit_id",
          BASE,
        ).maybeSingle();
      if (ae || ce) throw new Error("V3_READ_FAILED");
      return {
        record: a as V3Record | null,
        control: c
          ? {
            id: c.id,
            body: c.body,
            sha: c.result_sha256,
          } as V3View["control"]
          : null,
      };
    },
    save: async (control, audit, sha) => {
      const { error } = await ctx.admin.rpc("save_pilot_evidence_v3", {
        p_user: ctx.user.id,
        p_base: BASE,
        p_control: control.body,
        p_control_sha: control.sha,
        p_result: audit,
        p_sha: sha,
      });
      if (error) {
        throw new Error(
          /V3_[A-Z0-9_]+|FORBIDDEN/.exec(error.message)?.[0] ??
            "V3_SAVE_FAILED",
        );
      }
    },
  };
}));
