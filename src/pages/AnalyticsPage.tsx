import { AlertTriangle, MessageSquareText, Sparkles, Star } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useSearchParams } from 'react-router-dom'
import { analyticsSession, resolveAnalyticsSelection, type AnalyticsMode, type AnalyticsSelection } from '../lib/analytics-cache'
import { useAnalyticsScroll } from '../lib/use-analytics-scroll'
import { useApp } from '../app/AppContext'
import { ReputationReport } from '../components/ReputationReport'
import { ConsultantReport } from '../components/ConsultantReport'
import { BrandHeader } from '../components/ui/BrandHeader'
import { EstablishmentAvatar } from '../components/ui/EstablishmentAvatar'
import { useI18n } from '../i18n'
import {
  buildDemoHistoricalReport,
  formatHistoricalGeneratedAt,
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
interface GenerateHistoricalReportPayload { report?: HistoricalReportRow; error?: string; pending?: boolean; generation_id?: string; progress?: number; total_steps?: number }
type HistoricalFeedback = 'success' | 'error' | 'empty' | null
export function AnalyticsPage() {
  const { reviews, establishments, demoMode, preferredLanguage, currentUser } = useApp()
  const { messages, language } = useI18n()
  const cache = analyticsSession(currentUser.id ?? currentUser.email)
  const snapshot = useSyncExternalStore(cache.subscribe,cache.getSnapshot)
  const [searchParams,setSearchParams] = useSearchParams()
  const pendingSelection=useRef<AnalyticsSelection | null>(null)
  const selection=resolveAnalyticsSelection(searchParams,snapshot.selection,establishments.map(item=>item.id))
  const {establishmentId:resolvedEstablishmentId,mode:periodMode}=selection
  const [requestVersion, setRequestVersion] = useState(0)
  const [historicalProgress, setHistoricalProgress] = useState('')
  const [historicalGenerating, setHistoricalGenerating] = useState(false)
  const [historicalFeedback, setHistoricalFeedback] = useState<HistoricalFeedback>(null)
  const historicalGenerationLock = useRef(false)
  const periodStart = useMemo(() => periodMode === 'current'
    ? currentVietnamWeekStart()
    : lastCompletedVietnamWeekStart(), [periodMode])

  const selected = establishments.find((item) => item.id === resolvedEstablishmentId)
  const reportCacheKey = selected && preferredLanguage && periodMode !== 'historical' ? `weekly:${selected.id}:${periodStart}:${preferredLanguage}:${periodMode}` : ''
  const cachedReport = snapshot.entries[reportCacheKey]?.report as WeeklyReport | null | undefined
  const historicalCacheKey = selected && preferredLanguage ? `historical:${selected.id}:${preferredLanguage}` : ''
  const cachedHistoricalReport = snapshot.entries[historicalCacheKey]?.report as HistoricalReport | null | undefined
  const activeCacheKey=periodMode==='historical'?historicalCacheKey:reportCacheKey
  const activeEntry=snapshot.entries[activeCacheKey]
  const loading=!demoMode && Boolean(activeEntry?.loading && !activeEntry.report)
  const visibleError=activeEntry?.error && !activeEntry.report ? periodMode==='historical'?messages.analytics.historicalLoadFailed:messages.analytics.loadFailed : null
  useEffect(()=>{
    if(!resolvedEstablishmentId) return
    if(pendingSelection.current) {
      if(pendingSelection.current.establishmentId!==resolvedEstablishmentId || pendingSelection.current.mode!==periodMode) return
      pendingSelection.current=null
    }
    cache.setSelection({establishmentId:resolvedEstablishmentId,mode:periodMode})
    if(searchParams.get('establishment')===resolvedEstablishmentId && searchParams.get('mode')===periodMode) return
    const next=new URLSearchParams(searchParams)
    next.set('establishment',resolvedEstablishmentId);next.set('mode',periodMode)
    setSearchParams(next,{replace:true})
  },[cache,resolvedEstablishmentId,periodMode,searchParams,setSearchParams])
  const changeSelection=(patch:Partial<AnalyticsSelection>)=>{
    const nextSelection={...(pendingSelection.current ?? selection),...patch}
    pendingSelection.current=nextSelection
    cache.setSelection(nextSelection)
    const next=new URLSearchParams(searchParams)
    next.set('establishment',nextSelection.establishmentId);next.set('mode',nextSelection.mode)
    setSearchParams(next)
  }
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
    if (!resolvedEstablishmentId || !preferredLanguage || demoMode || !supabase) return
    const historical = periodMode === 'historical'
    const client = supabase
    const readReport=async()=>{
      if (historical) {
        const { data, error: reportError } = await client
          .from('historical_establishment_reports')
          .select('*')
          .eq('establishment_id', resolvedEstablishmentId)
          .eq('preferred_language', preferredLanguage)
          .maybeSingle()
        if(reportError) throw reportError
        return {report:data?mapHistoricalReport(data as HistoricalReportRow):null,revision:data?.updated_at ?? data?.generated_at ?? ''}
      }
      const {data,error:functionError}=await client.functions.invoke<GenerateWeeklyReportPayload>('generate-weekly-report',{
        body:periodMode==='current'?{establishment_id:resolvedEstablishmentId,provisional:true}:{establishment_id:resolvedEstablishmentId,period_start:periodStart},
      })
      if(functionError || !data?.report) throw functionError ?? new Error('REPORT_MISSING')
      return {report:mapWeeklyReport(data.report),revision:data.report.generated_at ?? ''}
    }
    void cache.load(activeCacheKey,readReport,{force:requestVersion>0,revalidate:historical})
    // A foreground return may only READ a historical report, never generate one.
    const refresh=()=>{
      if(historical && document.visibilityState==='visible') void cache.load(activeCacheKey,readReport,{revalidate:true})
    }
    const online=()=>{if(historical) void cache.load(activeCacheKey,readReport,{force:true,revalidate:true})}
    window.addEventListener('focus',refresh)
    document.addEventListener('visibilitychange',refresh)
    window.addEventListener('online',online)
    return ()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('online',online)}
  }, [cache,activeCacheKey,demoMode,periodMode,periodStart,preferredLanguage,requestVersion,resolvedEstablishmentId])

  const generateHistoricalReport = async () => {
    if (!selected || !preferredLanguage || historicalGenerationLock.current) return
    historicalGenerationLock.current = true
    setHistoricalFeedback(null)
    setHistoricalGenerating(true)
    setHistoricalProgress('')
    try {
      if (demoMode) {
        if (!demoHistoricalReport || demoHistoricalReport.storedReviewsCount === 0) {
          setHistoricalFeedback('empty')
          return
        }
        cache.put(historicalCacheKey,demoHistoricalReport)
        setHistoricalFeedback('success')
        return
      }
      if (!supabase) throw new Error('SUPABASE_UNAVAILABLE')
      let data: GenerateHistoricalReportPayload | null = null
      let generationId: string | undefined
      do {
        const response = await supabase.functions.invoke<GenerateHistoricalReportPayload>('generate-historical-report', {
          body: { establishment_id: selected.id, ...(generationId ? { generation_id: generationId } : { force: true }) },
        })
        if (response.error) throw response.error
        data = response.data
        if (data?.pending) {
          if (!data.generation_id) throw new Error('REPORT_GENERATION_ID_MISSING')
          generationId = data.generation_id
          if (data.total_steps) setHistoricalProgress(messages.reputation.progress.replace('{done}', String(data.progress ?? 0)).replace('{total}', String(data.total_steps)))
          await new Promise(resolve => window.setTimeout(resolve, 1500))
        }
      } while (data?.pending)
      if (data?.error === 'NO_REVIEWS_AVAILABLE') {
        setHistoricalFeedback('empty')
        return
      }
      if (data?.error === 'REPORT_GENERATION_IN_PROGRESS') return
      if (!data?.report) throw new Error(data?.error ?? 'HISTORICAL_REPORT_MISSING')
      cache.put(historicalCacheKey,mapHistoricalReport(data.report as HistoricalReportRow))
      setHistoricalFeedback('success')
      window.setTimeout(() => setHistoricalFeedback((value) => value === 'success' ? null : value), 3500)
    } catch (generationError) {
      console.error('Historical report generation failed', generationError)
      setHistoricalFeedback('error')
    } finally {
      historicalGenerationLock.current = false
      setHistoricalGenerating(false)
    }
  }

  const visibleReport = demoReport ?? cachedReport ?? null
  const visibleHistoricalReport = demoHistoricalReport ?? cachedHistoricalReport ?? null
  useAnalyticsScroll(cache,selected?`${selected.id}:${periodMode}:${preferredLanguage}`:'',Boolean(periodMode==='historical'?visibleHistoricalReport:visibleReport))
  const periodLabel = visibleReport ? formatWeeklyPeriod(visibleReport.periodStart, visibleReport.periodEnd, language) : ''
  const number = new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'fr-FR')

  return <>
    <BrandHeader />
    <section className="reference-intro analytics-intro">
      <h1>{periodMode === 'historical' ? messages.analytics.historicalAnalysis : messages.analytics.weeklyTitle}</h1>
      <p>{periodMode === 'historical' ? messages.reputation.intro : messages.analytics.weeklyIntro}</p>
    </section>
    {establishments.length > 0 && <div className="analytics-filters weekly-report-filter">
      <label htmlFor="weekly-establishment">{messages.analytics.establishmentLabel}</label>
      <select id="weekly-establishment" value={resolvedEstablishmentId} onChange={(event) => changeSelection({establishmentId:event.target.value})}>
        {establishments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <label htmlFor="weekly-period-mode">{messages.analytics.periodLabel}</label>
      <select id="weekly-period-mode" value={periodMode} onChange={(event) => changeSelection({mode:event.target.value as AnalyticsMode})}>
        <option value="current">{messages.analytics.currentWeek}</option>
        <option value="completed">{messages.analytics.completedWeek}</option>
        <option value="historical">{messages.analytics.historicalMode}</option>
      </select>
    </div>}

    {!establishments.length && <section className="weekly-report-state card"><p>{messages.analytics.noEstablishment}</p></section>}
    {loading && <section className="weekly-report-state card" data-testid="analytics-initial-loading" aria-live="polite"><span className="weekly-report-spinner"/><p>{messages.reputation.loadingReport}</p></section>}
    {visibleError && <section className="weekly-report-state card" role="alert"><AlertTriangle/><p>{visibleError}</p><button className="secondary-button" onClick={() => setRequestVersion((value) => value + 1)}>{messages.common.retry}</button></section>}

    {selected && periodMode === 'historical' && <div className="weekly-report historical-report">
      <section className="weekly-report-hero card">
        {!visibleHistoricalReport?.consultant && <EstablishmentAvatar id={selected.id} name={selected.name} photoUrl={selected.photoUrl} large />}
        <div>
          <div className="weekly-report-label"><span className="eyebrow">{messages.analytics.historicalAnalysis}</span></div>
          {!visibleHistoricalReport?.consultant && <h2>{selected.name}</h2>}
          <p className="weekly-period">{visibleHistoricalReport ? `${formatHistoricalPeriodStart(visibleHistoricalReport.periodStart, language)} ${messages.reputation.until} ${new Date(visibleHistoricalReport.periodEnd).toLocaleDateString(language === 'vi' ? 'vi-VN' : 'fr-FR', {timeZone:'Asia/Ho_Chi_Minh'})}` : messages.analytics.historicalMode}</p>
          {!visibleHistoricalReport?.consultant && <div className="weekly-google-metrics">
            <strong>{(visibleHistoricalReport?.googleRating ?? selected.currentRating) === null ? '—' : (visibleHistoricalReport?.googleRating ?? selected.currentRating).toLocaleString(language === 'vi' ? 'vi-VN' : 'fr-FR', { maximumFractionDigits: 1 })} <Star aria-hidden="true"/></strong>
            <span>{(visibleHistoricalReport?.googleTotalReviews ?? selected.currentReviewCount) === null ? messages.analytics.snapshotUnavailable : `${number.format(visibleHistoricalReport?.googleTotalReviews ?? selected.currentReviewCount)} ${messages.analytics.googleReviews}`}</span>
          </div>}
          {visibleHistoricalReport?.reputation && <div className="reputation-sample-note">
            <p>{(visibleHistoricalReport.dataComplete ? messages.reputation.complete
              : messages.reputation.recent)
              .replace('{count}', number.format(visibleHistoricalReport.storedReviewsCount))}</p>
            {!visibleHistoricalReport.dataComplete && <small>{messages.reputation.partial}</small>}
            {visibleHistoricalReport.reputation.source_undated_count > 0 && <p>{messages.reputation.undated.replace('{count}',String(visibleHistoricalReport.reputation.source_undated_count))}</p>}
          </div>}

        </div>
      </section>

      <div className="historical-report-action">
        <button className="primary-button historical-generate-button" type="button" onClick={() => void generateHistoricalReport()} disabled={historicalGenerating}>
          {historicalGenerating ? <span className="weekly-report-spinner" aria-hidden="true"/> : <Sparkles aria-hidden="true"/>}
          <span>{historicalGenerating ? messages.analytics.generatingHistorical : visibleHistoricalReport?.reputation || visibleHistoricalReport?.consultant ? messages.reputation.regenerate : messages.analytics.generateHistorical}</span>
        </button>
        {historicalGenerating && historicalProgress && <small role="status">{historicalProgress}</small>}
        {visibleHistoricalReport?.generatedAt && <small>{messages.reputation.lastUpdated}: {formatHistoricalGeneratedAt(visibleHistoricalReport.generatedAt)}</small>}
        {historicalFeedback === 'success' && <p className="historical-feedback success" role="status">{messages.analytics.historicalUpdated}</p>}
        {historicalFeedback === 'empty' && <p className="historical-feedback" role="status">{messages.analytics.historicalNoData}</p>}
        {historicalFeedback === 'error' && <p className="historical-feedback error" role="alert">{messages.analytics.historicalGenerationFailed}</p>}
      </div>

      {visibleHistoricalReport && (visibleHistoricalReport.consultant ? <ConsultantReport report={visibleHistoricalReport.consultant}/> : <ReputationReport report={visibleHistoricalReport} />)}

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
