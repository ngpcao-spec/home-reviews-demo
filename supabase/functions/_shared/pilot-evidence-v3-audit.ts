import {
  parseReviewV3,
  type Statement,
  V3_VERIFIER,
  V3_VERSION,
  type V3Decision,
  v3RuleHash,
  verifyGraphV3,
} from "./pilot-evidence-v3.ts";
import {
  selectV3Control,
  type V3Posthoc,
} from "./pilot-evidence-v3-control.ts";
import { negativeHash } from "./negative-validation-core.ts";
import { canonicalJson } from "./jev-exploratory-core.ts";
import {
  PILOT_AXES,
  type PilotSnapshot,
  verifyPilotSnapshot,
} from "./jev-pilot-core.ts";
import {
  type EvidenceV21Audit,
  evidenceV21AuditHash,
} from "./pilot-evidence-v21-audit.ts";
import { THEME_KEYS, type ThemeKey } from "./jev-themes.ts";
export interface V3Base {
  id: string;
  result: EvidenceV21Audit;
  result_sha256: string;
}
export interface V3Binding extends V3Decision {
  binding_id: string;
  v21_binding_id: string;
  review_id: string;
  theme_key: ThemeKey;
  polarity: "positive" | "negative";
  axis: string;
  analysis_text: string;
  analysis_text_sha256: string;
  quote_sha256: string | null;
  v21_status: string;
  cache_id: string;
  cache_response_sha256: string;
  served_model: string;
}
const ACTIONS = [
  {
    id: "service_delays",
    axis: "service",
    claims: ["service_delays"],
    fr: "Revoir les délais de service signalés.",
    vi: "Xem xét thời gian phục vụ bị phản ánh.",
  },
  {
    id: "communication",
    axis: "service",
    claims: ["communication_difficulty"],
    fr: "Clarifier les échanges et vérifier la compréhension des commandes.",
    vi: "Làm rõ trao đổi và xác nhận khách và nhân viên hiểu đúng đơn gọi.",
  },
  {
    id: "care",
    axis: "service",
    claims: ["customer_care_missing"],
    fr: "Vérifier la prise en charge des demandes restées sans réponse.",
    vi: "Kiểm tra việc tiếp nhận yêu cầu không được đáp ứng.",
  },
  {
    id: "food",
    axis: "quality",
    claims: ["food_quality"],
    fr:
      "Revoir les plats dont le goût ou la qualité sont explicitement critiqués.",
    vi: "Xem lại các món bị phê bình rõ về hương vị hoặc chất lượng.",
  },
  {
    id: "cooking",
    axis: "quality",
    claims: ["cooking_defect"],
    fr: "Contrôler les défauts de cuisson précisément signalés.",
    vi: "Kiểm tra lỗi chế biến được mô tả cụ thể.",
  },
  {
    id: "drinks",
    axis: "quality",
    claims: ["drinks"],
    fr: "Revoir les boissons explicitement critiquées.",
    vi: "Xem lại đồ uống bị phê bình rõ ràng.",
  },
  {
    id: "value",
    axis: "price",
    claims: ["value_mismatch"],
    fr:
      "Examiner le rapport entre la prestation reçue et le prix payé décrit dans ces avis.",
    vi:
      "Xem xét tương quan giữa dịch vụ nhận được và giá đã trả trong các đánh giá này.",
  },
  {
    id: "price",
    axis: "price",
    claims: ["high_price"],
    fr: "Examiner les retours explicites sur le niveau des prix.",
    vi: "Xem xét phản hồi rõ về mức giá.",
  },
  {
    id: "bill",
    axis: "price",
    claims: ["bill_charge"],
    fr: "Vérifier les suppléments ou erreurs de facturation signalés.",
    vi: "Kiểm tra phụ phí hoặc lỗi hóa đơn được phản ánh.",
  },
  {
    id: "hygiene",
    axis: "atmosphere",
    claims: ["reported_hygiene", "cleanliness"],
    fr:
      "Vérifier les problèmes de propreté précisément décrits, sans conclure à une causalité médicale.",
    vi:
      "Kiểm tra vấn đề vệ sinh được mô tả cụ thể, không suy ra nguyên nhân y tế.",
  },
  {
    id: "noise",
    axis: "atmosphere",
    claims: ["noise"],
    fr: "Examiner les nuisances sonores explicitement signalées.",
    vi: "Xem xét tiếng ồn được phản ánh rõ ràng.",
  },
  {
    id: "comfort",
    axis: "atmosphere",
    claims: ["comfort"],
    fr: "Vérifier les conditions de confort physique décrites.",
    vi: "Kiểm tra điều kiện tiện nghi được mô tả.",
  },
  {
    id: "distance",
    axis: "atmosphere",
    claims: ["distance_problem"],
    fr: "Examiner les retours sur la distance et le déplacement.",
    vi: "Xem xét phản hồi về khoảng cách và di chuyển.",
  },
  {
    id: "wayfinding",
    axis: "atmosphere",
    claims: ["wayfinding_problem"],
    fr:
      "Clarifier les indications de repérage correspondant aux difficultés décrites.",
    vi: "Làm rõ chỉ dẫn tìm địa điểm theo khó khăn đã được mô tả.",
  },
];
const normalizedWords = (s: string) =>
  new Set(
    s.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) =>
      w.length > 2
    ),
  );
