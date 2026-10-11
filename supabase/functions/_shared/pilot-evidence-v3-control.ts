import { negativeHash } from "./negative-validation-core.ts";
import { canonicalJson } from "./jev-exploratory-core.ts";
import type { PilotSnapshot } from "./jev-pilot-core.ts";
import type { EvidenceV21Audit } from "./pilot-evidence-v21-audit.ts";
export const V3_CONTROL_VERSION = "pilot-evidence-v3-new-control-v1";
export interface PosthocCase {
  segment: string;
  review_id: string;
  theme_key: string;
  polarity: string;
  axis: string;
  jev_v21_binding_id: string;
  source_text_sha256: string;
  v21_rule_status: string;
  gpt6_audit_verdict: "supported" | "unsupported" | "uncertain";
}
export interface V3Posthoc {
  schema_version: string;
  label_source: string;
  is_independent_human_validation: false;
  cases: PosthocCase[];
  source: {
    v21_evidence_audit_id: string;
    v21_audit_result_sha256: string;
    source_sha256: string;
  };
  examples?: { review_id: string; theme: string; assessment: string }[];
}
export async function selectV3Control(
  snapshot: PilotSnapshot,
  base: EvidenceV21Audit,
  posthoc: V3Posthoc,
  posthocSha: string,
) {
  const seen = new Set(posthoc.cases.map((c) => c.review_id)),
    pool = base.checks.filter((c) => !seen.has(c.review_id)),
    strata = ["service", "quality", "price", "atmosphere"].flatMap((a) =>
      ["positive", "negative"].map((p) => a + ":" + p)
    ),
    ranked = await Promise.all(
      pool.map(async (c) => ({
        c,
        hash: await negativeHash(
          snapshot.id + ":" + V3_CONTROL_VERSION + ":" + c.binding_id,
        ),
        difficulty: c.status === "supported_by_rule" ? 0 : 1,
      })),
    ),
    chosen: typeof ranked = [],
    reviews = new Set<string>();
  const sorted = strata.map((k) => ({
    key: k,
    count: ranked.filter((x) => x.c.axis + ":" + x.c.polarity === k).length,
  })).sort((a, b) => a.count - b.count || a.key.localeCompare(b.key));
  const candidates = (key?: string) =>
    ranked.filter((x) =>
      !reviews.has(x.c.review_id) &&
      (!key || x.c.axis + ":" + x.c.polarity === key)
    ).sort((a, b) =>
      b.difficulty - a.difficulty || a.hash.localeCompare(b.hash)
    );
  for (const s of sorted) {
    for (let n = 0; n < 5; n++) {
      const x = candidates(s.key)[0];
      if (!x) break;
      chosen.push(x);
      reviews.add(x.c.review_id);
    }
  }
  while (chosen.length < 40) {
    const x = candidates()[0];
    if (!x) break;
    chosen.push(x);
    reviews.add(x.c.review_id);
  }
  if (chosen.length < 40) throw new Error("V3_CONTROL_POOL_INSUFFICIENT");
  const items = chosen.slice(0, 40).map((x, i) => {
      const r = snapshot.source.reviews.find((r) => r.id === x.c.review_id)!;
      return {
        position: i + 1,
        review_id: r.id,
        theme_key: x.c.theme_key,
        polarity: x.c.polarity,
        axis: x.c.axis,
        binding_id: x.c.binding_id,
        analysis_text: r.analysis_text!,
        analysis_text_sha256: r.analysis_text_sha256!,
        selection_hash: x.hash,
        selection_basis: x.difficulty
          ? "v21_difficult_case"
          : "v21_supported_control",
        reference_annotation: null,
      };
    }),
    body = {
      version: V3_CONTROL_VERSION,
      source_sha256: snapshot.source_sha256,
      base_result_source: posthoc.source.v21_evidence_audit_id,
      posthoc_sha256: posthocSha,
      exclusion: "all_review_ids_present_in_199_cases",
      selection_method:
        "scarcity_first_5_per_axis_polarity_then_hardest_remaining_stable_sha256",
      candidate_associations: pool.length,
      candidate_reviews: new Set(pool.map((c) => c.review_id)).size,
      items,
      strata: Object.fromEntries(
        strata.map((k) => [k, {
          available: ranked.filter((x) =>
            x.c.axis + ":" + x.c.polarity === k
          ).length,
          selected: items.filter((x) => x.axis + ":" + x.polarity === k).length,
        }]),
      ),
      no_reference_invented: true,
      annotation_status: "awaiting_external_ai",
      independent_human_validation: false,
      new_paid_calls: 0,
    };
  return { body, sha: await negativeHash(canonicalJson(body)) };
}
export function exportV3Control(
  body: Awaited<ReturnType<typeof selectV3Control>>["body"],
) {
  return {
    version: body.version,
    source_sha256: body.source_sha256,
    instructions:
      "Pour chaque thème demandé, lire uniquement le texte anglais et choisir absent, positive, negative, both ou uncertain. Ne pas déduire les thèmes des notes. Référence IA externe, jamais Gold humain. Les prédictions et polarités proposées ne sont pas fournies.",
    cases: body.items.map((i) => ({
      position: i.position,
      review_id: i.review_id,
      theme_key: i.theme_key,
      analysis_text: i.analysis_text,
      analysis_text_sha256: i.analysis_text_sha256,
      choice: null,
    })),
    label_source: "future_external_ai_not_human_gold",
    predictions_revealed: false,
  };
}
