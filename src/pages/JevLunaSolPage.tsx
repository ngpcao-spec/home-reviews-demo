import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../app/AppContext";
import { useI18n } from "../i18n";
import { PageHeader } from "../components/ui/PageHeader";
import { jlsPreview, type JlsView } from "../lib/jev-luna-sol";
import { jlsMessages } from "../i18n/jev-luna-sol";
import { GOLD_TAXONOMY } from "../../supabase/functions/_shared/gold-taxonomy";
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
  const axisNames: Record<string,string> = language === "fr" ? { service:"Service",quality:"Qualité",price:"Prix",atmosphere:"Ambiance" } : { service:"Dịch vụ",quality:"Chất lượng",price:"Giá",atmosphere:"Không gian" };
  const money = (x: number | null) => x === null ? t.unknown : x.toLocaleString(language, { maximumFractionDigits: 7 }) + " USD";
  const download = () => {
    if (!p) return;
    const u = URL.createObjectURL(new Blob([JSON.stringify({ preparation_only: true, luna_groups: p.luna_groups,
      conditional_sol_preview: p.conditional_sol_preview, accepted_sol_dossier: null }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = u; a.download = `jev-luna-sol-preparation-${language}.json`; a.click(); URL.revokeObjectURL(u);
  };
  return <>
    <section className="card jev-card"><h2>{t.title}</h2><p>{t.intro}</p><p>{t.locked}</p><p>{t.limit}</p>
      <button className="primary-button full-width" disabled>{t.generate}</button>
    </section>
    {!p ? <p>{t.empty}</p> : <>
      <section className="card jev-card"><h2>{p.establishment_name}</h2><p>{t.source}</p><p>{t.preparation}</p>
        <dl className="jev-pairs"><dt>{t.analysed}</dt><dd>{p.statistics.coverage.analysed_reviews}</dd><dt>{t.quotes}</dt><dd>{p.question_count}</dd><dt>{t.reviews}</dt><dd>{p.max_luna_calls}</dd></dl>
        <p className="evidence-id">{p.version}<br />{p.source_plan_id}</p>
      </section>
      <section className="card jev-card"><h3>{t.stars}</h3>{Object.entries(p.selected_summary.star_distribution).map(([star, count]) =>
        <div className="jls-star" key={star}><span>{star} ★</span><meter min={0} max={p.question_count} value={count} /><strong>{count}</strong></div>)}
        <p>{language === "fr" ? "Diversité des citations ; les fréquences du restaurant restent calculées sur tous les avis analysés." : "Độ đa dạng trích dẫn; tần suất của nhà hàng vẫn tính trên mọi đánh giá đã phân tích."}</p>
      </section>
      <section className="card jev-card"><h3>{t.pending} · {p.question_count}</h3><p>{t.rules} · {p.selected_summary.rule_confirmed}</p>
        <dl className="jev-pairs">{[t.accepted, t.rejected, t.uncertain].map(x => <div className="jls-status-pair" key={x}><dt>{x}</dt><dd>{t.unrun}</dd></div>)}</dl>
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
        <details><summary>{language === "fr" ? "Contexte et provenance" : "Ngữ cảnh và nguồn"}</summary><p>{e.context}</p>
          <p className="evidence-id">{e.review_id}<br />{e.evidence_id}<br />{e.analysis_text_sha256}<br />{e.quote_sha256}<br />{e.translation_source}</p>
          <p>{e.v3_status} · {e.configuration_jev} · {e.served_model}</p>
        </details>
        <details><summary>{t.full}</summary><p>{p.luna_groups.find(g => g.review_id === e.review_id)?.payload.input &&
          JSON.parse(p.luna_groups.find(g => g.review_id === e.review_id)!.payload.input).analysis_text}</p></details>
      </article>)}</section>
      <details className="card jev-card"><summary>{t.dossier}</summary><p>{t.dossierLimit}</p>
        <pre>{JSON.stringify(p.conditional_sol_preview.request, null, 2)}</pre></details>
      <details className="card jev-card"><summary>{t.details}</summary><pre>{JSON.stringify(p.luna_groups, null, 2)}</pre></details>
      <button className="secondary-button full-width" onClick={download}>{t.download}</button>
    </>}
  </>;
}
export function JlsEntry() {
  const { language } = useI18n(), t = jlsMessages[language];
  return <section className="card jev-card"><h3>{t.title}</h3><p>{t.locked}</p><Link className="secondary-button full-width" to="/plus/jev-luna-sol">{t.dossier}</Link></section>;
}
