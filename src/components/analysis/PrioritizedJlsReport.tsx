import { useI18n } from "../../i18n";
import type { validatePrioritizedReport } from "../../../supabase/functions/_shared/jev-luna-sol-prioritized-validation";
import type {validateEditorialReport} from "../../../supabase/functions/_shared/jls-editorial-validation";
import {GOLD_TAXONOMY} from "../../../supabase/functions/_shared/gold-taxonomy";
type Report = Awaited<ReturnType<typeof validatePrioritizedReport>>|Awaited<ReturnType<typeof validateEditorialReport>>;
// Separate renderer; legacy report fields and rendering remain unchanged.
export function PrioritizedJlsReport({ result }: { result: Report }) {
  const { language } = useI18n(), fr = language === "fr";
  const axes: Record<string, string> = fr ? { service: "Service", quality: "Qualité", price: "Prix", atmosphere: "Ambiance" }
    : { service: "Dịch vụ", quality: "Chất lượng", price: "Giá", atmosphere: "Không gian" };
  const review = fr ? "À réexaminer" : "Cần xem lại", r = result.report,editorial="editorial_version" in result;
  return <section className="card jev-card jls-prioritized">
    <h3>{fr ? "Rapport — recommandations prioritaires" : "Báo cáo — khuyến nghị ưu tiên"}</h3>
    {editorial?<details><summary>{fr?"Audit technique du rapport":"Kiểm tra kỹ thuật báo cáo"}</summary><p className="evidence-id">{result.editorial_version}<br/>{result.format_version}<br/>{result.prompt_sha256}<br/>{result.schema_sha256}</p></details>:<p className="evidence-id">{result.format_version}</p>}
    {r.axes.map(a => <div key={a.axis}><h4>{axes[a.axis!]}</h4><p>{a.text ?? review}</p></div>)}
    {[[fr ? "Aspects positifs" : "Điểm tích cực", r.positive_aspects], [fr ? "Aspects négatifs" : "Điểm tiêu cực", r.negative_aspects]].map(([title, items]) =>
      <div key={String(title)}><h4>{String(title)}</h4>{(items as typeof r.positive_aspects).map((a, i) => <p key={i}>{a.text ?? review}</p>)}</div>)}
    <h4>{fr ? "Conclusion et priorités" : "Kết luận và ưu tiên"}</h4><p>{r.conclusion.text ?? review}</p>
    <h4>{fr ? "Recommandations proposées" : "Khuyến nghị đề xuất"}</h4>
    {!r.recommendations.length && <p>{fr ? "Preuves insuffisantes pour proposer une action précise." : "Chưa đủ bằng chứng để đề xuất hành động cụ thể."}</p>}
    {r.recommendations.map((a, i) => <article className="evidence-proof" style={{overflowWrap:"anywhere",minWidth:0}} key={i}>
      <h4>{a.priority.rank}. {a.visible ? a.title : review}</h4>
      {a.visible ? <>
        <strong>{fr ? "Ce que les clients rapportent" : "Nội dung khách hàng phản ánh"}</strong>
        {a.observations.map(o => <div key={o.evidence_id}><p>{o.text}</p><p>{o.context_summary}</p>
          <details><summary>{fr ? "Consulter la preuve et son contexte" : "Xem bằng chứng và ngữ cảnh"}</summary>
            <blockquote lang="en">{o.quote}</blockquote><p lang="en">{o.context_quote}</p>
            <p className="evidence-id">{o.evidence_id}<br />{o.theme_key} · {o.polarity}<br />{o.quote_sha256}<br />{o.context_sha256}</p>
          </details></div>)}
        <strong>{fr ? "Action proposée au restaurateur" : "Hành động đề xuất cho nhà hàng"}</strong><p>{a.proposed_action.text}</p>
        <p>{fr ? "Proposition à examiner ; efficacité non établie par les avis." : "Đề xuất cần xem xét; đánh giá chưa chứng minh hiệu quả."}</p>
        <strong>{fr ? "Pourquoi cette priorité" : "Lý do ưu tiên"}</strong><p>{a.priority.reason}</p>
        {a.priority.basis === "isolated_signal_to_verify" && <p>{fr ? "Signal isolé à vérifier, pas un fait confirmé." : "Phản ánh riêng lẻ cần kiểm tra, không phải sự việc đã xác nhận."}</p>}
        {a.frequency.map(f => <p key={f.key}>{editorial?(GOLD_TAXONOMY[f.key.split(":")[0] as keyof typeof GOLD_TAXONOMY]?.[language]??(fr?"Thème":"Chủ đề")):f.key} — {editorial?(fr?"Avis analysés":"Đánh giá đã phân tích"):"JEV"} : {f.mentions} {fr ? "mentions" : "lần đề cập"}, {f.distinct_reviews} {fr ? "avis distincts" : "đánh giá riêng biệt"} / {f.denominator}. {fr ? "Fréquence du thème, pas de cet incident précis." : "Tần suất chủ đề, không phải sự cố cụ thể này."}</p>)}
        {a.comparison_frequency?.length?<div><strong>{fr?"Comparaison globale — contexte statistique":"So sánh tổng thể — ngữ cảnh thống kê"}</strong>
          {a.comparison_frequency.map(f=><p key={f.key}>{GOLD_TAXONOMY[f.key.split(":")[0] as keyof typeof GOLD_TAXONOMY]?.[language]} · {f.key.endsWith(":positive")?(fr?"positif":"tích cực"):(fr?"négatif":"tiêu cực")} : {f.distinct_reviews} / {f.denominator}. {fr?"Comptage du thème sur le périmètre figé ; ne prouve pas cet incident.":"Số đếm chủ đề trong phạm vi cố định; không chứng minh sự cố này."}</p>)}
        </div>:null}
        {editorial&&<details><summary>{fr?"Détails techniques de la priorité":"Chi tiết kỹ thuật về ưu tiên"}</summary><pre>{JSON.stringify({frequency:a.frequency,priority:a.priority,status:a.status},null,2)}</pre></details>}
      </> : editorial?<><p>{review}</p><details><summary>{fr?"Recommandation masquée — statut et motifs":"Khuyến nghị bị ẩn — trạng thái và lý do"}</summary>
        <p>{fr?"Texte original conservé pour examen ; proposition non validée.":"Nội dung gốc được giữ để xem xét; đề xuất chưa được xác nhận."}</p>
        <p>{a.title}</p><p>{a.proposed_action.text}</p><p className="evidence-id">{a.status} · {a.reasons.join(" · ")}</p>
        {a.observations.map(o=><div key={o.evidence_id}><blockquote lang="en">{o.quote}</blockquote><p lang="en">{o.context_quote}</p><p className="evidence-id">{o.evidence_id} · {o.theme_key} · {o.polarity}</p></div>)}
      </details></>:<p>{review} · {a.reasons.join(" · ")}</p>}
    </article>)}
    <aside className="jls-methodology"><h4>{fr ? "Note méthodologique" : "Ghi chú phương pháp"}</h4><p>{result.methodology_note}</p></aside>
  </section>;
}
