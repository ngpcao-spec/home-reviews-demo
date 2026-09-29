import { AlertTriangle, MessageSquareText, Sparkles, Star } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../app/AppContext'
import { BrandHeader } from '../components/ui/BrandHeader'
import { EstablishmentAvatar } from '../components/ui/EstablishmentAvatar'
import { useI18n } from '../i18n'
import { supabase } from '../lib/supabase'
import {
  buildDemoWeeklyReport,
  currentVietnamWeekStart,
  formatWeeklyPeriod,
  lastCompletedVietnamWeekStart,
  mapWeeklyReport,
  type WeeklyReport,
  type WeeklyReportRow,
} from '../lib/weekly-report'

interface GenerateWeeklyReportPayload { report?: WeeklyReportRow; error?: string }

export function AnalyticsPage() {
  const { reviews, establishments, demoMode, preferredLanguage } = useApp()
  const { messages, language } = useI18n()
  const [establishmentId, setEstablishmentId] = useState('')
  const [periodMode, setPeriodMode] = useState<'completed' | 'current'>('completed')
  const [reports, setReports] = useState<Record<string, WeeklyReport>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [requestVersion, setRequestVersion] = useState(0)
  const requestedKeys = useRef(new Set<string>())
  const periodStart = useMemo(() => periodMode === 'current'
    ? currentVietnamWeekStart()
    : lastCompletedVietnamWeekStart(), [periodMode])

  const resolvedEstablishmentId = establishments.some((item) => item.id === establishmentId)
    ? establishmentId
    : establishments[0]?.id ?? ''
  const selected = establishments.find((item) => item.id === resolvedEstablishmentId)
  const reportCacheKey = selected && preferredLanguage ? `${selected.id}:${periodStart}:${preferredLanguage}:${periodMode}` : ''
  const cachedReport = reportCacheKey ? reports[reportCacheKey] : undefined
  const demoReport = useMemo(() => selected && preferredLanguage && demoMode
    ? buildDemoWeeklyReport(selected.id, reviews, preferredLanguage, selected.currentRating, selected.currentReviewCount, periodMode === 'current')
    : null,
  [demoMode, periodMode, preferredLanguage, reviews, selected])

  useEffect(() => {
    if (!selected || !preferredLanguage) return
    if (demoMode || !supabase || cachedReport) return
    const client = supabase
    const requestKey = `${reportCacheKey}:${requestVersion}`
    if (requestedKeys.current.has(requestKey)) return
    requestedKeys.current.add(requestKey)
    let active = true
    const load = async () => {
      setLoading(true)
      setError(null)
      setErrorKey(null)
      const { data, error: functionError } = await client.functions.invoke<GenerateWeeklyReportPayload>('generate-weekly-report', {
        body: periodMode === 'current'
          ? { establishment_id: selected.id, provisional: true }
          : { establishment_id: selected.id, period_start: periodStart },
      })
      if (!active) return
      if (functionError || !data?.report) {
        setError(messages.analytics.loadFailed)
        setErrorKey(requestKey)
      } else {
        setReports((current) => ({ ...current, [reportCacheKey]: mapWeeklyReport(data.report!) }))
      }
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [cachedReport, demoMode, messages.analytics.loadFailed, periodMode, periodStart, preferredLanguage, reportCacheKey, requestVersion, selected])

  const visibleReport = demoReport ?? cachedReport ?? null
  const currentRequestPrefix = selected && preferredLanguage ? `${selected.id}:${periodStart}:${preferredLanguage}:${periodMode}:` : ''
  const visibleError = errorKey?.startsWith(currentRequestPrefix) ? error : null
  const periodLabel = visibleReport ? formatWeeklyPeriod(visibleReport.periodStart, visibleReport.periodEnd, language) : ''
  const number = new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'fr-FR')

  return <>
    <BrandHeader />
    <section className="reference-intro analytics-intro">
      <h1>{messages.analytics.weeklyTitle}</h1>
      <p>{messages.analytics.weeklyIntro}</p>
    </section>
    {establishments.length > 0 && <div className="analytics-filters weekly-report-filter">
      <label htmlFor="weekly-establishment">{messages.analytics.establishmentLabel}</label>
      <select id="weekly-establishment" value={resolvedEstablishmentId} onChange={(event) => setEstablishmentId(event.target.value)}>
        {establishments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <label htmlFor="weekly-period-mode">{messages.analytics.periodLabel}</label>
      <select id="weekly-period-mode" value={periodMode} onChange={(event) => setPeriodMode(event.target.value as 'completed' | 'current')}>
        <option value="completed">{messages.analytics.completedWeek}</option>
        <option value="current">{messages.analytics.currentWeek}</option>
      </select>
    </div>}

    {!establishments.length && <section className="weekly-report-state card"><p>{messages.analytics.noEstablishment}</p></section>}
    {loading && <section className="weekly-report-state card" aria-live="polite"><span className="weekly-report-spinner"/><p>{messages.analytics.generating}</p></section>}
    {visibleError && <section className="weekly-report-state card" role="alert"><AlertTriangle/><p>{visibleError}</p><button className="secondary-button" onClick={() => setRequestVersion((value) => value + 1)}>{messages.common.retry}</button></section>}

    {selected && visibleReport && <div className="weekly-report">
      <section className="weekly-report-hero card">
        <EstablishmentAvatar id={selected.id} name={selected.name} photoUrl={selected.photoUrl} large />
        <div>
          <div className="weekly-report-label"><span className="eyebrow">{messages.analytics.weeklyReport}</span>{visibleReport.provisional && <span className="weekly-provisional">{messages.analytics.provisionalReport}</span>}</div>
          <h2>{selected.name}</h2>
          <p className="weekly-period">{periodLabel}</p>
          <div className="weekly-google-metrics">
            <strong>{visibleReport.googleRating === null ? '—' : visibleReport.googleRating.toLocaleString(language === 'vi' ? 'vi-VN' : 'fr-FR', { maximumFractionDigits: 1 })} <Star aria-hidden="true"/></strong>
            <span>{visibleReport.googleTotalReviews === null ? messages.analytics.snapshotUnavailable : `${number.format(visibleReport.googleTotalReviews)} ${messages.analytics.googleReviews}`}</span>
          </div>
        </div>
      </section>

      {!visibleReport.dataComplete && <section className="weekly-data-warning card" role="status">
        <AlertTriangle aria-hidden="true"/>
        <div><strong>{messages.analytics.dataPartial}</strong><p>{messages.analytics.dataPartialDetail}</p></div>
      </section>}

      <section className="weekly-section">
        <div className="weekly-section-heading"><span className="eyebrow">01</span><h2>{messages.analytics.overview}</h2></div>
        <div className="weekly-kpis">
          <article className="weekly-kpi card"><MessageSquareText/><strong>{visibleReport.dataComplete ? visibleReport.newReviewsCount : '—'}</strong><span>{messages.analytics.newReviews}</span></article>
          <article className="weekly-kpi card negative"><AlertTriangle/><strong>{visibleReport.negativeReviewsCount}</strong><span>{visibleReport.dataComplete ? messages.analytics.negativeReviews : messages.analytics.knownNegativeReviews}</span></article>
          <article className="weekly-kpi card"><span className="weekly-percent">%</span><strong>{visibleReport.dataComplete ? `${visibleReport.negativeRate.toLocaleString(language === 'vi' ? 'vi-VN' : 'fr-FR', { maximumFractionDigits: 1 })} %` : '—'}</strong><span>{messages.analytics.negativeRate}</span></article>
          <article className="weekly-kpi card ready"><Sparkles/><strong>{visibleReport.readyRepliesCount}</strong><span>{messages.analytics.readyReplies}</span></article>
        </div>
      </section>

      <section className="weekly-section">
        <div className="weekly-section-heading"><span className="eyebrow">02</span><h2>{messages.analytics.weeklySummary}</h2></div>
        <article className="weekly-summary card">
          <Sparkles aria-hidden="true"/>
          {!visibleReport.dataComplete && visibleReport.aiStatus === 'completed' && visibleReport.aiWeeklySummary
            ? <div><span className="weekly-partial-summary-note">{messages.analytics.summaryAvailableReviews}</span><p>{visibleReport.aiWeeklySummary}</p></div>
            : !visibleReport.dataComplete
            ? <p>{messages.analytics.partialSummaryUnavailable}</p>
            : visibleReport.aiStatus === 'completed' && visibleReport.aiWeeklySummary
            ? <p>{visibleReport.aiWeeklySummary}</p>
            : <p>{visibleReport.aiStatus === 'failed' ? messages.analytics.summaryFailed : messages.analytics.generating}</p>}
        </article>
      </section>
    </div>}
  </>
}
