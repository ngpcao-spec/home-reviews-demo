import {useI18n} from "../../i18n";
import {PrioritizedJlsReport} from "./PrioritizedJlsReport";
import {JlsRecommendationReview,type RecommendationReviewView} from "./JlsRecommendationReview";
import {JlsContractV2Report} from "./JlsContractV2Report";
import type {ContractReportView} from "../../../supabase/functions/_shared/jls-contract-v2-view";
import {supabase} from "../../lib/supabase";
import {useState} from "react";
import type {validateEditorialReport} from "../../../supabase/functions/_shared/jls-editorial-validation";
import type {SavedResponseView} from "../../../supabase/functions/_shared/jls-saved-response-view";
export interface RestaurantView {
 saved_response_validation?:SavedResponseView|null;
 frozen_source?:{establishment_id:string;historical_run_id:string;source_fingerprint:string;source_ids:string[];statistics_denominators:{overall:number;thematic:number};no_paid_go:boolean;immutable_historical_report:boolean};
 contract_v2?:ContractReportView;history_available?:boolean;
 recommendation_review?:RecommendationReviewView|null;
 protocol:null|{id:string;sha256:string;created_at:string;establishment_name:string;source_sha256:string;configuration_sha256:string;
  coverage:{google_total:number|null;stored_reviews:number;reviews_with_text:number;english_ready:number;reused_analyses:number;missing_analyses:number;missing_english:number};
  sol_preflight?:null|{request_bytes:number;local_input_tokens:number;guarded_input_tokens:number;input_budget_tokens:number;output_reserved_tokens:number;input_headroom_tokens:number};
  source_run_id?:string|null;prepared_artifact_sha256?:string|null;sol_final_request_ready?:boolean;reused_luna_calls?:number;reused_luna_decisions?:number;
  max_jev_calls:number;max_luna_calls:number;max_sol_calls:number;language:string;format_version:string;editorial_version:string};
 historical_runs?:{id:string;status:string;stage:string;error_code:string|null}[];
 run:null|{id:string;status:string;stage:string;error_code:string|null};
 result:null|{validated_report?:Awaited<ReturnType<typeof validateEditorialReport>>;input_tokens?:number;output_tokens?:number;error_code?:string|null};
 progress:null|{id:string;phase:string;status:string;request_count:number}[];
}
export function JlsRestaurantPreparation({data}:{data:RestaurantView}) {
 const {language}=useI18n(),fr=language==="fr",p=data.protocol;
 const [auditError,setAuditError]=useState(false),[auditBusy,setAuditBusy]=useState(false);
 if(data.contract_v2)return <JlsContractV2Report value={data.contract_v2}/>;
 if(!p)return null;
 const c=p.coverage;
 const finishedJev=data.progress?.filter(t=>t.phase==="jev"&&["completed","reused"].includes(t.status))??[];
 const analysed=c.reused_analyses+finishedJev.length,reused=c.reused_analyses+finishedJev.filter(t=>t.status==="reused").length;
 return <section className="card jev-card" data-testid="jls-restaurant-preparation">
  <h2>{p.establishment_name} — {data.frozen_source?(fr?"Test complet V2":"Thử nghiệm đầy đủ V2"):(fr?"Deuxième test délégué":"Thử nghiệm ủy quyền thứ hai")}</h2>
  {data.frozen_source&&<aside className="jls-methodology" data-testid="jls-frozen-source">
   <h3>{fr?"Même snapshot historique — contrat V2":"Cùng dữ liệu gốc — hợp đồng V2"}</h3>
   <p>{fr?"100 avis figés : 80 avis avec texte à analyser et 20 avis sans texte conservés pour les statistiques. Les fréquences des thèmes utilisent 80, les statistiques globales utilisent 100.":"Cố định 100 đánh giá: 80 đánh giá có nội dung để phân tích và 20 đánh giá không có nội dung chỉ dùng cho thống kê. Tần suất chủ đề dùng 80, thống kê tổng thể dùng 100."}</p>
   <p>{fr?"Dossiers préparés hors du chemin Edge par Codex entre les étapes serveur persistantes. Aucun appel ni audit qualitatif depuis cet écran.":"Codex chuẩn bị hồ sơ ngoài đường xử lý Edge giữa các bước máy chủ bền vững. Màn hình này không gọi mô hình hay đánh giá chất lượng."}</p>
   <p className="evidence-id" style={{overflowWrap:"anywhere"}}>{data.frozen_source.historical_run_id}<br/>{data.frozen_source.source_fingerprint}</p>
   {auditError&&<p role="alert">{fr?"Export indisponible. Le rapport reste conservé ; aucun appel IA n’a été lancé.":"Chưa xuất được dữ liệu. Báo cáo vẫn được giữ; chưa gọi thêm AI."}</p>}
   <button disabled={auditBusy} className="secondary-button full-width" onClick={async()=>{setAuditError(false);setAuditBusy(true);try{
    if(!supabase)throw Error("UNAUTHORIZED");const response=await supabase.functions.invoke("jls-restaurant?"+new URLSearchParams({establishment_id:data.frozen_source!.establishment_id,view:"audit"}),{method:"GET"});
    if(response.error||response.data?.error)throw Error("JLS_EXPORT_FAILED");const url=URL.createObjectURL(new Blob([JSON.stringify(response.data,null,2)],{type:"application/json"}));
    const a=document.createElement("a");a.href=url;a.download="chill-thai-snapshot-v2-audit.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   }catch{setAuditError(true);}finally{setAuditBusy(false);}}}>{fr?"Exporter les données pour notre audit":"Xuất dữ liệu để đánh giá"}</button>
  </aside>}
  <p>{data.frozen_source&&data.run?(fr?"Exécution autorisée enregistrée. Périmètre figé ; historique conservé.":"Đã ghi nhận lần chạy được cho phép. Phạm vi cố định; giữ nguyên lịch sử."):(fr?"Rapport vietnamien. Périmètre figé ; préparation sans autorisation d’exécution.":"Báo cáo tiếng Việt. Phạm vi cố định; việc chuẩn bị không cấp phép thực thi.")}</p>
  <dl className="jev-pairs">{[
   ["Google Maps",c.google_total],[fr?"Avis stockés":"Đánh giá đã lưu",c.stored_reviews],
   [fr?"Avis avec texte":"Đánh giá có nội dung",c.reviews_with_text],
   [fr?"Textes anglais prêts":"Nội dung tiếng Anh sẵn sàng",c.english_ready],
   ...(data.frozen_source?[[fr?"Avis analysés":"Đánh giá đã phân tích",analysed]]:[]),
   [fr?"Analyses réutilisables":"Phân tích có thể dùng lại",data.frozen_source?reused:c.reused_analyses],
   [fr?"Analyses manquantes":"Phân tích còn thiếu",data.frozen_source?Math.max(0,c.english_ready-analysed):c.missing_analyses],
   [fr?"Textes sans anglais":"Nội dung chưa có tiếng Anh",c.missing_english],
  ].map(([label,n])=><div className="jls-status-pair" key={String(label)}><dt>{label}</dt><dd>{n}</dd></div>)}</dl>
  <p>{fr?"Couverture partielle : seuls les textes anglais figés pourront être analysés. Aucun import ni traduction automatique.":"Phạm vi chưa đầy đủ: chỉ phân tích nội dung tiếng Anh đã cố định. Không tự nhập hay dịch thêm."}</p>
  <p>{fr?"Limites de la future exécution":"Giới hạn lần thực thi tương lai"} : JEV {p.max_jev_calls} · Luna {p.max_luna_calls} · Sol {p.max_sol_calls}.</p>
  <p>{p.sol_final_request_ready?(fr?"Analyses JEV et décisions Luna réutilisées. Requête Sol finale figée ; réception et validation dans deux étapes durables, sans relance payante.":"Dùng lại phân tích JEV và quyết định Luna. Đã cố định yêu cầu Sol cuối; nhận phản hồi và kiểm tra ở hai bước bền vững, không gọi lại có tính phí."):(fr?"Questions Luna regroupées par avis. Aucune relance payante ; un contrôle des preuves peut bloquer Sol.":"Câu hỏi Luna gộp theo đánh giá. Không gọi lại có tính phí; kiểm tra bằng chứng có thể chặn Sol.")}</p>
  {p.sol_final_request_ready&&<p data-testid="jls-sol-only-ready">{fr?"Réponses Luna réutilisées":"Phản hồi Luna được dùng lại"} : {p.reused_luna_calls} · {fr?"Décisions conservées":"Quyết định được giữ lại"} : {p.reused_luna_decisions}. {fr?"Un nouvel appel Sol maximum, après un GO distinct.":"Tối đa một lần gọi Sol mới, sau khi được cho phép riêng."}</p>}
  {p.prepared_artifact_sha256&&!p.sol_final_request_ready&&<p>{fr?"Artefacts déterministes figés. Vérification des empreintes à chaque réveil ; préparation Sol dans une étape serveur distincte. Nouveau GO requis.":"Đã cố định dữ liệu chuẩn bị tất định. Kiểm tra dấu vân tay mỗi lần đánh thức; chuẩn bị Sol trong bước máy chủ riêng. Cần cho phép mới."}</p>}
  {p.sol_preflight&&<div data-testid="jls-sol-size"><h3>{fr?"Dossier Sol complet — contrôle de taille":"Hồ sơ Sol đầy đủ — kiểm tra kích thước"}</h3>
   <p>{p.sol_final_request_ready?(fr?"Mesure de la requête finale avec les preuves ACCEPTED sauvegardées. Les citations, contextes et empreintes restent contrôlés avant l’envoi.":"Đã đo yêu cầu cuối cùng với bằng chứng ACCEPTED đã lưu. Kiểm tra trích dẫn, ngữ cảnh và dấu vân tay trước khi gửi."):(fr?"Mesure conditionnelle avant Luna, avec toutes les citations. Le dossier accepté sera contrôlé à nouveau avant Sol.":"Đo có điều kiện trước Luna, gồm toàn bộ trích dẫn. Hồ sơ được chấp nhận sẽ được kiểm tra lại trước Sol.")}</p>
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
  {data.run&&<p>{fr?"Étape serveur":"Bước máy chủ"} : {({jev:p.prepared_artifact_sha256?(fr?"Vérification des artefacts figés":"Kiểm tra dữ liệu đã cố định"):(fr?"Analyses JEV":"Phân tích JEV"),prepare_evidence:fr?"Préparation gratuite des preuves":"Chuẩn bị bằng chứng miễn phí",luna:fr?"Vérification Luna":"Kiểm tra Luna",prepare_sol:fr?"Préparation gratuite du dossier Sol":"Chuẩn bị hồ sơ Sol miễn phí",sol:fr?"Rapport Sol":"Báo cáo Sol",validate_sol:fr?"Validation de la réponse Sol déjà sauvegardée":"Kiểm tra phản hồi Sol đã lưu"} as Record<string,string>)[data.run.stage]}</p>}
  <p>{data.run?data.run.status:fr?"Prêt — aucun GO enregistré":"Sẵn sàng — chưa ghi nhận cho phép chạy"}</p>
  {data.progress&&<p>{data.progress.filter(t=>["completed","reused"].includes(t.status)).length} / {data.progress.length}</p>}
  {data.run?.error_code&&<p role="alert">{data.run.error_code}</p>}
  <button disabled className="primary-button full-width">{data.frozen_source&&data.run?(fr?"Exécution enregistrée — aucun nouveau lancement":"Đã ghi nhận lần chạy — không chạy lại"):(fr?"Exécution déléguée — GO explicite requis":"Thực thi ủy quyền — cần cho phép rõ ràng")}</button>
  <details><summary>{fr?"Provenance du protocole":"Nguồn gốc giao thức"}</summary><p className="evidence-id" style={{overflowWrap:"anywhere"}}>{p.id}<br/>{p.sha256}<br/>{p.source_sha256}<br/>{p.configuration_sha256}<br/>{p.format_version}<br/>{p.editorial_version}<br/>{p.prepared_artifact_sha256}</p></details>
  {data.result?.validated_report&&<PrioritizedJlsReport result={data.result.validated_report}/>}
  {data.saved_response_validation&&<section data-testid="jls-saved-response">
   <h3>{fr?"Rapport issu de la réponse Sol conservée":"Báo cáo từ phản hồi Sol đã lưu"}</h3>
   <p>{fr?"Vérification rejouée hors réseau, sans nouvel appel fournisseur. Le run historique reste bloqué après l’erreur de sauvegarde. Cette revalidation est conservée séparément ; elle ne constitue pas une validation humaine.":"Kiểm tra lại ngoại tuyến, không gọi thêm nhà cung cấp. Lần chạy gốc vẫn bị chặn sau lỗi lưu kết quả. Bản kiểm tra lại được lưu riêng; đây không phải xác nhận của con người."}</p>
   <p>{fr?"État de la revalidation":"Trạng thái kiểm tra lại"} : {data.saved_response_validation.validation_status}. {fr?"Modèle servi":"Mô hình thực tế"} : {data.saved_response_validation.result.served_model}.</p>
   <details><summary>{fr?"Provenance de la revalidation":"Nguồn gốc bản kiểm tra lại"}</summary><p style={{overflowWrap:"anywhere"}}>{data.saved_response_validation.id}<br/>{data.saved_response_validation.sha256}<br/>{data.saved_response_validation.source_receipt_sha256}<br/>{data.saved_response_validation.validator_version}<br/>{data.saved_response_validation.validator_code_provenance}</p></details>
   <PrioritizedJlsReport result={data.saved_response_validation.result.validated_report}/>
  </section>}
  {data.recommendation_review&&<JlsRecommendationReview value={data.recommendation_review}/>}
 </section>;
}
