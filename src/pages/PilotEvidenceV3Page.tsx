import { reservedMessages } from '../i18n/pilot-reserved-evaluation'
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../app/AppContext";
import { useI18n } from "../i18n";
import { useJevAccess } from "../lib/use-jev-access";
import { PageHeader } from "../components/ui/PageHeader";
import { evidenceV3Api, type V3View } from "../lib/pilot-evidence-v3";
import { evidenceV3Messages } from "../i18n/pilot-evidence-v3";
import { GOLD_TAXONOMY } from "../../supabase/functions/_shared/gold-taxonomy";
import type { V3Binding } from "../../supabase/functions/_shared/pilot-evidence-v3-audit";
import "./JevBenchmarkPage.css";
import "./GoldSetPage.css";
import "./JevEconomyPilotPage.css";
import "./PilotEvidencePage.css";
import "./PilotEvidenceV3Page.css";
export function PilotEvidenceV3Page() {
  const { currentUser, demoMode } = useApp(),
    { language } = useI18n(),
    t = evidenceV3Messages[language],
    access = useJevAccess(currentUser.id, demoMode),
    client = useQueryClient(),
    key = ["evidence-v3", currentUser.id],
    lock = useRef(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    q = useQuery({
      queryKey: key,
      enabled: access.data === true,
      retry: false,
      queryFn: () => evidenceV3Api(),
    });
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) {
        void client.invalidateQueries({
          queryKey: ["evidence-v3", currentUser.id],
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
  async function audit() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(false);
    try {
      client.setQueryData(key, await evidenceV3Api(true));
    } catch {
      setError(true);
      await q.refetch();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader title={t.title} back />
      <div className="jev-page gold-page evidence-page evidence-v3-page">
        {access.isPending || q.isPending && access.data === true
          ? <p>{t.loading}</p>
          : access.data !== true
          ? <p>{t.denied}</p>
          : q.data
          ? (
            <EvidenceV3Workspace
              data={q.data}
              audit={audit}
              busy={busy || q.isFetching}
              refresh={() => void q.refetch()}
            />
          )
          : null}
        {(q.isError || error) && <p role="alert">{t.error}</p>}
        <Link to="/plus/jev-pilot-evidence">{t.back}</Link>
      </div>
    </>
  );
}
export function EvidenceV3Workspace(
  { data, audit, busy = false, refresh }: {
    data: V3View;
    audit: () => Promise<void>;
    busy?: boolean;
    refresh?: () => void;
  },
) {
  const { language } = useI18n(),
    t = evidenceV3Messages[language],
    a = data.record?.result,
    [filter, setFilter] = useState("all"),
    [limit, setLimit] = useState(20),
    label = (c: V3Binding) =>
      GOLD_TAXONOMY[c.theme_key][language] + " · " +
      (c.polarity === "positive" ? t.positive : t.negative),
    status = (s: string) =>
      s === "supported_by_rule"
        ? t.supported
        : s === "unsupported_by_rule"
        ? t.excluded
        : t.pending;
  const card = (c: V3Binding) => (
    <article className="jev-theme-detail" key={c.binding_id}>
      <h3>{label(c)}</h3>
      <p>{status(c.v21_status)} (V2.1) → {status(c.status)} (V3)</p>
      <p className="jev-id">{c.review_id}</p>
      <p>
        {t.reason}: <span className="jev-id">{c.reason}</span>
      </p>
      {c.statement && (
        <>
          <p className="gold-text" lang="en">{c.statement.quote}</p>
          <p>
            {t.statement}:{" "}
            <span className="jev-id">
              {c.statement.claim} · {c.statement.entity_name} ·{" "}
              {c.statement.time}
            </span>
          </p>
        </>
      )}
      <details>
        <summary>{t.full}</summary>
        <p className="gold-text" lang="en">{c.analysis_text}</p>
      </details>
      <details>
        <summary>{t.provenance}</summary>
        <p className="jev-id">
          {c.analysis_text_sha256}
          <br />
          {c.quote_sha256}
          <br />
          {c.verification_type}
          <br />
          {a?.rule_sha256}
        </p>
        {c.statement && <p>{c.statement.start}–{c.statement.end} · UTF-16</p>}
      </details>
    </article>
  );
  function download() {
    if (!data.blind_export) return;
    const u = URL.createObjectURL(
        new Blob([JSON.stringify(data.blind_export, null, 2)], {
          type: "application/json",
        }),
      ),
      link = document.createElement("a");
    link.href = u;
    link.download = "home-reviews-evidence-v3-control-blind.json";
    link.click();
    URL.revokeObjectURL(u);
  }
  const rows =
    a?.checks.filter((c) =>
      c.reason !== "RESERVED_NEW_CONTROL_NOT_EVALUATED" &&
      (filter === "all" || c.status === filter)
    ) ?? [];
  return (
    <>
      <section className="card jev-card">
        <h2>{t.title}</h2><Link className="secondary-button full-width" to="/plus/jev-pilot-reserved-evaluation">{reservedMessages[language].open}</Link>
        <p>{t.disclaimer}</p>
        <p>{t.immutable}</p>
        <button
          className="primary-button full-width"
          disabled={busy || !data.ready}
          onClick={() => void audit()}
        >
          {t.audit}
        </button>
        {refresh && (
          <button
            className="secondary-button full-width"
            disabled={busy}
            onClick={refresh}
          >
            {t.refresh}
          </button>
        )}
        <button className="secondary-button full-width" disabled>
          {t.disabled}
        </button>
      </section>
      {a && (
        <>
          <section className="card jev-card">
            <h2>{t.statistics}</h2>
            <dl className="jev-pairs">
              <dt>{t.reviews}</dt>
              <dd>{a.summary.jev_reviews}</dd>
              <dt>{t.findings}</dt>
              <dd>{a.summary.jev_findings}</dd>
              <dt>{t.assessed}</dt>
              <dd>{a.summary.assessed}</dd>
              <dt>{t.reserved}</dt>
              <dd>{a.summary.reserved}</dd>
            </dl>
          </section>
          <section className="card jev-card">
            <h2>{t.comparison}</h2>
            <dl className="jev-pairs">
              <dt>V2.1 · {t.supported}</dt>
              <dd>{a.baseline_counts.supported}</dd>
              <dt>V2.1 · {t.excluded}</dt>
              <dd>{a.baseline_counts.unsupported}</dd>
              <dt>V2.1 · {t.pending}</dt>
              <dd>{a.baseline_counts.review_needed}</dd>
              <dt>V3 · {t.supported}</dt>
              <dd>{a.summary.supported}</dd>
              <dt>{t.excluded}</dt>
              <dd>{a.summary.unsupported}</dd>
              <dt>{t.pending}</dt>
              <dd>
                {a.summary.review_needed} ({a.summary.reserved} {t.reserved})
              </dd>
              <dt>{t.recovered}</dt>
              <dd>{a.summary.recovered}</dd>
              <dt>{t.notRetained}</dt>
              <dd>{a.summary.old_supported_not_retained}</dd>
            </dl>
            {Object.entries(a.comparison).map(([old, v]) => (
              <details key={old}>
                <summary>V2.1 : {status(old)}</summary>
                {Object.entries(v).map(([s, n]) => (
                  <p key={s}>V3 : {status(s)} — {n}</p>
                ))}
              </details>
            ))}
          </section>
          <section className="card jev-card">
            <h2>{t.diagnostic}</h2>
            <p>{t.disclaimer}</p>
            {Object.entries(a.diagnostic_matrix).map(([v, counts]) => (
              <article key={v}>
                <h3>
                  {t.reference}: {v === "supported"
                    ? t.supported
                    : v === "unsupported"
                    ? t.excluded
                    : t.uncertain}
                </h3>
                {Object.entries(counts).map(([s, n]) => (
                  <p key={s}>V3 — {status(s)} : {n}</p>
                ))}
              </article>
            ))}
            <details>
              <summary>{t.associations}</summary>
              {a.diagnostic.map((c) => (
                <div key={c.binding_id}>
                  {card(c)}
                  <p>GPT-6 : {c.gpt6_verdict}</p>
                  {c.gpt6_justification && <p>{c.gpt6_justification}</p>}
                </div>
              ))}
            </details>
          </section>
          <section className="card jev-card">
            <h2>{t.recommendations}</h2>
            {a.recommendations.map((r) => (
              <article key={r.axis}>
                <h3>{t.axes[r.axis as keyof typeof t.axes]}</h3>
                <p>
                  {r.status === "grounded_by_rules" ? t.grounded : t.pending}
                </p>
                <p>{language === "fr" ? r.action_fr : r.action_vi}</p>
                <p>{t.interpretation}</p>
                {r.proof_ids.map((id) => {
                  const c = a.selected.find((p) => p.binding_id === id);
                  return c ? card(c) : <p key={id}>{t.pending}</p>;
                })}
              </article>
            ))}
          </section>
          <details className="card jev-card">
            <summary>{t.proofs} · {a.selected.length}</summary>
            {a.selected.map(card)}
          </details>
          <section className="card jev-card">
            <h2>{t.associations}</h2>
            <label>
              {t.reason}{" "}
              <select
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setLimit(20);
                }}
              >
                <option value="all">{t.all}</option>
                {["supported_by_rule", "unsupported_by_rule", "review_needed"]
                  .map((s) => <option value={s} key={s}>{status(s)}</option>)}
              </select>
            </label>
            {rows.slice(0, limit).map(card)}
            {rows.length > limit && (
              <button
                className="secondary-button full-width"
                onClick={() => setLimit((n) => n + 20)}
              >
                {t.more} ({limit}/{rows.length})
              </button>
            )}
          </section>
          <section className="card jev-card">
            <h2>{t.coverage}</h2>
            <p>{t.coverageNote}</p>
            {a.theme_coverage.map((c) => (
              <p key={c.theme}>
                {GOLD_TAXONOMY[c.theme][language]} : {c.supported}/{c.assessed}
                {" "}
                · JEV {c.jev}
              </p>
            ))}
            {a.health_flags.map((c) => (
              <p key={c.review_id}>
                {t.health} <span className="jev-id">{c.review_id}</span>
              </p>
            ))}
          </section>
          <details className="card jev-card">
            <summary>{t.provenance}</summary>
            <p className="jev-id">
              {data.record!.id}
              <br />
              {a.version}
              <br />
              {a.verifier}
              <br />
              {a.rule_sha256}
              <br />
              {data.record!.result_sha256}
              <br />
              {a.posthoc_sha256}
              <br />
              {a.control_sha256}
            </p>
          </details>
        </>
      )}
      {data.control && (
        <section className="card jev-card">
          <h2>{t.control}</h2>
          <p>{t.controlNote}</p>
          <p>{t.none}</p>
          {Object.entries(data.control.body.strata).map(([stratum, c]) => (
            <p key={stratum}>{stratum} : {c.selected} ({c.available})</p>
          ))}
          <p className="jev-id">
            {data.control.id}
            <br />
            {data.control.sha}
          </p>
          <button className="secondary-button full-width" onClick={download}>
            {t.download}
          </button>
        </section>
      )}
    </>
  );
}
