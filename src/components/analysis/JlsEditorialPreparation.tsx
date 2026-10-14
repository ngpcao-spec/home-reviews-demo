import {useI18n} from "../../i18n";
import type {EditorialDraft} from "../../../supabase/functions/_shared/jls-prioritized-editorial";
import {GOLD_TAXONOMY} from "../../../supabase/functions/_shared/gold-taxonomy";
export function JlsEditorialPreparation({draft}:{draft:EditorialDraft}) {
 const {language}=useI18n(),fr=language==="fr",gaps=draft.coverage.filter(c=>c.coverage_status==="missing_accepted_evidence");
 const cost=draft.estimates.estimated_cost_usd;
 return <section className="card jev-card jls-prioritized" data-testid="editorial-preparation">
  <h3>{fr?"Nouvelles consignes — générations futures uniquement":"Hướng dẫn mới — chỉ cho báo cáo tương lai"}</h3>
  <p>{fr?"Le rapport enregistré et sa revalidation restent inchangés. Aucun rapport n’est généré par cette préparation.":"Báo cáo đã lưu và kết quả kiểm tra lại được giữ nguyên. Phần chuẩn bị này không tạo báo cáo."}</p>
  <p>{fr?"Préserver le plat et ses ingrédients. Expliquer les priorités simplement, en tenant compte de la fréquence du thème, de la gravité du signal, de la précision des citations et des actions possibles.":"Giữ đúng món ăn và nguyên liệu. Giải thích ưu tiên bằng ngôn ngữ đơn giản, cân nhắc tần suất chủ đề, mức độ nghiêm trọng của phản ánh, độ cụ thể của trích dẫn và hành động có thể xem xét."}</p>
  <p>{fr?"Des plaintes sur l’attente ne prouvent pas qu’un incident précis se répète. Une critique de prix ne commande pas automatiquement une baisse. Moins de trois propositions reste possible.":"Những phản ánh về thời gian chờ không chứng minh một sự việc cụ thể lặp lại. Phàn nàn về giá không tự dẫn đến đề xuất giảm giá. Có thể đưa ra ít hơn ba đề xuất."}</p>
  <p>{fr?"Citations admissibles":"Trích dẫn đủ điều kiện"} : {draft.accepted_ids.length}. {fr?"Thèmes négatifs sans citation admissible":"Chủ đề tiêu cực chưa có trích dẫn đủ điều kiện"} : {gaps.length}.</p>
  {!!gaps.length&&<aside className="jls-methodology"><p>{fr?"Limite de couverture : ces thèmes détectés ne disposent pas de preuve admissible dans le dossier. Aucune nouvelle preuve n’est ajoutée et aucune fréquence n’est déduite du nombre d’exemples.":"Giới hạn bao phủ: các chủ đề đã phát hiện này chưa có bằng chứng đủ điều kiện trong hồ sơ. Không thêm bằng chứng mới và không suy ra tần suất từ số ví dụ."}</p><p>{gaps.map(c=>GOLD_TAXONOMY[c.theme_key][language]).join(" · ")}</p></aside>}
  <details><summary>{fr?"Couverture des critiques — tous les thèmes":"Bao phủ phản ánh tiêu cực — tất cả chủ đề"}</summary>
   {[...draft.coverage].sort((a,b)=>b.negative_reviews-a.negative_reviews||a.theme_key.localeCompare(b.theme_key)).map(c=><article className="evidence-proof" key={c.theme_key}><h4>{GOLD_TAXONOMY[c.theme_key][language]}</h4>
    <p>{fr?"Avis concernés par le thème":"Đánh giá liên quan đến chủ đề"} : {c.negative_reviews} / {c.denominator} · {c.negative_mentions} {fr?"mentions":"lần đề cập"}</p>
    <p>{fr?"Avis avec preuve admissible dans ce dossier":"Đánh giá có bằng chứng đủ điều kiện trong hồ sơ"} : {c.accepted_negative_reviews}</p>
    {!c.frequency_reliable&&<p>{fr?"Fréquence non fiable — ne pas extrapoler":"Tần suất chưa đáng tin — không suy rộng"}</p>}
   </article>)}
  </details>
  <aside className="jls-methodology"><h4>{fr?"Exemple synthétique — aucun rapport généré":"Ví dụ giả lập — chưa tạo báo cáo"}</h4>
   <blockquote lang="en">an omelet with salted fish</blockquote><p lang="vi">trứng chiên với cá muối</p>
   <p>{fr?"Un avis décrit une longue attente. Vérifier le suivi de cette commande paraît utile ; ce témoignage ne démontre pas une répétition dans cette zone.":"Một đánh giá kể về việc chờ lâu. Có thể kiểm tra quá trình theo dõi đơn đó; lời kể này không chứng minh sự việc lặp lại tại khu vực này."}</p>
  </aside>
  <dl className="jev-pairs"><dt>{fr?"Entrée estimée":"Ước tính đầu vào"}</dt><dd>{draft.estimates.estimated_input_tokens}</dd>
   <dt>{fr?"Coût futur estimé":"Chi phí tương lai ước tính"}</dt><dd>{cost===null?"—":cost.toFixed(6)+" USD"}</dd></dl>
  <p>{fr?"Estimation locale, pas une facture. Les contrôles déterministes ne garantissent pas toute la fidélité d’une traduction libre.":"Ước tính cục bộ, không phải hóa đơn. Kiểm tra tất định không bảo đảm toàn bộ độ trung thực của bản dịch tự do."}</p>
  <button className="primary-button full-width" disabled>{fr?"Futur essai — nouveau GO distinct requis":"Thử nghiệm tương lai — cần cho phép riêng mới"}</button>
  <details><summary>{fr?"Audit technique — version, empreintes et dossier futur":"Kiểm tra kỹ thuật — phiên bản, mã băm và hồ sơ tương lai"}</summary><pre>{JSON.stringify({version:draft.version,config:draft.config,config_sha256:draft.config_sha256,prompt_sha256:draft.prompt_sha256,schema_sha256:draft.schema_sha256,request_sha256:draft.request_sha256,dossier_sha256:draft.dossier_sha256,coverage:draft.coverage,request:draft.request},null,2)}</pre></details>
 </section>;
}
