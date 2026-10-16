import {useI18n} from "../../i18n";
import {PrioritizedJlsReport} from "./PrioritizedJlsReport";
import type {ContractReportView} from "../../../supabase/functions/_shared/jls-contract-v2-view";
export function JlsContractV2Report({value:v}:{value:ContractReportView}){
 const {language}=useI18n(),fr=language==="fr";
 return <div className="jls-page" data-testid="jls-contract-v2-report">
  <section className="card jev-card">
   <h2>{v.establishment_name} — {fr?"Rapport vietnamien V2":"Báo cáo tiếng Việt V2"}</h2>
   <p role="status">{v.status==="completed"?(fr?"Terminé — contrôles techniques réussis":"Hoàn tất — kiểm tra kỹ thuật đạt"):v.status}</p>
   <p>{fr?"Rapport enregistré. La consultation ne déclenche aucun appel IA.":"Báo cáo đã lưu. Xem báo cáo không gọi thêm AI."}</p>
   {v.report&&<dl className="jev-pairs">
    <dt>{fr?"Avis analysés":"Đánh giá đã phân tích"}</dt><dd>{v.report.statistics.coverage.analysed_reviews}</dd>
    <dt>{fr?"Avis avec texte":"Đánh giá có nội dung"}</dt><dd>{v.report.statistics.coverage.reviews_with_text}</dd>
    <dt>{fr?"Avis stockés":"Đánh giá đã lưu"}</dt><dd>{v.report.statistics.coverage.stored_reviews}</dd>
   </dl>}
   <p>Luna : {v.luna_count} · Sol : {v.sol_count} · {fr?"aucune relance payante":"không gọi lại có tính phí"}.</p>
   {v.error_code&&<p role="alert">{v.error_code}</p>}
   {!v.report&&<p>{fr?"Aucun rapport validé disponible pour cette exécution. Consultez son état ; ne relancez pas les modèles.":"Lần chạy này chưa có báo cáo đã kiểm tra. Xem trạng thái; không gọi lại mô hình."}</p>}
   <details><summary>{fr?"Provenance de cette exécution":"Nguồn gốc lần thực thi"}</summary>
    <p className="evidence-id">{v.id}<br/>{v.protocol_id}<br/>{v.protocol_sha256}<br/>{v.result_sha256}</p>
    <p>{v.models.luna} · {v.models.sol}</p><pre>{JSON.stringify(v.usage,null,2)}</pre>
   </details>
  </section>
  {v.report&&<PrioritizedJlsReport result={v.report}/>}
 </div>;
}
