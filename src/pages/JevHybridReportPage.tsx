import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../app/AppContext";
import { useI18n } from "../i18n";
import { useJevAccess } from "../lib/use-jev-access";
import { PageHeader } from "../components/ui/PageHeader";
import { hybridReportApi, type HybridView } from "../lib/jev-hybrid-report";
import { hybridMessages } from "../i18n/jev-hybrid-report";
import { GOLD_TAXONOMY } from "../../supabase/functions/_shared/gold-taxonomy";
import "./JevBenchmarkPage.css";
import "./GoldSetPage.css";
import "./PilotEvidenceV3Page.css";
export function JevHybridReportPage() {
  const { currentUser, demoMode } = useApp(),
    { language } = useI18n(),
    t = hybridMessages[language],
    access = useJevAccess(currentUser.id, demoMode),
    client = useQueryClient(),
    q = useQuery({
      queryKey: ["hybrid-preview", currentUser.id, language],
      enabled: access.data === true,
      retry: false,
      queryFn: () => hybridReportApi(language),
    });
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) {
        void client.invalidateQueries({
          queryKey: ["hybrid-preview", currentUser.id],
        });
      }
    };
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [client, currentUser.id]);
  return (
    <>
      <PageHeader title={t.title} back />
      <div className="jev-page gold-page evidence-v3-page">
        {access.isPending || q.isPending && access.data === true
          ? <p>{t.loading}</p>
          : access.data !== true
          ? <p>{t.denied}</p>
          : q.data
          ? <HybridWorkspace data={q.data} />
          : null}
        {q.isError && <p role="alert">{t.error}</p>}
        <button
          className="secondary-button full-width"
          disabled={q.isFetching || access.data !== true}
          onClick={() => void q.refetch()}
        >
          {t.refresh}
        </button>
        <Link to="/plus/jev-benchmark">{t.back}</Link>
      </div>
    </>
  );
}
export function HybridWorkspace({ data }: { data: HybridView }) {
  const { language } = useI18n(),
    t = hybridMessages[language],
    p = data.plan?.body,
    money = (n: number | null) =>
      n === null
        ? "—"
        : n.toLocaleString(language, { maximumFractionDigits: 6 }) + " USD";
  function download() {
    if (!p) return;
    const u = URL.createObjectURL(
        new Blob([JSON.stringify(p.request_preview, null, 2)], {
          type: "application/json",
        }),
      ),
      a = document.createElement("a");
    a.href = u;
    a.download = "jev-hybrid-evidence-request-" + language + ".json";
    a.click();
    URL.revokeObjectURL(u);
  }
  return (
    <>
      <section className="card jev-card">
        <h2>{t.title}</h2>
        <p>{t.intro}</p>
        <p>{p?.establishment_name ?? "Artisan Cafe & Eatery"}</p>
        <p>{t.limits}</p>
        <button className="primary-button full-width" disabled>
          {t.generate}
        </button>
      </section>
      {p && (
        <>
          <section className="card jev-card">
            <h2>{t.statistics}</h2>
            <p>{t.scope}</p>
            <dl className="jev-pairs">
              <dt>{t.google}</dt>
              <dd>{p.analytics.coverage.google_total}</dd>
              <dt>{t.stored}</dt>
              <dd>{p.analytics.coverage.stored_reviews}</dd>
              <dt>{t.text}</dt>
              <dd>{p.analytics.coverage.reviews_with_text}</dd>
              <dt>{t.analysed}</dt>
              <dd>{p.analytics.coverage.analysed_reviews}</dd>
              <dt>{t.englishMissing}</dt>
              <dd>{p.analytics.coverage.missing_english}</dd>
              <dt>{t.textless}</dt>
              <dd>{p.analytics.coverage.textless_reviews}</dd>
            </dl>
            {p.analytics.axes.map((a) => (
              <article key={a.key}>
                <h3>{t.axes[a.key]}</h3>
                <p>
                  {t.positive}: {a.positive_mentions} {t.mentions} ·{" "}
                  {a.positive_review_count} {t.reviews}
                </p>
                <p>
                  {t.negative}: {a.negative_mentions} {t.mentions} ·{" "}
                  {a.negative_review_count} {t.reviews}
                </p>
              </article>
            ))}
            <details>
              <summary>25 {t.statistics}</summary>
              {p.analytics.themes.map((a) => (
                <p key={a.theme_key}>
                  {GOLD_TAXONOMY[a.theme_key][language]}{" "}
                  : +{a.positive_mentions} / −{a.negative_mentions} {t.mentions}
                  {" "}
                  · {a.distinct_reviews} {t.reviews}
                </p>
              ))}
            </details>
            <details>
              <summary>Google · {t.statistics}</summary>
              <pre className="gold-text">{JSON.stringify(p.analytics.google_context,null,2)}</pre>
            </details>
          </section>
          <section className="card jev-card">
            <h2>{t.selected}</h2>
            <p>{t.confirmed}: {p.evidence_pool.rule_confirmed}</p>
            <p>{t.candidate}: {p.evidence_pool.sol_candidate}</p>
            <p>{t.contested}: {p.evidence_pool.explicitly_contested}</p>
            <p>
              {p.selected_summary.total} {t.quote.toLowerCase()} ·{" "}
              {p.selected_summary.distinct_reviews} {t.reviews}
            </p>
            <p>
              {t.confirmed}: {p.selected_summary.rule_confirmed} ·{" "}
              {t.candidate}: {p.selected_summary.sol_candidate}
            </p>
            {Object.entries(p.selected_summary.by_axis_polarity).map((
              [k, n],
            ) => (
              <p key={k}>
                {t.axes[k.split(":")[0] as keyof typeof t.axes]} ·{" "}
                {k.endsWith("positive") ? t.positive : t.negative}: {n}
              </p>
            ))}
            <p>
              {t.mixed}: {p.selected_summary.mixed} · {t.high}:{" "}
              {p.selected_summary.negative_despite_high_rating}
            </p>
            <details>
              <summary>{t.stars}</summary>
              {Object.entries(p.selected_summary.star_distribution).map((
                [s, n],
              ) => <p key={s}>{s}★ : {n}</p>)}
            </details>
          </section>
          <section className="card jev-card">
            <h2>{t.cost}</h2>
            <p>{t.input}: {p.estimates.estimated_input_tokens}</p>
            <p>{t.output}: {p.estimates.estimated_output_tokens}</p>
            <p>{t.sol}: {money(p.estimates.estimated_sol_cost_usd)}</p>
            <p>{t.upper}: {money(p.estimates.max_sol_cost_usd)}</p>
            <p>{t.jev}</p>
            <p>{t.actual}</p>
            <p>{t.rates}</p>
            <p className="jev-id">{p.estimates.tokenizer}</p>
          </section>
          <section className="card jev-card">
            <h2>{t.preview}</h2>
            {p.selected.map((e) => (
              <article className="jev-theme-detail" key={e.evidence_id}>
                <h3>
                  {GOLD_TAXONOMY[e.theme_key][language]} ·{" "}
                  {e.polarity === "positive" ? t.positive : t.negative}
                </h3>
                <p>
                  {e.status === "rule_confirmed" ? t.confirmed : t.candidate} ·
                  {" "}
                  {e.rating}★
                </p>
                <p className="gold-text" lang="en">{e.quote}</p>
                <details>
                  <summary>{t.context}</summary>
                  <p className="gold-text" lang="en">{e.context}</p>
                </details>
                <details>
                  <summary>{t.provenance}</summary>
                  <p className="jev-id">
                    {e.review_id}
                    <br />
                    {e.evidence_id}
                    <br />
                    {e.analysis_text_sha256}
                    <br />
                    {e.quote_sha256}
                    <br />
                    {e.translation_source}
                    <br />
                    {e.v3_status}
                    <br />
                    {e.configuration_jev}
                  </p>
                </details>
              </article>
            ))}
          </section>
          <details className="card jev-card">
            <summary>{t.excluded} · {p.contested.length}</summary>
            {p.contested.map((e) => (
              <p className="jev-id" key={e.evidence_id}>
                {e.review_id} · {e.theme_key} · {e.polarity} · {e.v3_reason}
              </p>
            ))}
          </details>
          <details className="card jev-card">
            <summary>{t.request}</summary>
            <pre className="gold-text">{JSON.stringify(p.request_preview,null,2)}</pre>
          </details>
          <button className="secondary-button full-width" onClick={download}>
            {t.download}
          </button>
          <details className="card jev-card">
            <summary>{t.provenance}</summary>
            <p className="jev-id">
              {data.plan!.id}
              <br />
              {p.source_snapshot_id}
              <br />
              {p.dossier_sha256}
              <br />
              {p.prompt_sha256}
              <br />
              {p.schema_sha256}
              <br />
              {data.plan!.result_sha256}
            </p>
          </details>
        </>
      )}
      {data.control && (
        <section className="card jev-card">
          <h2>{t.control}</h2>
          <p>{t.controlWarning}</p>
          <p>
            {String(data.control.body.missing_jev)} JEV ·{" "}
            {String(data.control.body.reference_labels)} GPT-6
          </p>
          <p className="jev-id">
            {data.control.id}
            <br />
            {data.control.result_sha256}
          </p>
        </section>
      )}
      <section className="card jev-card">
        <h2>{t.jobs}</h2>
        <p>{t.noJobs}</p>
      </section>
    </>
  );
}
export function HybridEntry() {
  const { language } = useI18n(), t = hybridMessages[language];
  return (
    <section className="card jev-card">
      <h3>{t.title}</h3>
      <p>{t.intro}</p>
      <Link
        className="secondary-button full-width"
        to="/plus/jev-hybrid-report"
      >
        {t.preview}
      </Link>
    </section>
  );
}
