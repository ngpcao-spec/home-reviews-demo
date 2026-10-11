import { syntheticEvidenceV21 } from "./pilot-evidence-v21";
import { negativeHash } from "../../supabase/functions/_shared/negative-validation-core";
import { pilotSourceHash } from "../../supabase/functions/_shared/jev-pilot-core";
import {
  evidenceV21AuditHash,
  type EvidenceV21Binding,
} from "../../supabase/functions/_shared/pilot-evidence-v21-audit";
import {
  selectV3Control,
  type V3Posthoc,
} from "../../supabase/functions/_shared/pilot-evidence-v3-control";
import {
  buildV3Audit,
  v3Hash,
} from "../../supabase/functions/_shared/pilot-evidence-v3-audit";
import type { V3View } from "../../supabase/functions/_shared/pilot-evidence-v3-api";
export async function syntheticEvidenceV3() {
  const f = await syntheticEvidenceV21();
  const originalIds = new Set(f.audit.checks.map((c) => c.review_id));
  for (let n = 0; n < 48; n++) {
    const r = structuredClone(f.snapshot.source.reviews[0]),
      theme = n % 4 === 0
        ? "attentiveness"
        : n % 4 === 1
        ? "food_quality"
        : n % 4 === 2
        ? "price_level"
        : "cleanliness",
      axis = ["service", "quality", "price", "atmosphere"][n % 4],
      polarity = n % 8 < 4 ? "positive" : "negative";
    r.id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
    r.original_text = `Synthetic ${n}. ` +
      (theme === "attentiveness"
        ? "The staff checked on us."
        : theme === "food_quality"
        ? "The pancakes were delicious."
        : theme === "price_level"
        ? "The price was expensive."
        : "The restroom was dirty.");
    r.analysis_text = r.original_text;
    r.original_text_sha256 = await negativeHash(r.original_text);
    r.analysis_text_sha256 = r.original_text_sha256;
    f.snapshot.source.reviews.push(r);
    const c = {
      ...f.audit.checks[0],
      binding_id: "synthetic-binding-" + n,
      v2_binding_id: "old-" + n,
      review_id: r.id,
      theme_key: theme,
      axis,
      polarity,
      key: theme + ":" + polarity,
      analysis_text_sha256: r.analysis_text_sha256,
      status: "review_needed",
      reason: "SYNTHETIC_FIXTURE",
      excerpt: null,
      quote_sha256: null,
    } as EvidenceV21Binding;
    f.audit.checks.push(c);
  }
  f.snapshot.source_sha256 = await pilotSourceHash(f.snapshot.source);
  f.audit.source_sha256 = f.snapshot.source_sha256;
  f.audit.summary.jev_findings = f.audit.checks.length;
  const base = {
      id: "v21-synthetic",
      result: f.audit,
      result_sha256: await evidenceV21AuditHash(f.audit),
    },
    posthoc: V3Posthoc = {
      schema_version: "test-fixture",
      label_source: "synthetic_test_only_not_reference_data",
      is_independent_human_validation: false,
      source: {
        v21_evidence_audit_id: base.id,
        v21_audit_result_sha256: base.result_sha256,
        source_sha256: f.snapshot.source_sha256,
      },
      cases: f.audit.checks.filter((c) => originalIds.has(c.review_id)).map(
        (c) => ({
          segment: "synthetic",
          review_id: c.review_id,
          theme_key: c.theme_key,
          polarity: c.polarity,
          axis: c.axis,
          jev_v21_binding_id: c.binding_id,
          source_text_sha256: c.analysis_text_sha256,
          v21_rule_status: c.status,
          gpt6_audit_verdict: "uncertain",
        }),
      ),
    },
    posthocSha = await v3Hash(posthoc),
    control = await selectV3Control(
      f.snapshot,
      base.result,
      posthoc,
      posthocSha,
    ),
    audit = await buildV3Audit(f.snapshot, base, posthoc, posthocSha, control),
    sha = await v3Hash(audit);
  return {
    snapshot: f.snapshot,
    base,
    posthoc,
    posthocSha,
    control,
    audit,
    sha,
  };
}
export async function syntheticEvidenceV3View(): Promise<V3View> {
  const f = await syntheticEvidenceV3();
  const { exportV3Control } = await import(
    "../../supabase/functions/_shared/pilot-evidence-v3-control"
  );
  return {
    version: f.audit.version,
    ready: true,
    record: {
      id: "v3-fixture",
      result: f.audit,
      result_sha256: f.sha,
      created_at: "2026-10-11",
    },
    control: {
      id: "control-fixture",
      body: f.control.body,
      sha: f.control.sha,
    },
    blind_export: exportV3Control(f.control.body),
    new_paid_calls: 0,
    production_enabled: false,
    semantic_paid_enabled: false,
  };
}
