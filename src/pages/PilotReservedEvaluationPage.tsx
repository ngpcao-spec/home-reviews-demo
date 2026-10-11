import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../app/AppContext";
import { useI18n } from "../i18n";
import { useJevAccess } from "../lib/use-jev-access";
import { PageHeader } from "../components/ui/PageHeader";
import {
  reservedEvaluationApi,
  type ReservedEvaluationView,
} from "../lib/pilot-reserved-evaluation";
import { reservedMessages } from "../i18n/pilot-reserved-evaluation";
import { GOLD_TAXONOMY } from "../../supabase/functions/_shared/gold-taxonomy";
import "./JevBenchmarkPage.css";
import "./GoldSetPage.css";
import "./PilotEvidenceV3Page.css";
export function PilotReservedEvaluationPage() {
  const { currentUser, demoMode } = useApp(),
    { language } = useI18n(),
    t = reservedMessages[language],
    access = useJevAccess(currentUser.id, demoMode),
    client = useQueryClient(),
    q = useQuery({
      queryKey: ["reserved-evaluation", currentUser.id],
      enabled: access.data === true,
      retry: false,
      queryFn: () => reservedEvaluationApi(),
    });
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) {
        void client.invalidateQueries({
          queryKey: ["reserved-evaluation", currentUser.id],
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
          ? <ReservedEvaluationWorkspace data={q.data} />
          : null}
        {q.isError && <p role="alert">{t.error}</p>}
        <button
          className="secondary-button full-width"
          disabled={q.isFetching || access.data !== true}
          onClick={() => void q.refetch()}
        >
          {t.refresh}
        </button>
        <Link to="/plus/jev-pilot-evidence-v3">{t.back}</Link>
      </div>
    </>
  );
}
export function ReservedEvaluationWorkspace(
  { data }: { data: ReservedEvaluationView },
) {
  const { language } = useI18n(),
    t = reservedMessages[language],
    r = data.record?.result,
    [filter, setFilter] = useState("all"),
    pct = (
      x: { numerator: number; denominator: number; value: number | null },
    ) =>
      x.value === null
        ? "—"
        : `${x.numerator}/${x.denominator} · ${
          (100 * x.value).toLocaleString(language, { maximumFractionDigits: 1 })
        } %`;
  function download() {
    if (!data.record) return;
    const u = URL.createObjectURL(
        new Blob([JSON.stringify(data.record, null, 2)], {
          type: "application/json",
        }),
      ),
      a = document.createElement("a");
    a.href = u;
    a.download = "home-reviews-v3-reserved40-evaluation.json";
    a.click();
    URL.revokeObjectURL(u);
  }
  return (
    <>
      <section className="card jev-card">
        <h2>{t.title}</h2>
        <p>{t.caveat}</p>
        <p>{t.scope}</p>
        <p>{t.readOnly}</p>
        <p>{t.recommendation}</p>
        <p>{t.why}</p>
      </section>
      {!r ? <p>{t.none}</p> : (
        <>
          <section className="card jev-card">
            <h2>{t.summary}</h2>
            <dl className="jev-pairs">
              {Object.entries(r.metrics.v3.counts).map(([k, n]) => (
                <Fragment key={k}>
                  <dt key={k + "dt"}>
                    {t.categories[k as keyof typeof t.categories]}
                  </dt>
                  <dd key={k + "dd"}>{n}</dd>
                </Fragment>
              ))}
            </dl>
            <p>{t.coverage}: {pct(r.metrics.v3.decisive_coverage_all)}</p>
            <p>{t.abstention}: {pct(r.metrics.v3.abstention_all)}</p>
            <p>{t.selective}: {pct(r.metrics.v3.selective_agreement)}</p>
            <p>
              {t.strict}: {pct(r.metrics.v3.strict_agreement_all_comparable)}
            </p>
            <p>{t.precision}: {pct(r.metrics.v3.acceptance_precision)}</p>
            <p>{t.precisionCaveat}</p>
            <p>
              {t.invalidRate}: {pct(r.metrics.v3.unjustified_acceptance_rate)}
            </p>
            <p>
              {t.retention}: {pct(r.metrics.v3.justified_acceptance_coverage)}
            </p>
          </section>
          <section className="card jev-card">
            <h2>{t.compare}</h2>
            {Object.entries(r.metrics).map(([name, m]) => (
              <article key={name}>
                <h3>{name === "v21" ? "V2.1" : name.toUpperCase()}</h3>
                <p>
                  {t.accepted}: {m.counts.justified_accepted} · {t.badAccepted}:
                  {" "}
                  {m.counts.unjustified_accepted}
                </p>
                <p>{t.coverage}: {pct(m.decisive_coverage_all)}</p>
                <p>{t.abstention}: {pct(m.abstention_all)}</p>
                <p>{t.selective}: {pct(m.selective_agreement)}</p>
              </article>
            ))}
          </section>
          <section className="card jev-card">
            <h2>{t.axes}</h2>
            {Object.entries(r.by_axis).map(([axis, v]) => (
              <article key={axis}>
                <h3>{t.axis[axis as keyof typeof t.axis]}</h3>
                <p>
                  {t.accepted}:{" "}
                  {v.v3.counts.justified_accepted}/{v.v3.reference_supported}
                </p>
                <p>{t.coverage}: {pct(v.v3.decisive_coverage_all)}</p>
                <p>{t.abstention}: {pct(v.v3.abstention_all)}</p>
                <p>
                  {t.goodReject}: {v.v3.counts.unjustified_rejected} ·{" "}
                  {t.badReject}: {v.v3.counts.justified_rejected}
                </p>
              </article>
            ))}
          </section>
          <section className="card jev-card">
            <h2>{t.cases}</h2>
            <select
              aria-label={t.cases}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">{t.all}</option>
              {Object.entries(t.categories).map(([key, label]) => (
                <option value={key} key={key}>{label}</option>
              ))}
            </select>
            {r.cases.filter((c) => filter === "all" || c.category === filter)
              .map((c) => (
                <article className="jev-theme-detail" key={c.review_id}>
                  <h3>
                    {c.position} · {GOLD_TAXONOMY[c.theme_key][language]} ·{" "}
                    {c.polarity}
                  </h3>
                  <p>{t.categories[c.category]}</p>
                  <p>
                    {t.reference}: {c.reference_choice} · V2.1: {c.v21.status}
                    {" "}
                    · JEV: {c.jev.choice}
                  </p>
                  <p>{t.reason}: {c.decision.reason}</p>
                  <p className="jev-id">{c.review_id}</p>
                  {c.decision.statement && (
                    <>
                      <h4>{t.quote}</h4>
                      <p className="gold-text" lang="en">
                        {c.decision.statement.quote}
                      </p>
                    </>
                  )}
                  <details>
                    <summary>{t.full}</summary>
                    <p className="gold-text" lang="en">{c.analysis_text}</p>
                    <p>{c.reference_justification}</p>
                    <p className="jev-id">
                      {c.analysis_text_sha256}
                      <br />
                      {c.quote_sha256}
                      <br />
                      {c.reference_annotation_sha256}
                    </p>
                  </details>
                </article>
              ))}
          </section>
          <section className="card jev-card">
            <h2>{t.next}</h2>
            {t.changes.map((s) => <p key={s}>{s}</p>)}
            <p>{t.future}</p>
          </section>
          <details className="card jev-card">
            <summary>{t.provenance}</summary>
            <p className="jev-id">
              {r.control_id}
              <br />
              {r.control_sha256}
              <br />
              {r.manifest.engine_commit}
              <br />
              {r.manifest.reference_commit}
              <br />
              {r.rule_sha256}
              <br />
              {data.record!.result_sha256}
              <br />
              {r.manifest.reference_file_sha256}
            </p>
          </details>
          <button className="secondary-button full-width" onClick={download}>
            {t.export}
          </button>
        </>
      )}
    </>
  );
}
