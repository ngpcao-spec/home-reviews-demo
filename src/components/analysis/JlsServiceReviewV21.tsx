import {useI18n} from "../../i18n";
import {PrioritizedJlsReport} from "./PrioritizedJlsReport";
import type {ServiceReviewView} from "../../../supabase/functions/_shared/jls-service-review-v21";
export function JlsServiceReviewV21({value:v}:{value:ServiceReviewView}){
 const {language}=useI18n(),fr=language==="fr";
 return <section className="card jev-card" data-testid="jls-service-review-v21" style={{overflowWrap:"anywhere",minWidth:0}}>
  <h3>{fr?"Réexamen V2.1 — contenu Sol inchangé":"Kiểm tra lại V2.1 — giữ nguyên nội dung Sol"}</h3>
  <p>{fr?"Nouvelles règles expérimentales de confirmation de réservation et de délai des boissons. La réponse Sol, les verdicts Luna et les résultats historiques restent inchangés. Aucun nouveau rapport n’a été généré.":"Quy tắc thử nghiệm mới về xác nhận đặt chỗ và thời gian chờ đồ uống. Phản hồi Sol, kết quả Luna và lịch sử được giữ nguyên. Không tạo báo cáo mới."}</p>
  {v.changes.map(c=><div key={c.index}><h4>{c.rank}. {c.title}</h4><p>{c.old_status} → {c.new_status}</p>
   <p>{c.new_visible?(fr?"Contrôles techniques passés ; proposition à examiner.":"Đạt kiểm tra kỹ thuật; đề xuất cần xem xét."):(fr?"Toujours masquée":"Vẫn bị ẩn")}</p>
   {!!c.reasons.length&&<p className="evidence-id">{c.reasons.join(" · ")}</p>}</div>)}
  {v.missing_beverage_wait_proof&&<p role="note">{fr?"Boissons : aucune preuve négative wait_time ACCEPTED compatible dans le dossier actuel. Le verdict drinks ne se transfère pas. Il faudrait faire vérifier la nouvelle citation sous wait_time, puis préparer un nouveau rapport après un GO distinct.":"Đồ uống: hồ sơ hiện tại chưa có bằng chứng wait_time tiêu cực tương thích được ACCEPTED. Không chuyển kết quả drinks sang chủ đề khác. Cần xác minh trích dẫn mới theo wait_time, rồi chuẩn bị báo cáo mới sau khi được cho phép riêng."}</p>}
  <details><summary>{fr?"Citations candidates — non vérifiées par Luna":"Trích dẫn ứng viên — Luna chưa xác minh"}</summary>
   {v.candidates.map(e=><div key={e.evidence_id}><blockquote lang="en">{e.quote}</blockquote><p>{e.context}</p><p className="evidence-id">{e.review_id}<br/>{e.theme_key} · {e.polarity}<br/>{e.quote_sha256}</p></div>)}
  </details>
  <details><summary>{fr?"Rapport sous la nouvelle validation — sans réécriture":"Báo cáo theo kiểm tra mới — không viết lại"}</summary><PrioritizedJlsReport result={v.validation}/></details>
  <details><summary>{fr?"Provenance du réexamen V2.1":"Nguồn gốc kiểm tra lại V2.1"}</summary><p className="evidence-id">analysis_jls_snapshot_preparations<br/>{v.id}<br/>{v.sha256}<br/>{v.version}<br/>{v.code_provenance}<br/>{v.source_saved_validation_id}<br/>{v.future_preparation.contract}<br/>{v.future_preparation.prompt_sha256}</p></details>
  <p>{fr?"Contrôles déterministes limités, aucune garantie de vérité sémantique ni validation humaine indépendante.":"Kiểm tra tất định có giới hạn, không bảo đảm ý nghĩa hoàn toàn đúng và không phải xác nhận độc lập của con người."}</p>
 </section>;
}
