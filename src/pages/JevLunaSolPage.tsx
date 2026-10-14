import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../app/AppContext";
import { useI18n } from "../i18n";
import { PageHeader } from "../components/ui/PageHeader";
import { jlsPreview, type JlsView } from "../lib/jev-luna-sol";
import { jlsMessages } from "../i18n/jev-luna-sol";
import { GOLD_TAXONOMY } from "../../supabase/functions/_shared/gold-taxonomy";
import { PrioritizedJlsReport } from "../components/analysis/PrioritizedJlsReport";
import "./JevBenchmarkPage.css";
import "./GoldSetPage.css";
import "./PilotEvidenceV3Page.css";
import "./JevLunaSolPage.css";
export function JevLunaSolPage() {
  const { currentUser, demoMode, establishments } = useApp(), { language } = useI18n(), t = jlsMessages[language];
  const [selected, setSelected] = useState("");
  const est = establishments.find(e => e.id === selected) ??
    establishments.find(e => e.id === "252a8dca-14c7-4f09-bd1f-7b2c40ae97aa") ?? establishments[0];
  const q = useQuery({ queryKey: ["jls-free-preview", currentUser.id, est?.id, language],
    enabled: !demoMode && !!currentUser.id && !!est, retry: false,
    queryFn: () => jlsPreview(est!.id, language) });
  const { refetch } = q;
  useEffect(() => {
    const read = () => { if (!document.hidden && !demoMode && est) void refetch(); };
    window.addEventListener("pageshow", read); document.addEventListener("visibilitychange", read);
    return () => { window.removeEventListener("pageshow", read); document.removeEventListener("visibilitychange", read); };
  }, [refetch, demoMode, est]);
  return <><PageHeader title={t.title} back /><div className="jev-page gold-page evidence-v3-page jls-page">
    <label htmlFor="jls-est">{language === "fr" ? "Établissement" : "Cơ sở"}</label>
    <select id="jls-est" value={est?.id ?? ""} onChange={e => setSelected(e.target.value)}>
      {establishments.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
    </select>
    {q.isFetching && <p role="status">{t.loading}</p>}
    {q.isError && <p role="alert">{t.error} : {q.error.message}</p>}
    {q.data && <JlsWorkspace data={q.data} />}
    {!est && <p>{t.empty}</p>}
    <button className="secondary-button full-width" disabled={!est || q.isFetching || demoMode} onClick={() => void q.refetch()}>{t.refresh}</button>
    <Link to="/plus/jev-benchmark">{t.back}</Link>
  </div></>;
}
export function JlsWorkspace({ data }: { data: JlsView }) {
  const { language } = useI18n(), t = jlsMessages[language], p = data.plan?.body;
  const decisions=data.delegated?.tasks.filter(x=>x.phase==="luna").flatMap(x=>x.parsed?.decisions??[])??[];
  const axisNames: Record<string,string> = language === "fr" ? { service:"Service",quality:"Qualité",price:"Prix",atmosphere:"Ambiance" } : { service:"Dịch vụ",quality:"Chất lượng",price:"Giá",atmosphere:"Không gian" };
  const money = (x: number | null) => x === null ? t.unknown : x.toLocaleString(language, { maximumFractionDigits: 7 }) + " USD";
  const download = () => {
    if (!p) return;
    const u = URL.createObjectURL(new Blob([JSON.stringify({ preparation_only: true, luna_groups: p.luna_groups,
      conditional_sol_preview: p.conditional_sol_preview, accepted_sol_dossier: null }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = u; a.download = `jev-luna-sol-preparation-${language}.json`; a.click(); URL.revokeObjectURL(u);
  };
  return <>
    <section className="card jev-card"><h2>{t.title}</h2><p>{t.intro}</p><p>{data.delegated?.run?data.delegated.run.status:t.locked}</p><p>{t.limit}</p>
      <button className="primary-button full-width" disabled>{t.generate}</button>
    </section>
    {data.delegated&&<JlsDelegatedStatus data={data.delegated}/>}
    {data.prioritized&&<JlsPrioritizedPreparation data={data.prioritized}/>}
    {data.prioritized_execution&&<JlsPrioritizedExecutionStatus data={data.prioritized_execution}/>}
    {data.prioritized?.result&&<PrioritizedJlsReport result={data.prioritized.result}/>}
    {data.prioritized_error&&<p role="alert">{language==="fr"?"Nouveau format indisponible ; rapport historique conservé":"Định dạng mới chưa khả dụng; báo cáo cũ được giữ nguyên"} : {data.prioritized_error}</p>}
    {!p ? <p>{t.empty}</p> : <>
      <section className="card jev-card"><h2>{p.establishment_name}</h2><p>{t.source}</p><p>{t.preparation}</p>
        <dl className="jev-pairs"><dt>{t.analysed}</dt><dd>{p.statistics.coverage.analysed_reviews}</dd><dt>{t.quotes}</dt><dd>{p.question_count}</dd><dt>{t.reviews}</dt><dd>{p.max_luna_calls}</dd></dl>
        <p className="evidence-id">{p.version}<br />{p.source_plan_id}</p>
      </section>
      <section className="card jev-card"><h3>{t.stars}</h3>{Object.entries(p.selected_summary.star_distribution).map(([star, count]) =>
        <div className="jls-star" key={star}><span>{star} ★</span><meter min={0} max={p.question_count} value={count} /><strong>{count}</strong></div>)}
        <p>{language === "fr" ? "Diversité des citations ; les fréquences du restaurant restent calculées sur tous les avis analysés." : "Độ đa dạng trích dẫn; tần suất của nhà hàng vẫn tính trên mọi đánh giá đã phân tích."}</p>
      </section>
      <section className="card jev-card"><h3>{t.pending} · {p.question_count-decisions.length}</h3><p>{t.rules} · {p.selected_summary.rule_confirmed}</p>
        <dl className="jev-pairs">{[[t.accepted,"ACCEPTED"],[t.rejected,"REJECTED"],[t.uncertain,"UNCERTAIN"]].map(([x,s]) => <div className="jls-status-pair" key={x}><dt>{x}</dt><dd>{decisions.length?decisions.filter(d=>d.status===s).length:t.unrun}</dd></div>)}</dl>
      </section>
      <section className="card jev-card"><h3>{t.costs}</h3><p>{t.zero}</p><dl className="jev-pairs">
        <dt>{t.requests}</dt><dd>{p.max_luna_calls}</dd><dt>{t.questions}</dt><dd>{p.question_count}</dd>
        <dt>Luna · {t.input}</dt><dd>{p.estimates.luna_input_tokens}</dd><dt>Luna</dt><dd>{money(p.estimates.luna_cost_usd)}</dd>
        <dt>Sol · {t.input}</dt><dd>{p.estimates.sol.estimated_input_tokens}</dd><dt>Sol · {t.output}</dt><dd>{p.estimates.sol.estimated_output_tokens}</dd>
        <dt>Sol</dt><dd>{money(p.estimates.sol.estimated_cost_usd)}</dd><dt>{t.total}</dt><dd>{money(p.estimates.total_estimated_cost_usd)}</dd>
        <dt>{t.high}</dt><dd>{money(p.estimates.high_estimated_cost_usd)}</dd>
      </dl><p>{t.conditional}</p><p>{t.disclaimer}</p></section>
      <details className="card jev-card"><summary>{t.stats}</summary><dl className="jev-pairs">
        <dt>Google Maps</dt><dd>{p.statistics.coverage.google_total}</dd><dt>Supabase</dt><dd>{p.statistics.coverage.stored_reviews}</dd>
        <dt>{language === "fr" ? "Avis avec texte" : "Đánh giá có nội dung"}</dt><dd>{p.statistics.coverage.reviews_with_text}</dd>
        <dt>{t.analysed}</dt><dd>{p.statistics.coverage.analysed_reviews}</dd>
      </dl>{p.statistics.themes.map(x => <p key={x.theme_key}>{GOLD_TAXONOMY[x.theme_key][language]} : +{x.positive_mentions} / −{x.negative_mentions} · {x.distinct_reviews} {t.reviews}</p>)}</details>
      <details className="card jev-card"><summary>{t.themes}</summary>{Object.entries(p.selected_summary.by_axis_polarity).map(([key, n]) => <p key={key}>{axisNames[key.split(":")[0]]} · {key.endsWith("negative") ? "−" : "+"} : {n}</p>)}
        {[...new Set(p.selected.map(e=>e.theme_key))].map(key=><p key={key}>{GOLD_TAXONOMY[key][language]} : +{p.selected.filter(e=>e.theme_key===key&&e.polarity==="positive").length} / −{p.selected.filter(e=>e.theme_key===key&&e.polarity==="negative").length}</p>)}
      </details>
      <section className="card jev-card"><h3>{t.quotes}</h3>{p.selected.map(e => <article className="evidence-proof" key={e.evidence_id}>
        <h4>{GOLD_TAXONOMY[e.theme_key][language]} · {e.polarity === "positive" ? "+" : "−"} · {e.rating} ★</h4>
        <blockquote>{e.quote}</blockquote><p>{t.rules}</p>
        {decisions.find(d=>d.evidence_id===e.evidence_id)&&<p>Luna : {decisions.find(d=>d.evidence_id===e.evidence_id)!.status} · {decisions.find(d=>d.evidence_id===e.evidence_id)!.confidence}</p>}
        <details><summary>{language === "fr" ? "Contexte et provenance" : "Ngữ cảnh và nguồn"}</summary><p>{e.context}</p>
          <p className="evidence-id">{e.review_id}<br />{e.evidence_id}<br />{e.analysis_text_sha256}<br />{e.quote_sha256}<br />{e.translation_source}</p>
          <p>{e.v3_status} · {e.configuration_jev} · {e.served_model}</p>
        </details>
        <details><summary>{t.full}</summary><p>{p.luna_groups.find(g => g.review_id === e.review_id)?.payload.input &&
          JSON.parse(p.luna_groups.find(g => g.review_id === e.review_id)!.payload.input).analysis_text}</p></details>
      </article>)}</section>
      <details className="card jev-card"><summary>{t.dossier}</summary><p>{decisions.length?(language==="fr"?"Dossier conditionnel du plan historique, préparé avant Luna. Le dossier des preuves acceptées est affiché séparément.":"Hồ sơ có điều kiện của kế hoạch cũ, chuẩn bị trước Luna. Hồ sơ bằng chứng đã được chấp nhận hiển thị riêng."):t.dossierLimit}</p>
        <pre>{JSON.stringify(p.conditional_sol_preview.request, null, 2)}</pre></details>
      <details className="card jev-card"><summary>{t.details}</summary><pre>{JSON.stringify(p.luna_groups, null, 2)}</pre></details>
      <button className="secondary-button full-width" onClick={download}>{t.download}</button>
    </>}
  </>;
}
export function JlsDelegatedStatus({data}:{data:NonNullable<JlsView["delegated"]>}){
  const {language}=useI18n(),fr=language==="fr",r=data.run,report=(data.revalidation?.body.sol_result??data.result?.body.sol_result)?.report;
  const axes:Record<string,string>=fr?{service:"Service",quality:"Qualité",price:"Prix",atmosphere:"Ambiance"}:{service:"Dịch vụ",quality:"Chất lượng",price:"Giá",atmosphere:"Không gian"};
  return <section className="card jev-card">
    <h3>{fr?"Pilote vietnamien — exécution déléguée":"Thử nghiệm tiếng Việt — chạy được ủy quyền"}</h3>
    <p>{r?r.status:data.ready?(fr?"Lancement délégué prêt — aucune dépense autorisée":"Sẵn sàng chạy được ủy quyền — chưa cho phép chi phí"):(fr?"Préparation du lancement délégué":"Đang chuẩn bị chạy được ủy quyền")}</p>
    {!r&&<p>{fr?"Une nouvelle autorisation explicite dans ChatGPT est nécessaire. Aucun clic iPhone n’est requis. Aucun lancement automatique depuis cet écran.":"Cần cho phép rõ ràng mới trong ChatGPT. Không cần bấm trên iPhone. Màn hình này không tự chạy."}</p>}
    <p>{fr?"Maximum : 24 requêtes Luna, 25 questions, un appel Sol ; aucun retry payant.":"Tối đa: 24 yêu cầu Luna, 25 câu hỏi, một lần gọi Sol; không gọi lại trả phí."}</p>
    <p>{fr?"Avant Sol : 12 preuves acceptées, dont Qualité ≥ 2, Service ≥ 2, Prix ≥ 2, Ambiance ≥ 1 ; 6 critiques et 4 citations issues d’avis 1–3 étoiles. Toute réponse manquante ou tentative incertaine bloque Sol.":"Trước Sol: 12 bằng chứng được chấp nhận, Chất lượng ≥ 2, Dịch vụ ≥ 2, Giá ≥ 2, Không gian ≥ 1; 6 phê bình và 4 trích dẫn từ đánh giá 1–3 sao. Thiếu phản hồi hoặc lần gọi không rõ trạng thái sẽ chặn Sol."}</p>
    {r&&<><p>{fr?"Consentement délégué":"Chấp thuận ủy quyền"} : {r.consent_source} · {new Date(r.expires_at).toLocaleString(language)}</p>
      <p>Luna : {data.costs.luna.attempts} / 24 · Sol : {data.costs.sol.attempts} / 1</p>
      <p>{fr?"Coût total calculé":"Tổng chi phí tính toán"} : {data.costs.total_cost_usd===null?(fr?"Inconnu — télémétrie manquante":"Chưa biết — thiếu dữ liệu sử dụng"):data.costs.total_cost_usd.toFixed(7)+" USD"}</p>
      <p>{fr?"Coût calculé depuis l’usage, pas une facture vérifiée.":"Chi phí tính từ dữ liệu sử dụng, không phải hóa đơn đã xác minh."}</p>
      {r.error_code&&<p role="alert">{r.error_code}</p>}
      <details><summary>{fr?"Progression, probabilités et erreurs":"Tiến độ, xác suất và lỗi"}</summary><pre>{JSON.stringify(data.tasks,null,2)}</pre></details>
    </>}
    {data.dossier&&<details><summary>{fr?"Dossier Sol après Luna — preuves acceptées uniquement":"Hồ sơ Sol sau Luna — chỉ bằng chứng được chấp nhận"}</summary><pre>{JSON.stringify(data.dossier.body,null,2)}</pre></details>}
    {data.revalidation&&<p>{fr?"Rapport revalidé sans nouvel appel payant. Résultat historique conservé : ":"Báo cáo đã được kiểm tra lại, không gọi thêm dịch vụ trả phí. Giữ nguyên kết quả gốc: "}{r?.status} · {data.revalidation.body.version}</p>}
    {report&&<><h3>{fr?"Rapport expérimental vietnamien":"Báo cáo thử nghiệm tiếng Việt"}</h3>
      {report.axes.map(a=><div key={a.axis}><h4>{axes[a.axis??""]}</h4><p>{a.text??(fr?"À réexaminer":"Cần xem lại")}</p><p className="evidence-id">{a.evidence_ids.join(" · ")}</p></div>)}
      {[
        {title:fr?"Aspects positifs":"Điểm tích cực",items:report.positive_aspects},
        {title:fr?"Aspects négatifs":"Điểm tiêu cực",items:report.negative_aspects},
        {title:fr?"Conclusion":"Kết luận",items:[report.conclusion]},
        {title:fr?"Recommandations":"Khuyến nghị",items:report.recommendations},
      ].map(section=><div key={section.title}><h4>{section.title}</h4>{section.items.length===0&&<p>{fr?"À réexaminer":"Cần xem lại"}</p>}
        {section.items.map((a,i)=><article key={i}><p>{a.text??(fr?"À réexaminer":"Cần xem lại")}</p><p className="evidence-id">{a.evidence_ids.join(" · ")}</p></article>)}</div>)}
      <p>{fr?"Jugements IA, pas validation humaine indépendante. Couverture limitée aux avis analysés.":"Đánh giá AI, không phải xác nhận độc lập của con người. Chỉ bao phủ các đánh giá đã phân tích."}</p>
    </>}
  </section>;
}
export function JlsEntry() {
  const { language } = useI18n(), t = jlsMessages[language];
  return <section className="card jev-card"><h3>{t.title}</h3><p>{t.locked}</p><Link className="secondary-button full-width" to="/plus/jev-luna-sol">{t.dossier}</Link></section>;
}
export function JlsPrioritizedPreparation({data}:{data:NonNullable<JlsView["prioritized"]>}){
  const {language}=useI18n(),fr=language==="fr",d=data.draft,
    money=(n:number|null)=>n===null?(fr?"Inconnu":"Chưa biết"):n.toLocaleString(language,{maximumFractionDigits:7})+" USD";
  return <section className="card jev-card jls-prioritized">
    <h3>{fr?"Nouveau format — recommandations prioritaires":"Định dạng mới — khuyến nghị ưu tiên"}</h3>
    <p className="evidence-id">{d.version}</p>
    <p>{fr?"Format prêt. Le rapport historique reste conservé ; aucun nouveau rapport généré.":"Định dạng sẵn sàng. Giữ nguyên báo cáo cũ; chưa tạo báo cáo mới."}</p>
    <p>{fr?"Trois à cinq priorités si les preuves le permettent ; moins si nécessaire. Chaque priorité sépare constat sourcé, action proposée et justification de l’ordre.":"Ba đến năm ưu tiên nếu có đủ bằng chứng; ít hơn nếu cần. Mỗi ưu tiên tách phản ánh có nguồn, hành động đề xuất và lý do xếp thứ tự."}</p>
    <dl className="jev-pairs"><dt>{fr?"Preuves ACCEPTED réutilisables":"Bằng chứng ACCEPTED có thể dùng lại"}</dt><dd>{d.accepted_ids.length}</dd>
      <dt>Sol · {fr?"entrée estimée":"đầu vào ước tính"}</dt><dd>{d.estimates.estimated_input_tokens}</dd>
      <dt>Sol · {fr?"sortie prévue":"đầu ra dự kiến"}</dt><dd>{d.estimates.estimated_output_tokens}</dd>
      <dt>Sol · {fr?"coût estimé":"chi phí ước tính"}</dt><dd>{money(d.estimates.estimated_cost_usd)}</dd>
      <dt>{fr?"Estimation haute":"Ước tính cao"}</dt><dd>{money(d.estimates.high_estimated_cost_usd)}</dd>
    </dl>
    <p>{fr?"JEV et Luna supplémentaires : zéro dans cette prévisualisation. Estimations locales, pas une facture ; éventuels suppléments non vérifiés.":"Không gọi thêm JEV hay Luna trong phần xem trước này. Ước tính cục bộ, không phải hóa đơn; phụ phí chưa xác minh."}</p>
    <button className="primary-button full-width" disabled>{fr?"Nouvel essai — GO explicite requis":"Thử nghiệm mới — cần cho phép rõ ràng"}</button>
    <details><summary>{fr?"Preuves disponibles pour les constats":"Bằng chứng có sẵn cho phần phản ánh"}</summary>
      {d.packet.evidence.map(e=><article className="evidence-proof" key={e.evidence_id}><h4>{GOLD_TAXONOMY[e.theme_key][language]} · {e.polarity} · {e.rating} ★</h4>
        <blockquote lang="en">{e.quote}</blockquote><details><summary>{fr?"Contexte exact et empreintes":"Ngữ cảnh chính xác và mã băm"}</summary><p lang="en">{e.context}</p>
          <p className="evidence-id">{e.review_id}<br />{e.evidence_id}<br />{e.quote_sha256}<br />{e.context_sha256}</p></details></article>)}
    </details>
    <details><summary>{fr?"Dossier et schéma du futur appel Sol":"Hồ sơ và cấu trúc lần gọi Sol tương lai"}</summary><pre>{JSON.stringify(d.request,null,2)}</pre></details>
    <aside className="jls-methodology"><h4>{fr?"Note méthodologique":"Ghi chú phương pháp"}</h4><p>{d.methodology_note}</p></aside>
  </section>;
}
export function JlsPrioritizedExecutionStatus({data}:{data:NonNullable<JlsView["prioritized_execution"]>}){
  const {language}=useI18n(),fr=language==="fr",p=data.protocol.body,r=data.run,v=data.result?.body;
  return <section className="card jev-card jls-prioritized"><h3>{fr?"Exécution déléguée — nouveau rapport vietnamien":"Chạy được ủy quyền — báo cáo tiếng Việt mới"}</h3>
    <p>{r?(fr?"Statut historique : ":"Trạng thái lịch sử: ")+r.status:(fr?"Mécanisme prêt — aucun GO enregistré":"Cơ chế sẵn sàng — chưa ghi nhận cho phép chạy")}</p>
    <p>{fr?"Un GO explicite dans ChatGPT autorisera une seule exécution. Aucune manipulation GitHub ou iPhone. L’ancien run et son consentement restent fermés.":"Cho phép rõ ràng trong ChatGPT sẽ cấp quyền chạy một lần. Không cần thao tác GitHub hay iPhone. Lần chạy và chấp thuận cũ vẫn đóng."}</p>
    <p>{fr?"JEV, Luna, Apify : zéro nouvel appel. Sol : un appel maximum, aucun retry payant.":"JEV, Luna, Apify: không gọi thêm. Sol: tối đa một lần gọi, không gọi lại trả phí."}</p>
    <p className="evidence-id">{data.protocol.id}<br/>{p.version}<br/>{data.protocol.sha256}</p>
    {r&&<><p>{fr?"Consentement spécifique expirant le":"Chấp thuận riêng hết hạn lúc"} {new Date(r.expires_at).toLocaleString(language)}</p><p>{fr?"Tentatives Sol réservées":"Số lần gọi Sol đã giữ chỗ"} : {data.task?.request_count??0} / 1</p></>}
    {r?.error_code&&<p role="alert">{r.error_code}</p>}
    {data.revalidation&&<aside className="jls-methodology" data-testid="prioritized-revalidation"><h4>{fr?"Revalidation séparée — aucun nouvel appel":"Kiểm tra lại riêng — không gọi thêm"}</h4>
      <p>{data.revalidation.payload.body.controls.report_validation_passed?(fr?"Contrôles techniques réussis":"Kiểm tra kỹ thuật đạt"):(fr?"À réexaminer":"Cần xem lại")}</p>
      <p>{fr?"Le statut historique est conservé. Cette revalidation ne garantit pas la vérité sémantique et n’est pas une validation humaine.":"Giữ nguyên trạng thái lịch sử. Kiểm tra lại không bảo đảm đúng về ngữ nghĩa và không phải xác nhận của con người."}</p>
      <p className="evidence-id">{data.revalidation.id} · {data.revalidation.payload.body.validator_version}<br/>{data.revalidation.payload.body.provenance.commit}<br/>{data.revalidation.payload.sha256}</p>
      <details><summary>{fr?"Provenance et contrôles de la revalidation":"Nguồn gốc và kiểm tra lại"}</summary><pre>{JSON.stringify(data.revalidation,null,2)}</pre></details>
      {v?.validated_report&&<details data-testid="prioritized-original"><summary>{fr?"Consulter le rapport original immuable":"Xem báo cáo gốc bất biến"}</summary><PrioritizedJlsReport result={v.validated_report}/></details>}
    </aside>}
    {v&&<><dl className="jev-pairs"><dt>{fr?"Modèle servi":"Mô hình thực tế"}</dt><dd>{v.served_model??"—"}</dd>
      <dt>Input tokens</dt><dd>{v.input_tokens??"—"}</dd><dt>Output tokens</dt><dd>{v.output_tokens??"—"}</dd>
      <dt>{fr?"Coût calculé":"Chi phí tính toán"}</dt><dd>{v.cost_usd===null?(fr?"Inconnu — usage manquant":"Chưa biết — thiếu dữ liệu sử dụng"):v.cost_usd.toFixed(7)+" USD"}</dd></dl>
      <p>{fr?"Coût calculé depuis l’usage, pas une facture vérifiée. Conformité technique, pas validation humaine ni garantie de vérité.":"Chi phí tính từ dữ liệu sử dụng, không phải hóa đơn xác nhận. Chỉ kiểm tra kỹ thuật, không phải xác nhận của con người hay bảo đảm sự thật."}</p>
      <details><summary>{fr?"Réponse brute et contrôles — sans nouvel appel":"Phản hồi gốc và kiểm tra — không gọi thêm"}</summary><pre>{JSON.stringify({controls:v.controls,raw_response_text:v.raw_response_text,sha256:data.result!.sha256},null,2)}</pre></details>
    </>}
    <details><summary>{fr?"Protocole, empreintes et estimation":"Quy trình, mã băm và ước tính"}</summary><pre>{JSON.stringify(p,null,2)}</pre></details>
  </section>;
}
