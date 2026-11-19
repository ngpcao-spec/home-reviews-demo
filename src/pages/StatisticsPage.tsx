import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import { ChevronRight, MessageSquare } from 'lucide-react'
import { useApp } from '../app/AppContext'
import { useI18n } from '../i18n'
import { statisticsMessages } from '../i18n/statistics'
import { adjacentBuckets, periods, readStatistics, readStatisticReviews, type Statistics, type StatisticsPeriod, type ReviewFilter, type ReviewPage, type StatisticsReview } from '../lib/restaurant-statistics'

type Labels = typeof statisticsMessages.fr | typeof statisticsMessages.vi
export function StatisticsPage() {
  const { establishments, currentUser, demoMode } = useApp()
  const { language } = useI18n()
  const t = statisticsMessages[language]
  const [params, setParams] = useSearchParams()
  const id = establishments.find(e => e.id === params.get('establishment'))?.id ?? establishments[0]?.id ?? ''
  const period = periods.includes(params.get('period') as StatisticsPeriod) ? params.get('period') as StatisticsPeriod : '3m'
  const change = (key: string, value: string) => { const next = new URLSearchParams(params); next.set(key, value); setParams(next) }
  const result = useQuery({ queryKey: ['restaurant-statistics', currentUser.id ?? currentUser.email, language, id, period],
    enabled: Boolean(id) && !demoMode, retry: false, staleTime: 0, refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => { const data = await readStatistics(id, period, signal); if (data.language !== language || data.establishment_id !== id || data.period !== period) throw new Error('CONTEXT_CHANGED'); return data },
  })
  return <section className="statistics-page">
    <h1>{t.title}</h1>
    {establishments.length > 1 ? <label className="statistics-restaurant"><span className="sr-only">{t.restaurant}</span><select aria-label={t.restaurant} value={id} onChange={e => change('establishment', e.target.value)}>{establishments.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label> : <p className="statistics-restaurant">{establishments[0]?.name ?? t.noRestaurant}</p>}
    {id && <><div className="statistics-periods" aria-label={language === 'fr' ? 'Période' : 'Khoảng thời gian'}>{periods.map((p, i) => <button key={p} aria-pressed={period === p} onClick={() => change('period', p)}>{t.periods[i]}</button>)}</div>
      {result.isPending && !demoMode && <p role="status">{t.loading}</p>}
      {(result.isError || demoMode) && <p role="alert">{t.error} <button className="statistics-link" onClick={() => void result.refetch()}>{t.retry}</button></p>}
      {result.data && <StatisticsContent key={`${currentUser.id}:${language}:${id}:${period}:${result.data.as_of}`} data={result.data} t={t} language={language} account={currentUser.id ?? currentUser.email} />}
    </>}
  </section>
}
function StatisticsContent({ data: d, t, language, account }: { data: Statistics; t: Labels; language: 'fr' | 'vi'; account: string }) {
  const [view, setView] = useState<'main' | 'topics' | ReviewFilter>('main')
  const locale = language === 'fr' ? 'fr-FR' : 'vi-VN'
  const number = (n: number | null, digits = 0) => n === null ? '—' : new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n)
  const date = (s: string | null) => s ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: language === 'vi' ? '2-digit' : 'short', year: 'numeric', timeZone: s.length === 10 ? 'UTC' : d.timezone }).format(new Date(s.length === 10 ? `${s}T12:00:00Z` : s)) : '—'
  const delta = (value: number | null | undefined, unit: string, reverse = false) => !d.comparison?.reliable ? null : <span className={value != null && (reverse ? value < 0 : value > 0) ? 'statistics-good' : 'statistics-muted'}>{value == null ? t.noVariation : `${value > 0 ? '+' : ''}${number(value, 1)}${unit}`}</span>
  return <>
    <div className="statistics-dates"><strong>{date(d.start_date)} – {date(d.end_date)}</strong><small>{t.retained}</small></div>
    {view !== 'main' && <button className="statistics-link statistics-back" onClick={() => setView('main')}>← {t.back}</button>}
    {typeof view === 'object' ? <StatisticsReviews key={JSON.stringify(view)} data={d} filter={view} t={t} language={language} account={account} /> : view === 'topics' ? <section className="statistics-panel statistics-topics">
      <h2>{t.topics}</h2><p>{number(d.topics.analyzed)} / {number(d.topics.text_count)} {t.analyzed}</p>
      {d.topics.analyzed === 0 ? <p>{t.noTopics}</p> : d.topics.items.map(topic => <div className="statistics-topic" key={topic.key}><h3>{t[topic.key]}</h3><button onClick={() => setView({ topic: topic.key, polarity: 'positive' })}>{t.positive} <strong>{number(topic.positive)}</strong></button><button onClick={() => setView({ topic: topic.key, polarity: 'negative' })}>{t.negative} <strong>{number(topic.negative)}</strong></button></div>)}
      <p className="statistics-muted">{t.topicHelp}</p>
    </section> : <>
      {!d.coverage.complete && <p className="statistics-coverage">{t.partial}</p>}
      <div className="statistics-metrics">
        <button onClick={() => setView({})}><span>{t.count}</span><strong>{number(d.metrics.count)}</strong>{delta(d.comparison?.count_change, ' %')}</button>
        <button onClick={() => setView({})}><span>{t.average}</span><strong>{number(d.metrics.average, 1)}<small> / 5</small></strong>{delta(d.comparison?.average_change, '')}</button>
        <button onClick={() => setView({ ratings: [1, 2, 3] })}><span>{t.low}</span><strong>{number(d.metrics.low_percent, 1)}<small> %</small></strong><small>{number(d.metrics.low_count)} {t.reviews}</small>{delta(d.comparison?.low_percent_change, ` ${t.points}`, true)}</button>
      </div>
      {d.comparison?.reliable && <p className="statistics-comparison">{t.comparison} · {date(d.comparison.previous_start)} – {date(d.comparison.previous_end)}</p>}
      {d.metrics.count === 0 && <p role="status">{t.empty}</p>}
      <section className="statistics-panel"><h2>{t.evolving}</h2><p className="statistics-muted">{t.receivedMean}</p><RatingChart data={d} locale={locale} t={t} /></section>
      <section className="statistics-panel statistics-distribution"><h2>{t.distribution}</h2>{d.distribution.map(row => <button key={row.rating} onClick={() => setView({ ratings: [row.rating] })} aria-label={`${row.rating} ★ : ${number(row.count)} ${t.reviews}`}><span>{row.rating} ★</span><span className="statistics-track"><span className={row.rating >= 4 ? 'statistics-bar' : 'statistics-bar statistics-low'} style={{ width: `${100 * row.count / Math.max(1, ...d.distribution.map(v => v.count))}%` }} /></span><strong>{number(row.count)}</strong></button>)}</section>
      <button className="statistics-topic-entry statistics-panel" onClick={() => setView('topics')}><MessageSquare aria-hidden="true" /><span><strong>{t.topics}</strong><small>{t.topicHint}</small></span><ChevronRight aria-hidden="true" /></button>
    </>}
    <details className="statistics-help"><summary>{t.help}</summary><p>{t.explanation}</p>{d.comparison && !d.comparison.reliable && <p>{t.noComparison}</p>}<dl>{d.coverage.history_started_at && <><dt>{t.historyStart}</dt><dd>{date(d.coverage.history_started_at)}</dd></>}<dt>{t.history}</dt><dd>{number(d.coverage.stored)}</dd><dt>{t.google}</dt><dd>{number(d.coverage.google_total)}</dd><dt>{t.range}</dt><dd>{date(d.coverage.first_date)} – {date(d.coverage.last_date)}</dd><dt>{t.excluded}</dt><dd>{number(d.coverage.excluded)}</dd><dt>{t.time}</dt><dd>{d.timezone}</dd></dl></details>
  </>
}
function RatingChart({ data, locale, t }: { data: Statistics; locale: string; t: Labels }) {
  const rows = data.series
  if (!rows.length) return <p>{t.empty}</p>
  const number = (n: number) => n.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const shortDate = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString(locale, { day: data.bucket === 'week' ? 'numeric' : undefined, month: 'short', timeZone: 'UTC' })
  const times = rows.map(r => Date.parse(r.date)), first = times[0], last = times.at(-1)!
  const minimum = Math.max(1, Math.min(...rows.map(r => r.average)) - 0.25), maximum = Math.min(5, Math.max(...rows.map(r => r.average)) + 0.25)
  const x = (i: number) => first === last ? 180 : 40 + 285 * (times[i] - first) / (last - first)
  const y = (n: number) => 152 - 122 * (n - minimum) / Math.max(0.1, maximum - minimum)
  const labelIndexes = new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])
  return <><svg className="statistics-chart" viewBox="0 0 360 190" role="img" aria-label={t.evolving}>
    {[0, 1, 2, 3].map(i => { const n = minimum + (maximum - minimum) * i / 3; return <g key={i}><line x1="40" x2="335" y1={y(n)} y2={y(n)} className="statistics-grid" /><text x="32" y={y(n) + 4} textAnchor="end">{number(n)}</text></g> })}
    {rows.map((r, i) => <g key={r.date}>{i > 0 && adjacentBuckets(rows[i - 1].date, r.date, data.bucket) && <line x1={x(i - 1)} y1={y(rows[i - 1].average)} x2={x(i)} y2={y(r.average)} className="statistics-line" />}<circle cx={x(i)} cy={y(r.average)} r="3.5"><title>{r.date} : {number(r.average)} / 5 · {r.count}</title></circle>{labelIndexes.has(i) && <><text x={x(i)} y={y(r.average) - 10} textAnchor="middle" className="statistics-point-label">{number(r.average)}</text><text x={x(i)} y="177" textAnchor="middle">{shortDate(r.date)}</text></>}</g>)}
  </svg><details className="statistics-values"><summary>{t.values}</summary><table><tbody>{rows.map(r => <tr key={r.date}><th>{r.date}</th><td>{number(r.average)} / 5</td><td>{r.count} {t.reviews}</td></tr>)}</tbody></table></details></>
}
function StatisticsReviews({ data, filter, t, language, account }: { data: Statistics; filter: ReviewFilter; t: Labels; language: 'fr' | 'vi'; account: string }) {
  const query = useInfiniteQuery({ queryKey: ['statistic-reviews', account, language, data.establishment_id, data.period, filter, data.as_of], initialPageParam: null as ReviewPage['next'],
    queryFn: async ({ pageParam, signal }) => { const result = await readStatisticReviews(data.establishment_id, data.period, filter, pageParam, signal); if (result.language !== language) throw new Error('CONTEXT_CHANGED'); return result },
    getNextPageParam: last => last.next ?? undefined, retry: false, enabled: true, refetchOnWindowFocus: false,
  })
  return <section className="statistics-reviews"><h2>{t.list}{filter.ratings ? ` · ${filter.ratings.join(', ')} ★` : filter.topic ? ` · ${t[filter.topic]} · ${filter.polarity === 'positive' ? t.positive : t.negative}` : ''}</h2>
    {query.data && <p>{query.data.pages[0].total} {t.reviews} {t.total}</p>}
    {query.isPending && <p role="status">{t.loading}</p>}
    {query.isError && <p role="alert">{t.reviewError} <button onClick={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())}>{t.retry}</button></p>}
    {query.data?.pages[0].total === 0 && <p>{t.empty}</p>}
    {query.data?.pages.flatMap(p => p.items).map(r => <StatisticReview key={r.source_id} review={r} t={t} language={language} timezone={data.timezone} />)}
    {query.hasNextPage && <button className="statistics-more" disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>{query.isFetching ? t.loading : t.more}</button>}
  </section>
}
function StatisticReview({ review: r, t, language, timezone }: { review: StatisticsReview; t: Labels; language: string; timezone: string }) {
  const [original, setOriginal] = useState(false)
  const safeUrl = r.review_url && /^https:\/\/(?:www\.)?google\.[a-z.]+\//i.test(r.review_url) ? r.review_url : null
  return <article className="statistics-panel statistics-review"><div><strong>{r.rating} ★</strong><time dateTime={r.published_at}>{new Date(r.published_at).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'vi-VN', { timeZone: timezone, day: 'numeric', month: 'short', year: 'numeric' })}</time></div>
    {r.author_name && <h3>{r.author_name}</h3>}<p>{(original ? r.original_text : r.display_text)?.trim() ? (original ? r.original_text : r.display_text) : t.noText}</p>
    {r.translated && <><small>{t.translated}</small><button className="statistics-link" onClick={() => setOriginal(!original)}>{original ? t.translation : t.original}</button></>}
    {safeUrl && <a href={safeUrl} target="_blank" rel="noopener noreferrer">{t.source}</a>}
  </article>
}
