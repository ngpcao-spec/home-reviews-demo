import type { BalancedPlan } from "../../supabase/functions/_shared/jev-hybrid-balanced";
import { useI18n } from "../i18n";
import { hybridMessages } from "../i18n/jev-hybrid-report";
import "./HybridBalancedComparison.css";
const labels = {
  fr: {
    compare: "Comparaison gratuite V1 / V1.1", themes: "Thèmes couverts", citations: "Citations", distinct: "Avis distincts",
    low: "Critiques issues d’avis 1–3★", high: "Critiques issues d’avis 4–5★", size: "Taille du dossier JSON (octets)",
    problems: "Problèmes principaux — statistiques sur tous les avis analysés", examples: "Exemples négatifs sélectionnés", separate: "Avis distincts justificatifs",
    replacements: "Citations remplacées ou écartées", added: "Nouvelles citations", old: "Ancienne citation", next: "Nouvelle citation", removed: "Écartée du dossier automatique",
    reason: "Motif", quota: "Objectifs conditionnels et manques", none: "Objectifs de diversité atteints avec les preuves admissibles et le budget disponible.",
    ambiguity: "Formulations ambiguës", warning: "Une faute de frappe n’est pas une preuve confirmée de prix excessifs. Ces associations restent candidates à vérifier et ne remplissent pas les quotas.",
    excluded: "Autres passages non admissibles à la sélection", limits: "Présélection déterministe : elle ne comprend pas toutes les nuances. Chaque citation, même confirmée par règle, devra être vérifiée par Sol avant utilisation narrative.",
    reasons: {
      MORE_PRECISE_THEME_BOUND_EXCERPT: "Extrait plus précis rattaché au thème et à la polarité.",
      EXPLICIT_CONTESTATION_EXCLUDED: "Contestation explicite conservée et exclue.",
      NO_THEME_BOUND_ADMISSIBLE_PASSAGE: "Aucun passage admissible suffisamment rattaché à ce thème.",
      AMBIGUOUS_PRICE_DEPRIORITIZED: "Formulation de prix ambiguë, non prioritaire.",
      BALANCED_PRIORITY_DIVERSITY_AND_TOKEN_BUDGET: "Priorité aux critiques précises, équilibre des étoiles, diversité et budget.",
      one_star_concrete_criticism: "Critique précise provenant d’un avis 1★.",
      main_problem_distinct_examples: "Autre exemple distinct d’un problème principal.",
      specific_actionable_problem_not_frequency_claim: "Problème précis à vérifier, sans inférer sa fréquence.",
      axis_polarity_coverage: "Couverture d’un axe et d’une polarité disponibles.",
      low_star_conditional_target: "Diversité conditionnelle des avis 1–3★.",
      four_star_mixed_criticism: "Critique dans un avis 4★.",
      five_star_strength: "Point fort d’un avis 5★.",
      precise_diverse_secondary_example: "Exemple précis complémentaire.",
      available_evidence_despite_stratum_shortage: "Preuve disponible malgré le manque dans une strate.",
    },
  },
  vi: {
    compare: "So sánh miễn phí V1 / V1.1", themes: "Chủ đề được bao phủ", citations: "Trích dẫn", distinct: "Đánh giá khác nhau",
    low: "Phê bình từ đánh giá 1–3★", high: "Phê bình từ đánh giá 4–5★", size: "Kích thước hồ sơ JSON (byte)",
    problems: "Vấn đề chính — số liệu trên tất cả đánh giá đã phân tích", examples: "Trích dẫn tiêu cực được chọn", separate: "Đánh giá chứng minh khác nhau",
    replacements: "Trích dẫn thay thế hoặc loại bỏ", added: "Trích dẫn mới", old: "Trích dẫn cũ", next: "Trích dẫn mới", removed: "Loại khỏi hồ sơ tự động",
    reason: "Lý do", quota: "Mục tiêu có điều kiện và thiếu hụt", none: "Đạt mục tiêu đa dạng với bằng chứng phù hợp và ngân sách hiện có.",
    ambiguity: "Cách diễn đạt mơ hồ", warning: "Lỗi gõ không phải bằng chứng xác nhận giá cao. Các liên kết này vẫn cần kiểm tra và không dùng để đủ chỉ tiêu.",
    excluded: "Đoạn khác chưa phù hợp để chọn", limits: "Chọn trước theo quy tắc không hiểu mọi sắc thái. Mỗi trích dẫn, kể cả được quy tắc hỗ trợ, cần Sol kiểm tra trước khi viết báo cáo.",
    reasons: {
      MORE_PRECISE_THEME_BOUND_EXCERPT: "Đoạn chính xác hơn gắn với chủ đề và cảm xúc.",
      EXPLICIT_CONTESTATION_EXCLUDED: "Giữ nguyên phản đối rõ ràng và loại bỏ.",
      NO_THEME_BOUND_ADMISSIBLE_PASSAGE: "Không có đoạn phù hợp đủ rõ với chủ đề này.",
      AMBIGUOUS_PRICE_DEPRIORITIZED: "Diễn đạt giá mơ hồ, không ưu tiên.",
      BALANCED_PRIORITY_DIVERSITY_AND_TOKEN_BUDGET: "Ưu tiên phê bình cụ thể, cân bằng sao, đa dạng và ngân sách.",
      one_star_concrete_criticism: "Phê bình cụ thể từ đánh giá 1★.",
      main_problem_distinct_examples: "Ví dụ khác của vấn đề chính.",
      specific_actionable_problem_not_frequency_claim: "Vấn đề cụ thể cần kiểm tra, không suy ra tần suất.",
      axis_polarity_coverage: "Bao phủ trục và cảm xúc có sẵn.",
      low_star_conditional_target: "Đa dạng có điều kiện với đánh giá 1–3★.",
      four_star_mixed_criticism: "Phê bình trong đánh giá 4★.",
      five_star_strength: "Điểm mạnh từ đánh giá 5★.",
      precise_diverse_secondary_example: "Ví dụ cụ thể bổ sung.",
      available_evidence_despite_stratum_shortage: "Bằng chứng có sẵn dù thiếu một nhóm sao.",
    },
  },
} as const;
export function HybridBalancedComparison({ plan }: { plan: BalancedPlan }) {
  const { language } = useI18n(), t = hybridMessages[language], l = labels[language], a = plan.comparison.v1_summary, b = plan.selected_summary;
  const reason = (code: string) => l.reasons[code as keyof typeof l.reasons] ?? code;
  const money = (n: number | null) => n === null ? "—" : n.toLocaleString(language, {maximumFractionDigits:6}) + " USD";
  const rows = [
    [l.citations, a.total, b.total], [l.distinct, a.distinct_reviews, b.distinct_reviews], [l.themes, a.covered_themes,b.covered_themes],
    [t.confirmed,a.rule_confirmed,b.rule_confirmed], [t.candidate,a.sol_candidate,b.sol_candidate],
    [l.low,a.low_star_negative,b.low_star_negative], [l.high,a.high_star_negative,b.high_star_negative],
    [t.input,plan.comparison.v1_estimates.estimated_input_tokens,plan.estimates.estimated_input_tokens],
    [t.output,plan.comparison.v1_estimates.estimated_output_tokens,plan.estimates.estimated_output_tokens],
    [l.size,plan.comparison.v1_dossier_bytes,plan.estimates.dossier_bytes],
    [t.sol,money(plan.comparison.v1_estimates.estimated_sol_cost_usd),money(plan.estimates.estimated_sol_cost_usd)],
    [t.upper,money(plan.comparison.v1_estimates.max_sol_cost_usd),money(plan.estimates.max_sol_cost_usd)],
  ];
  return <>
    <section className="card jev-card hybrid-balanced">
      <h2>{l.compare}</h2>
      <div className="hybrid-comparison-table"><table><thead><tr><th></th><th>V1</th><th>V1.1</th></tr></thead><tbody>{rows.map(([label,x,y])=><tr key={String(label)}><th scope="row">{label}</th><td>{x}</td><td>{y}</td></tr>)}</tbody></table></div>
      <h3>{t.stars}</h3>
      {[1,2,3,4,5].map((s)=><div key={s} className="hybrid-stars"><strong>{s}★</strong><span>V1 : {a.star_distribution[s]}</span><span>V1.1 : {b.star_distribution[s]}</span><meter min={0} max={b.total || 1} value={b.star_distribution[s]} aria-label={`${s}★ V1.1`} /></div>)}
      <details><summary>{t.diversity}</summary>{Object.entries(b.by_axis_polarity).map(([k,n])=><p key={k}>{t.axes[k.split(":")[0] as keyof typeof t.axes]} · {k.endsWith("positive") ? t.positive : t.negative} : {a.by_axis_polarity[k]} → {n}</p>)}</details>
      <p>{t.contested} : {plan.evidence_pool.explicitly_contested} · {l.excluded} : {plan.quality_exclusions.length}</p>
      <p>{t.diversityWarning}</p><p>{l.limits}</p>
    </section>
    <section className="card jev-card"><h2>{l.problems}</h2>{plan.main_problems.map((p)=><article key={p.axis}><h3>{t.axes[p.axis]}</h3><p>{p.negative_mentions} {t.mentions} · {p.negative_review_count} {t.reviews}</p><p>{l.examples} : {p.selected_negative_citations} · {l.separate} : {p.distinct_evidence_reviews}</p></article>)}<h3>{l.quota}</h3>{plan.shortages.length ? plan.shortages.map((s)=><p key={s.code}>{s.code} : {s.selected} / {s.target} · {s.admissible_distinct_reviews} {t.reviews}</p>) : <p>{l.none}</p>}</section>
    <details className="card jev-card"><summary>{l.replacements} · {plan.comparison.replaced.length}</summary>{plan.comparison.replaced.map((e)=><article className="jev-theme-detail" key={`${e.review_id}:${e.theme_key}:${e.polarity}`}><h3>{e.theme_key} · {e.polarity}</h3><p className="jev-id">{e.review_id}</p><p>{l.reason} : {reason(e.reason)}</p><p>{l.old}</p><p className="gold-text" lang="en">{e.old_quote}</p><p>{l.next}</p><p className="gold-text" lang="en">{e.new_quote ?? l.removed}</p></article>)}</details>
    <details className="card jev-card"><summary>{l.added} · {plan.comparison.added.length}</summary>{plan.comparison.added.map((e)=><article key={`${e.review_id}:${e.theme_key}:${e.polarity}`}><p>{e.theme_key} · {reason(e.reason)}</p><p className="jev-id">{e.review_id}</p><p className="gold-text" lang="en">{e.quote}</p></article>)}</details>
    <details className="card jev-card"><summary>{l.ambiguity} · {plan.ambiguity_downgrades.length}</summary><p>{l.warning}</p>{plan.ambiguity_downgrades.map((e)=><p key={`${e.review_id}:${e.theme_key}:${e.polarity}`} className="gold-text" lang="en">{e.quote} · {e.theme_key} · {e.status}</p>)}</details>
  </>;
}
