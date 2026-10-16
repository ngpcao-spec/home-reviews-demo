import {useI18n} from "../../i18n";
import type {RecommendationReview} from "../../../supabase/functions/_shared/jls-recommendation-review-v2";
import {PrioritizedJlsReport} from "./PrioritizedJlsReport";
export interface RecommendationReviewView {id:string;sha256:string;created_at:string;body:RecommendationReview["body"]}
export function JlsRecommendationReview({value}:{value:RecommendationReviewView}){
 const {language}=useI18n(),fr=language==="fr",b=value.body;
 const original=b.original_revalidation.validation.report.recommendations,derived=b.derivative.validation.report.recommendations;
 return <section className="card jev-card" data-testid="jls-recommendation-review">
  <h3>{fr?"Contrat de recommandations V2 — examen gratuit":"Quy tắc khuyến nghị V2 — xem xét miễn phí"}</h3>
  <p>{fr?"La réponse Sol et le statut du run restent inchangés. Aucun appel fournisseur ni nouvelle autorisation.":"Giữ nguyên phản hồi Sol và trạng thái lần chạy. Không gọi nhà cung cấp hay cấp phép mới."}</p>
  <p>{fr?"Contenu original rejoué sans modification":"Kiểm tra lại nội dung gốc, không sửa đổi"} : {original.filter(x=>x.visible).length} / {original.length}.</p>
  <p>{fr?"Version structurée dérivée, distincte de Sol":"Bản chỉnh cấu trúc, tách biệt với phản hồi Sol"} : {derived.filter(x=>x.visible).length} / {derived.length}.</p>
  <p>{fr?"Les contrôles techniques ne sont ni une validation humaine ni une garantie de vérité sémantique.":"Kiểm tra kỹ thuật không phải xác nhận của con người hay bảo đảm đúng về ngữ nghĩa."}</p>
  <details><summary>{fr?"Revalidation du contenu Sol original":"Kiểm tra lại nội dung Sol gốc"}</summary>
   {original.map((x,i)=><p key={i}>{i+1}. {x.title} — {x.reasons.join(" · ")}</p>)}
  </details>
  <details data-testid="jls-derived-report"><summary>{fr?"Consulter la version structurée dérivée — pas une nouvelle réponse Sol":"Xem bản chỉnh cấu trúc — không phải phản hồi Sol mới"}</summary>
   <p>{fr?"Les textes, citations, thèmes et verdicts Luna sont conservés. Seuls le focus température et les rôles des fréquences changent ; les modifications sont tracées.":"Giữ nguyên văn bản, trích dẫn, chủ đề và quyết định Luna. Chỉ đổi phạm vi nhiệt độ và vai trò tần suất; mọi thay đổi được ghi lại."}</p>
   <PrioritizedJlsReport result={b.derivative.validation}/>
   <details><summary>{fr?"Modifications structurées exactes":"Các thay đổi cấu trúc chính xác"}</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify(b.derivative.changes,null,2)}</pre></details>
  </details>
  <h4>{fr?"Nouvelles citations candidates — aucun verdict Luna":"Trích dẫn ứng viên mới — chưa có quyết định Luna"}</h4>
  <p>{fr?"Une citation plus précise n’hérite jamais du verdict de l’ancienne. La recommandation commande reste bloquée.":"Trích dẫn cụ thể hơn không kế thừa quyết định cũ. Khuyến nghị về đơn hàng vẫn bị chặn."}</p>
  {b.order_candidates.map(e=><details key={e.evidence_id}><summary>{fr?"Citation autonome proposée":"Trích dẫn độc lập được đề xuất"}</summary>
   <blockquote lang="en">{e.quote}</blockquote><p lang="en">{e.context}</p>
   <p>{fr?"Vérification Luna future requise ; aucun appel effectué.":"Cần kiểm tra Luna sau này; chưa thực hiện cuộc gọi."}</p>
   <p className="evidence-id" style={{overflowWrap:"anywhere"}}>{e.review_id}<br/>{e.evidence_id}<br/>{e.quote_sha256}</p>
  </details>)}
  <details><summary>{fr?"Préparation du futur format et provenance":"Chuẩn bị định dạng tương lai và nguồn gốc"}</summary>
   <p>{fr?"Focus température distinct de cuisson. Fréquences de soutien liées aux constats ; comparaisons globales liées au snapshot. Un nouveau protocole et un GO seront nécessaires.":"Tách nhiệt độ khỏi chế biến. Tần suất hỗ trợ gắn với nhận xét; so sánh tổng thể gắn với dữ liệu cố định. Cần giao thức và cho phép mới."}</p>
   <p className="evidence-id" style={{overflowWrap:"anywhere"}}>{value.id}<br/>{value.sha256}<br/>{b.version}<br/>{b.provenance.commit}<br/>{b.future_preparation.prompt_sha256}<br/>{b.future_preparation.schema_sha256}</p>
  </details>
 </section>;
}