export const v3PipelineHash = async () =>
  negativeHash(canonicalJson({
    engine_sha256: await v3RuleHash(),
    actions: ACTIONS,
    evidence_policy:
      "exact_quote_utf16_span_sha256_current_events_first_2_per_theme_polarity_near_duplicates_jaccard_0.85_reserved_control_excluded_v1",
    recommendation_policy:
      "negative_current_exact_claim_membership_no_missing_proofs_v1",
  }));
export function nearDuplicate(a: string, b: string) {
  const x = normalizedWords(a),
    y = normalizedWords(b),
    inter = [...x].filter((w) => y.has(w)).length;
  return inter / Math.max(1, x.size + y.size - inter) >= 0.85;
}
// Invocation-local acceleration only: same words, Jaccard formula and threshold.
// Historical audit callers keep using nearDuplicate above unchanged.
export function nearDuplicateMemo(){
 const words=new Map<string,Set<string>>();
 const get=(text:string)=>{let value=words.get(text);if(!value){value=normalizedWords(text);words.set(text,value)}return value;};
 return (a:string,b:string)=>{const x=get(a),y=get(b);let inter=0;for(const word of x)if(y.has(word))inter++;
  return inter/Math.max(1,x.size+y.size-inter)>=0.85;};
}
export function selectV3Proofs(checks: V3Binding[]) {
  const supported = checks.filter((c) =>
      c.status === "supported_by_rule" && c.statement?.actionable
    ),
    selected: V3Binding[] = [];
  for (const theme of THEME_KEYS) {
    for (const polarity of ["positive", "negative"]) {
      const pool = supported.filter((c) =>
        c.theme_key === theme && c.polarity === polarity
      ).sort((a, b) =>
        Number(b.statement!.relation === "predicate_argument_event") -
          Number(a.statement!.relation === "predicate_argument_event") ||
        a.statement!.quote.length - b.statement!.quote.length ||
        a.review_id.localeCompare(b.review_id)
      );
      for (const c of pool) {
        if (
          selected.filter((p) =>
            p.theme_key === theme && p.polarity === polarity
          ).length >= 2
        ) {
          break;
        }
        if (
          selected.some((p) =>
            p.review_id === c.review_id && p.theme_key === theme ||
            p.theme_key === theme && p.polarity === polarity &&
              nearDuplicate(p.statement!.quote, c.statement!.quote)
          )
        ) continue;
        selected.push(c);
      }
    }
  }
  return selected;
}
export function v3Recommendation(
  selected: V3Binding[],
  checks: V3Binding[],
  axis: string,
) {
  const options = ACTIONS.filter((a) => a.axis === axis).map((a) => ({
      a,
      proofs: selected.filter((p) =>
        p.axis === axis && p.polarity === "negative" &&
        p.statement?.actionable && a.claims.includes(p.statement.claim)
      ),
    })
    ),
    best = options.find((o) => o.proofs.length >= 2) ??
      options.find((o) => o.proofs.length) ?? options[0],
    proofs = best?.proofs.slice(0, 2) ?? [],
    missing = proofs.filter((p) =>
      !checks.some((c) =>
        c.binding_id === p.binding_id && c.status === "supported_by_rule" &&
        c.quote_sha256 === p.quote_sha256 &&
        c.statement?.claim === p.statement?.claim
      )
    );
  return {
    axis,
    action_id: best?.a.id ?? null,
    status: proofs.length && !missing.length
      ? "grounded_by_rules" as const
      : "review_needed" as const,
    action_fr: proofs.length && !missing.length ? best.a.fr : null,
    action_vi: proofs.length && !missing.length ? best.a.vi : null,
    claim_ids: best?.a.claims ?? [],
    proof_ids: proofs.map((p) => p.binding_id),
    missing_proofs: missing.map((p) => p.binding_id),
    interpretation_source: "bounded_rule_action_catalog_not_human_validation",
  };
}
export const v3Hash = (v: unknown) => negativeHash(canonicalJson(v));
export async function verifyV3Sources(
  snapshot: PilotSnapshot,
  base: V3Base,
  posthoc: V3Posthoc,
) {
  await verifyPilotSnapshot(snapshot);
  if (
    await evidenceV21AuditHash(base.result) !== base.result_sha256 ||
    posthoc.source.v21_evidence_audit_id !== base.id ||
    posthoc.source.v21_audit_result_sha256 !== base.result_sha256 ||
    posthoc.source.source_sha256 !== snapshot.source_sha256 ||
    base.result.source_sha256 !== snapshot.source_sha256 ||
    posthoc.is_independent_human_validation !== false
  ) throw new Error("V3_SOURCE_CHANGED");
  const unique = new Set<string>();
  for (const c of posthoc.cases) {
    const old = base.result.checks.find((x) =>
        x.binding_id === c.jev_v21_binding_id
      ),
      r = snapshot.source.reviews.find((x) => x.id === c.review_id);
    if (
      !old || !r?.analysis_text || unique.has(old.binding_id) ||
      old.review_id !== c.review_id || old.theme_key !== c.theme_key ||
      old.polarity !== c.polarity || old.status !== c.v21_rule_status ||
      old.analysis_text_sha256 !== c.source_text_sha256 ||
      await negativeHash(r.analysis_text) !== c.source_text_sha256
    ) throw new Error("V3_POSTHOC_BINDING_CHANGED");
    unique.add(old.binding_id);
  }
}
export async function buildV3Audit(
  snapshot: PilotSnapshot,
  base: V3Base,
  posthoc: V3Posthoc,
  posthocSha: string,
  control: Awaited<ReturnType<typeof selectV3Control>>,
) {
  await verifyV3Sources(snapshot, base, posthoc);
  const expected = await selectV3Control(
    snapshot,
    base.result,
    posthoc,
    posthocSha,
  );
  if (
    await v3Hash(control.body) !== control.sha || expected.sha !== control.sha
  ) throw new Error("V3_CONTROL_CHANGED");
  const reserved = new Set(control.body.items.map((i) => i.review_id)),
    graphs = new Map<string, ReturnType<typeof parseReviewV3>>();
  const checks: V3Binding[] = await Promise.all(
    base.result.checks.map(async (old) => {
      const r = snapshot.source.reviews.find((r) => r.id === old.review_id)!;
      if (
        !r?.analysis_text ||
        await negativeHash(r.analysis_text) !== old.analysis_text_sha256
      ) throw new Error("V3_TEXT_CHANGED");
      if (!reserved.has(r.id) && !graphs.has(r.id)) {
        graphs.set(r.id, parseReviewV3(r.analysis_text));
      }
      const d: V3Decision = reserved.has(r.id)
        ? {
          status: "review_needed",
          reason: "RESERVED_NEW_CONTROL_NOT_EVALUATED",
          statement: null,
          flags: [],
          verification_type: "structured_deterministic_check",
          human_validated: false,
          ai_verified: false,
        }
        : verifyGraphV3(graphs.get(r.id)!, old.theme_key, old.polarity);
      return {
        ...d,
        binding_id: await negativeHash(V3_VERSION + ":" + old.binding_id),
        v21_binding_id: old.binding_id,
        review_id: r.id,
        theme_key: old.theme_key,
        polarity: old.polarity,
        axis: old.axis,
        analysis_text: r.analysis_text,
        analysis_text_sha256: old.analysis_text_sha256,
        quote_sha256: d.statement
          ? await negativeHash(d.statement.quote)
          : null,
        v21_status: old.status,
        cache_id: old.cache_id,
        cache_response_sha256: old.cache_response_sha256,
        served_model: old.served_model,
      };
    }),
  );
  const selected = selectV3Proofs(checks),
    statuses = [
      "supported_by_rule",
      "unsupported_by_rule",
      "review_needed",
    ] as const,
    diagnostic = posthoc.cases.map((c) => {
      const v = checks.find((x) => x.v21_binding_id === c.jev_v21_binding_id)!;
      return {
        ...v,
        segment: c.segment,
        gpt6_verdict: c.gpt6_audit_verdict,
        gpt6_justification: posthoc.examples?.find((x) =>
          x.review_id === c.review_id && x.theme === c.theme_key
        )?.assessment ?? null,
        gpt6_source: posthoc.label_source,
      };
    }),
    matrix = Object.fromEntries(
      ["supported", "unsupported", "uncertain"].map(
        (verdict) => [
          verdict,
          Object.fromEntries(statuses.map((s) => [
            s,
            diagnostic.filter((c) =>
              c.gpt6_verdict === verdict && c.status === s
            ).length,
          ])),
        ],
      ),
    ),
    recommendations = PILOT_AXES.map((a) =>
      v3Recommendation(selected, checks, a)
    ),
    assessed = checks.filter((c) =>
      c.reason !== "RESERVED_NEW_CONTROL_NOT_EVALUATED"
    );
  return {
    version: V3_VERSION,
    verifier: V3_VERIFIER,
    rule_sha256: await v3PipelineHash(),
    engine_rule_sha256: await v3RuleHash(),
    baseline_counts: base.result.summary,
    base_audit_id: base.id,
    base_result_sha256: base.result_sha256,
    snapshot_id: snapshot.id,
    source_sha256: snapshot.source_sha256,
    posthoc_sha256: posthocSha,
    control_sha256: control.sha,
    checks,
    selected,
    recommendations,
    diagnostic,
    diagnostic_matrix: matrix,
    diagnostic_segments: Object.fromEntries(
      [...new Set(diagnostic.map((c) => c.segment))].map(
        (segment) => [
          segment,
          Object.fromEntries(statuses.map((s) => [
            s,
            diagnostic.filter((c) => c.segment === segment && c.status === s)
              .length,
          ])),
        ],
      ),
    ),
    comparison: Object.fromEntries(
      statuses.map(
        (old) => [
          old,
          Object.fromEntries(statuses.map((s) => [
            s,
            assessed.filter((c) => c.v21_status === old && c.status === s)
              .length,
          ])),
        ],
      ),
    ),
    summary: {
      jev_reviews: base.result.summary.jev_reviews,
      jev_findings: checks.length,
      assessed: assessed.length,
      reserved: checks.length - assessed.length,
      supported: checks.filter((c) => c.status === "supported_by_rule").length,
      unsupported:
        checks.filter((c) => c.status === "unsupported_by_rule").length,
      review_needed: checks.filter((c) => c.status === "review_needed").length,
      selected: selected.length,
      grounded_recommendations:
        recommendations.filter((r) => r.status === "grounded_by_rules").length,
      recovered: assessed.filter((c) =>
        c.v21_status !== "supported_by_rule" &&
        c.status === "supported_by_rule"
      ).length,
      old_supported_not_retained:
        assessed.filter((c) =>
          c.v21_status === "supported_by_rule" &&
          c.status !== "supported_by_rule"
        ).length,
    },
    theme_coverage: THEME_KEYS.map((theme) => ({
      theme,
      jev: checks.filter((c) => c.theme_key === theme).length,
      assessed: assessed.filter((c) => c.theme_key === theme).length,
      supported:
        checks.filter((c) =>
          c.theme_key === theme && c.status === "supported_by_rule"
        ).length,
    })),
    statistics: base.result.statistics,
    health_flags: [...graphs].filter(([, g]) =>
      g.flags.includes("CUSTOMER_REPORTED_HEALTH_SIGNAL_NO_CAUSALITY")
    ).map(([id]) => ({
      review_id: id,
      kind: "customer_reported_symptoms_no_causality_inferred",
    })),
    provenance:
      "structured_deterministic_check_not_semantic_ai_not_human_validation",
    limits: [
      "Bounded English entity/predicate grammar; incomplete semantic understanding.",
      "Unknown, implicit and ambiguous expressions remain review_needed.",
      "199 GPT-6 labels are posthoc diagnostic judgments, not independent Gold or global precision.",
      "40 reserved reviews are not evaluated by this rule version.",
    ],
    new_paid_calls: 0,
    human_validated: false,
    ai_verified: false,
    production_enabled: false,
    semantic_paid_enabled: false,
  };
}
export type V3Audit = Awaited<ReturnType<typeof buildV3Audit>>;
export async function verifyV3Audit(
  snapshot: PilotSnapshot,
  base: V3Base,
  a: V3Audit,
  sha: string,
  controlSha: string,
) {
  await verifyPilotSnapshot(snapshot);
  if (
    await v3Hash(a) !== sha || await v3PipelineHash() !== a.rule_sha256 ||
    await evidenceV21AuditHash(base.result) !== base.result_sha256 ||
    base.id !== a.base_audit_id ||
    base.result_sha256 !== a.base_result_sha256 ||
    a.source_sha256 !== snapshot.source_sha256 ||
    controlSha !== a.control_sha256
  ) throw new Error("V3_AUDIT_CHANGED");
  for (const p of a.checks) {
    const r = snapshot.source.reviews.find((r) => r.id === p.review_id),
      old = base.result.checks.find((c) => c.binding_id === p.v21_binding_id);
    if (
      !r?.analysis_text || !old || old.review_id !== p.review_id ||
      old.theme_key !== p.theme_key || old.polarity !== p.polarity ||
      old.cache_response_sha256 !== p.cache_response_sha256 ||
      r.analysis_text !== p.analysis_text ||
      await negativeHash(r.analysis_text) !== p.analysis_text_sha256
    ) throw new Error("V3_PREDICTION_CHANGED");
    if (
      p.statement &&
      (r.analysis_text.slice(p.statement.start, p.statement.end) !==
          p.statement.quote ||
        await negativeHash(p.statement.quote) !== p.quote_sha256 ||
        verifyGraphV3(parseReviewV3(p.statement.quote), p.theme_key, p.polarity)
            .status !== "supported_by_rule")
    ) throw new Error("V3_QUOTE_CHANGED");
  }
  for (const p of a.selected) {
    if (
      canonicalJson(p) !==
        canonicalJson(a.checks.find((c) => c.binding_id === p.binding_id)) ||
      p.status !== "supported_by_rule" || !p.statement?.actionable
    ) throw new Error("V3_SELECTED_CHANGED");
  }
  if (
    canonicalJson(a.recommendations) !==
      canonicalJson(
        PILOT_AXES.map((axis) => v3Recommendation(a.selected, a.checks, axis)),
      )
  ) throw new Error("V3_RECOMMENDATION_CHANGED");
}
export type V3ExactStatement = Statement;
