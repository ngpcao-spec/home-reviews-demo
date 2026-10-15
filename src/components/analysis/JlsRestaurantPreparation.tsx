import {useI18n} from "../../i18n";
import {PrioritizedJlsReport} from "./PrioritizedJlsReport";
import type {validateEditorialReport} from "../../../supabase/functions/_shared/jls-editorial-validation";
export interface RestaurantView {
 protocol:null|{id:string;sha256:string;created_at:string;establishment_name:string;source_sha256:string;configuration_sha256:string;
  coverage:{google_total:number|null;stored_reviews:number;reviews_with_text:number;english_ready:number;reused_analyses:number;missing_analyses:number;missing_english:number};
  sol_preflight?:null|{request_bytes:number;local_input_tokens:number;guarded_input_tokens:number;input_budget_tokens:number;output_reserved_tokens:number;input_headroom_tokens:number};
  source_run_id?:string|null;
  max_jev_calls:number;max_luna_calls:number;max_sol_calls:number;language:string;format_version:string;editorial_version:string};
 historical_runs?:{id:string;status:string;stage:string;error_code:string|null}[];
 run:null|{id:string;status:string;stage:string;error_code:string|null};
 result:null|{validated_report?:Awaited<ReturnType<typeof validateEditorialReport>>;input_tokens?:number;output_tokens?:number;error_code?:string|null};
 progress:null|{id:string;phase:string;status:string;request_count:number}[];
}
export function JlsRestaurantPreparation({data}:{data:RestaurantView}) {
 const {language}=useI18n(),fr=language==="fr",p=data.protocol;if(!p)return null;
 const c=p.coverage;
 return <section className="card jev-card" data-testid="jls-restaurant-preparation">
  <h2>{p.establishment_name} — {fr?"Deuxième test délégué":"Thử nghiệm ủy quyền thứ hai"}</h2>
  <p>{fr?"Rapport vietnamien. Périmètre figé ; préparation sans autorisation d’exécution.":"Báo cáo tiếng Việt. Phạm vi cố định; việc chuẩn bị không cấp phép thực thi."}</p>
  <dl className="jev-pairs">{[
   ["Google Maps",c.google_total],[fr?"Avis stockés":"Đánh giá đã lưu",c.stored_reviews],
   [fr?"Avis avec texte":"Đánh giá có nội dung",c.reviews_with_text],
   [fr?"Textes anglais prêts":"Nội dung tiếng Anh sẵn sàng",c.english_ready],
   [fr?"Analyses réutilisables":"Phân tích có thể dùng lại",c.reused_analyses],
   [fr?"Analyses manquantes":"Phân tích còn thiếu",c.missing_analyses],
   [fr?"Textes sans anglais":"Nội dung chưa có tiếng Anh",c.missing_english],
  ].map(([label,n])=><div className="jls-status-pair" key={String(label)}><dt>{label}</dt><dd>{n}</dd></div>)}</dl>
  <p>{fr?"Couverture partielle : seuls les textes anglais figés pourront être analysés. Aucun import ni traduction automatique.":"Phạm vi chưa đầy đủ: chỉ phân tích nội dung tiếng Anh đã cố định. Không tự nhập hay dịch thêm."}</p>
  <p>{fr?"Limites de la future exécution":"Giới hạn lần thực thi tương lai"} : JEV {p.max_jev_calls} · Luna {p.max_luna_calls} · Sol {p.max_sol_calls}.</p>
  <p>{fr?"Questions Luna regroupées par avis. Aucune relance payante ; un contrôle des preuves peut bloquer Sol.":"Câu hỏi Luna gộp theo đánh giá. Không gọi lại có tính phí; kiểm tra bằng chứng có thể chặn Sol."}</p>
  {p.sol_preflight&&<div data-testid="jls-sol-size"><h3>{fr?"Dossier Sol complet — contrôle de taille":"Hồ sơ Sol đầy đủ — kiểm tra kích thước"}</h3>
   <p>{fr?"Mesure conditionnelle avant Luna, avec toutes les citations. Le dossier accepté sera contrôlé à nouveau avant Sol.":"Đo có điều kiện trước Luna, gồm toàn bộ trích dẫn. Hồ sơ được chấp nhận sẽ được kiểm tra lại trước Sol."}</p>
   <dl className="jev-pairs">{[
    [fr?"Requête complète (octets)":"Yêu cầu đầy đủ (byte)",p.sol_preflight.request_bytes],
    [fr?"Tokens locaux estimés":"Token ước tính cục bộ",p.sol_preflight.local_input_tokens],
    [fr?"Entrée avec marge 12 % + 256":"Đầu vào với dự phòng 12% + 256",p.sol_preflight.guarded_input_tokens],
    [fr?"Plafond d’entrée":"Giới hạn đầu vào",p.sol_preflight.input_budget_tokens],
    [fr?"Réserve de sortie":"Dự phòng đầu ra",p.sol_preflight.output_reserved_tokens],
   ].map(([label,n])=><div className="jls-status-pair" key={String(label)}><dt>{label}</dt><dd>{n}</dd></div>)}</dl>
   <p>{fr?"Comptage local, distinct des tokens facturés. Aucun appel fournisseur effectué pour cette préparation.":"Số đếm cục bộ, khác token tính phí. Việc chuẩn bị này không gọi nhà cung cấp."}</p>
  </div>}
  {data.historical_runs?.length? <details><summary>{fr?"Exécutions historiques conservées":"Các lần thực thi cũ được giữ nguyên"}</summary>
   {data.historical_runs.map(r=><p key={r.id} style={{overflowWrap:"anywhere"}}>{r.id} · {r.status} · {r.error_code}</p>)}</details>:null}
  <p>{data.run?data.run.status:fr?"Prêt — aucun GO enregistré":"Sẵn sàng — chưa ghi nhận cho phép chạy"}</p>
  {data.progress&&<p>{data.progress.filter(t=>["completed","reused"].includes(t.status)).length} / {data.progress.length}</p>}
  {data.run?.error_code&&<p role="alert">{data.run.error_code}</p>}
  <button disabled className="primary-button full-width">{fr?"Exécution déléguée — GO explicite requis":"Thực thi ủy quyền — cần cho phép rõ ràng"}</button>
  <details><summary>{fr?"Provenance du protocole":"Nguồn gốc giao thức"}</summary><p className="evidence-id" style={{overflowWrap:"anywhere"}}>{p.id}<br/>{p.sha256}<br/>{p.source_sha256}<br/>{p.configuration_sha256}<br/>{p.format_version}<br/>{p.editorial_version}</p></details>
  {data.result?.validated_report&&<PrioritizedJlsReport result={data.result.validated_report}/>}
 </section>;
}
