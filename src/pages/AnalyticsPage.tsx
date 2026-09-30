import { AlertTriangle, MessageSquareText, Sparkles, Star } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../app/AppContext'
import { BrandHeader } from '../components/ui/BrandHeader'
import { EstablishmentAvatar } from '../components/ui/EstablishmentAvatar'
import { useI18n } from '../i18n'
import {
  buildDemoHistoricalReport,
  formatHistoricalPeriodStart,
  mapHistoricalReport,
  type HistoricalReport,
  type HistoricalReportRow,
} from '../lib/historical-report'
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
interface GenerateHistoricalReportPayload { report?: HistoricalReportRow; error?: string }
type HistoricalFeedback = 'success' | 'error' | 'empty' | null
type PeriodMode = 'completed' | 'current' | 'historical'

export function AnalyticsPage() {
  const { reviews, establishments, demoMode, preferredLanguage } = useApp()
  const { messages, language } = useI18n()
  const [establishmentId, setEstablishmentId] = useState('')
  const [periodMode, setPeriodMode] = useState<PeriodMode>('completed')
  const [reports, setReports] = useState<Record<string, WeeklyReport>>({})
  const [historicalReports, setHistoricalReports] = useState<Record<string, HistoricalReport>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [requestVersion, setRequestVersion] = useState(0)
  const [historicalGenerating, setHistoricalGenerating] = useState(false)
  const [historicalFeedback, setHistoricalFeedback] = useState<HistoricalFeedback>(null)
  const requestedKeys = useRef(new Set<string>())
  const periodStart = useMemo(() => periodMode === 'current'
    ? currentVietnamWeekStart()
    : lastCompletedVietnamWeekStart(), [periodMode])

  const resolvedEstablishmentId = establishments.some((item) => item.id === establishmentId)
    ? establishmentId
    : establishments[0]?.id ?? ''
  const selected = establishments.find((item) => item.id === resolvedEstablishmentId)
  const reportCacheKey = selected && preferredLanguage && periodMode !== 'historical' ? `${selected.id}:${periodStart}:${preferredLanguage}:${periodMode}` : ''
  const cachedReport = reportCacheKey ? reports[reportCacheKey] : undefined
  const historicalCacheKey = selected && preferredLanguage ? `${selected.id}:${preferredLanguage}` : ''
  const cachedHistoricalReport = historicalCacheKey ? historicalReports[historicalCacheKey] : undefined
  const demoReport = useMemo(() => selected && preferredLanguage && demoMode
    && periodMode !== 'historical'
    ? buildDemoWeeklyReport(selected.id, reviews, preferredLanguage, selected.currentRating, selected.currentReviewCount, periodMode === 'current')
    : null,
  [demoMode, periodMode, preferredLanguage, reviews, selected])
  const demoHistoricalReport = useMemo(() => selected && preferredLanguage && demoMode && periodMode === 'historical'
    ? buildDemoHistoricalReport(selected.id, reviews, preferredLanguage, selected.currentRating, selected.currentReviewCount)
    : null,
  [demoMode, periodMode, preferredLanguage, reviews, selected])

  useEffect(() => {
    if (!selected || !preferredLanguage) return
    if (demoMode || !supabase) return
    const historical = periodMode === 'historical'
    if (historical ? cachedHistoricalReport : cachedReport) return
    const client = supabase
    const activeCacheKey = historical ? historicalCacheKey : reportCacheKey
    const requestKey = `${activeCacheKey}:${periodMode}:${requestVersion}`
    if (requestedKeys.current.has(requestKey)) return
    requestedKeys.current.add(requestKey)
    let active = true
    const load = async () => {
      setLoading(true)
      setError(null)
      setErrorKey(null)
      if (historical) {
        const { data, error: reportError } = await client
          .from('historical_establishment_reports')
          .select('*')
          .eq('establishment_id', selected.id)
          .eq('preferred_language', preferredLanguage)
          .maybeSingle()
        if (!active) return
        if (reportError) {
          console.error('Historical report load failed', reportError)
          setError(messages.analytics.historicalLoadFailed)
          setErrorKey(requestKey)
        } else if (data) {
          setHistoricalReports((current) => ({
            ...current,
            [historicalCacheKey]: mapHistoricalReport(data as HistoricalReportRow),
          }))
        }
      } else {
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
          setReports((current) => ({ ...current, [reportCacheKey]: mapWeeklyReport(data.report as WeeklyReportRow) }))
        }
      }
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [cachedHistoricalReport, cachedReport, demoMode, historicalCacheKey, messages.analytics.historicalLoadFailed, messages.analytics.loadFailed, periodMode, periodStart, preferredLanguage, reportCacheKey, requestVersion, selected])

  const generateHistoricalReport = async () => {
    if (!selected || !preferredLanguage || historicalGenerating) return
    setHistoricalFeedback(null)
    setHistoricalGenerating(true)
    try {
      if (demoMode) {
        if (!demoHistoricalReport || demoHistoricalReport.storedReviewsCount === 0) {
          setHistoricalFeedback('empty')
          return
        }
        setHistoricalReports((current) => ({ ...current, [historicalCacheKey]: demoHistoricalReport }))
        setHistoricalFeedback('success')
        return
      }
      if (!supabase) throw new Error('SUPABASE_UNAVAILABLE')
      const { data, error: functionError } = await supabase.functions.invoke<GenerateHistoricalReportPayload>('generate-historical-report', {
        body: { establishment_id: selected.id },
      })
      if (functionError) throw functionError
      if (data?.error === 'NO_REVIEWS_AVAILABLE') {
        setHistoricalFeedback('empty')
        return
      }
      if (data?.error === 'REPORT_GENERATION_IN_PROGRESS') return
      if (!data?.report) throw new Error(data?.error ?? 'HISTORICAL_REPORT_MISSING')
      setHistoricalReports((current) => ({
        ...current,
        [historicalCacheKey]: mapHistoricalReport(data.report as HistoricalReportRow),
      }))
      setHistoricalFeedback('success')
      window.setTimeout(() => setHistoricalFeedback((value) => value === 'success' ? null : value), 3500)
    } catch (generationError) {
      console.error('Historical report generation failed', generationError)
      setHistoricalFeedback('error')
    } finally {
      setHistoricalGenerating(false)
    }
  }

  const visibleReport = demoReport ?? cachedReport ?? null
  const visibleHistoricalReport = demoHistoricalReport ?? cachedHistoricalReport ?? null
  const currentRequestPrefix = periodMode === 'historical'
    ? `${historicalCacheKey}:${periodMode}:`
    : selected && preferredLanguage ? `${selected.id}:${periodStart}:${preferredLanguage}:${periodMode}:` : ''
  const visibleError = errorKey?.startsWith(currentRequestPrefix) ? error : null
  const periodLabel = visibleReport ? formatWeeklyPeriod(visibleReport.periodStart, visibleReport.periodEnd, language) : ''
  const number = new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'fr-FR')

  return <>
    <BrandHeader />
    <section className="reference-intro analytics-intro">
      <h1>{periodMode === 'historical' ? messages.analytics.historicalAnalysis : messages.analytics.weeklyTitle}</h1>
      <p>{messages.analytics.weeklyIntro}</p>
    </section>
    {establishments.length > 0 && <div className="analytics-filters weekly-report-filter">
      <label htmlFor="weekly-establishment">{messages.analytics.establishmentLabel}</label>
      <select id="weekly-establishment" value={resolvedEstablishmentId} onChange={(event) => setEstablishmentId(event.target.value)}>
        {establishments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <label htmlFor="weekly-period-mode">{messages.analytics.periodLabel}</label>
      <select id="weekly-period-mode" value={periodMode} onChange={(event) => setPeriodMode(event.target.value as PeriodMode)}>
        <option value="current">{messages.analytics.currentWeek}</option>
        <option value="completed">{messages.analytics.completedWeek}</option>
        <option value="historical">{messages.analytics.historicalMode}</option>
      </select>
    </div>}

    {!establishments.length && <section className="weekly-report-state card"><p>{messages.analytics.noEstablishment}</p></section>}
    {loading && <section className="weekly-report-state card" aria-live="polite"><span className="weekly-report-spinner"/><p>{messages.analytics.generating}</p></section>}
    {visibleError && <section className="weekly-report-state card" role="alert"><AlertTriangle/><p>{visibleError}</p><button className="secondary-button" onClick={() => setRequestVersion((value) => value + 1)}>{messages.common.retry}</button></section>}

    {selected && periodMode === 'historical' && <div className="weekly-report historical-report">
      <section className="weekly-report-hero card">
        <EstablishmentAvatar id={selected.id} name={selected.name} photoUrl={selected.photoUrl} large />
        <div>
          <div className="weekly-report-label"><span className="eyebrow">{messages.analytics.historicalAnalysis}</span></div>
          <h2>{selected.name}</h2>
          <p className="weekly-period">{visibleHistoricalReport ? formatHistoricalPeriodStart(visibleHistoricalReport.periodStart, language) : messages.analytics.historicalMode}</p>
          <div className="weekly-google-metrics">
            <strong>{(visibleHistoricalReport?.googleRating ?? selected.currentRating) === null ? '—' : (visibleHistoricalReport?.googleRating ?? selected.currentRating).toLocaleString(language === 'vi' ? 'vi-VN' : 'fr-FR', { maximumFractionDigits: 1 })} <Star aria-hidden="true"/></strong>
            <span>{(visibleHistoricalReport?.googleTotalReviews ?? selected.currentReviewCount) === null ? messages.analytics.snapshotUnavailable : `${number.format(visibleHistoricalReport?.googleTotalReviews ?? selected.currentReviewCount)} ${messages.analytics.googleReviews}`}</span>
          </div>
        </div>
      </section>

      <div className="historical-report-action">
        <button className="primary-button historical-generate-button" type="button" onClick={() => void generateHistoricalReport()} disabled={historicalGenerating}>
          {historicalGenerating ? <span className="weekly-report-spinner" aria-hidden="true"/> : <Sparkles aria-hidden="true"/>}
          <span>{historicalGenerating ? messages.analytics.generatingHistorical : messages.analytics.generateHistorical}</span>
        </button>
        {visibleHistoricalReport?.generatedAt && <small>{messages.analytics.updatedAt}: {new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'fr-FR', {
          timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
        }).format(new Date(visibleHistoricalReport.generatedAt))}</small>}
        {historicalFeedback === 'success' && <p className="historical-feedback success" role="status">{messages.analytics.historicalUpdated}</p>}
        {historicalFeedback === 'empty' && <p className="historical-feedback" role="status">{messages.analytics.historicalNoData}</p>}
        {historicalFeedback === 'error' && <p className="historical-feedback error" role="alert">{messages.analytics.historicalGenerationFailed}</p>}
      </div>

      {visibleHistoricalReport && <>
        {!visibleHistoricalReport.dataComplete && <section className="weekly-data-warning historical-data-warning card" role="status">
          <AlertTriangle aria-hidden="true"/>
          <div><strong>{messages.analytics.historicalDataPartial}</strong><p>{visibleHistoricalReport.storedReviewsCount === 500
            && (visibleHistoricalReport.googleTotalReviews ?? 0) > 500
            ? messages.analytics.historicalRecentSample
            : messages.analytics.historicalDataPartialDetail}</p></div>
        </section>}

        <section className="weekly-section">
          <div className="weekly-section-heading"><span className="eyebrow">01</span><h2>{messages.analytics.overview}</h2></div>
          <div className="weekly-kpis">
            <article className="weekly-kpi card"><MessageSquareText/><strong>{visibleHistoricalReport.storedReviewsCount}</strong><span>{messages.analytics.storedReviews}</span></article>
            <article className="weekly-kpi card negative"><AlertTriangle/><strong>{visibleHistoricalReport.negativeReviewsCount}</strong><span>{messages.analytics.negativeReviews}</span></article>
            <article className="weekly-kpi card"><span className="weekly-percent">%</span><strong>{visibleHistoricalReport.negativeRate.toLocaleString(language === 'vi' ? 'vi-VN' : 'fr-FR', { maximumFractionDigits: 1 })} %</strong><span>{visibleHistoricalReport.dataComplete ? messages.analytics.negativeRate : messages.analytics.rateAvailableData}</span></article>
            <article className="weekly-kpi card ready"><Sparkles/><strong>{visibleHistoricalReport.readyRepliesCount}</strong><span>{messages.analytics.readyReplies}</span></article>
          </div>
        </section>

        <section className="weekly-section historical-rating-section">
          <div className="weekly-section-heading"><span className="eyebrow">02</span><h2>{messages.analytics.starDistribution}</h2></div>
          <article className="historical-rating-card card">
            {([1, 2, 3, 4, 5] as const).map((rating) => {
              const count = visibleHistoricalReport.ratingCounts[rating]
              const percentage = visibleHistoricalReport.storedReviewsCount ? count / visibleHistoricalReport.storedReviewsCount * 100 : 0
              return <div className="historical-rating-row" key={rating}>
                <strong>{rating}★</strong>
                <span className="historical-rating-track"><i style={{ width: `${percentage}%` }}/></span>
                <b>{count}</b>
              </div>
            })}
          </article>
        </section>

        <section className="weekly-section">
          <div className="weekly-section-heading"><span className="eyebrow">03</span><h2>{messages.analytics.historicalSummary}</h2></div>
          <article className="weekly-summary card">
            <Sparkles aria-hidden="true"/>
            <p>{visibleHistoricalReport.aiHistoricalSummary
              ?? (visibleHistoricalReport.aiStatus === 'failed' ? messages.analytics.summaryFailed : messages.analytics.generating)}</p>
          </article>
        </section>
      </>}
    </div>}

    {selected && periodMode !== 'historical' && visibleReport && <div className="weekly-report">
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
