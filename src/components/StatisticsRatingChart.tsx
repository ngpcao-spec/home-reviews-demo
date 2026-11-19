import { useId, useState } from 'react'
import type { Statistics } from '../lib/restaurant-statistics'
import type { statisticsMessages } from '../i18n/statistics'

type Labels = typeof statisticsMessages.fr | typeof statisticsMessages.vi
const day = 86_400_000
const stamp = (value: string) => Date.parse(value + 'T00:00:00Z')
function nextBucket(value: number, bucket: Statistics['bucket']) {
  const date = new Date(value)
  if (bucket === 'week') date.setUTCDate(date.getUTCDate() + 7)
  else date.setUTCMonth(date.getUTCMonth() + 1)
  return date.getTime()
}

// Presentation scale only: counts and averages always come from the same row.
// Integer ticks start at zero, including when the largest count is only one.
function countScale(maximum: number) {
  const rough = maximum / 4
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, rough)))
  const step = [1, 2, 5, 10].find(value => value * magnitude >= rough)! * magnitude
  const ceiling = Math.ceil(maximum / step) * step
  return { ceiling, ticks: Array.from({ length: ceiling / step + 1 }, (_, i) => i * step) }
}

export function StatisticsRatingChart({ data, locale, t }: { data: Statistics; locale: string; t: Labels }) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const detailId = useId()
  const rows = data.series.filter(row => row.count > 0).sort((a, b) => a.date.localeCompare(b.date))
  if (!rows.length) return <p>{t.chartEmpty}</p>
  const start = stamp(data.start_date ?? rows[0].date), end = stamp(data.end_date) + day
  const left = 40, right = 306, top = 32, bottom = 182
  const barWidth = Math.min(30, (right - left) / rows.length * 0.6)
  const firstX = left + barWidth / 2, lastX = right - barWidth / 2
  const x = (index: number) => rows.length === 1 ? (left + right) / 2 : firstX + (lastX - firstX) * index / (rows.length - 1)
  const spacing = rows.length === 1 ? 60 : (lastX - firstX) / (rows.length - 1)
  const radius = Math.min(4, spacing / 3)
  const y = (value: number) => bottom - (bottom - top) * (value - 1) / 4
  const scale = countScale(Math.max(...rows.map(row => row.count)))
  const countY = (value: number) => bottom - (bottom - top) * value / scale.ceiling
  const number = (value: number) => value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const count = (value: number) => value.toLocaleString(locale)
  const date = (value: number, year = false) => new Date(value).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: year ? 'numeric' : undefined, timeZone: 'UTC' })
  const interval = (from: number, to: number, year = false) => `${date(from, year)} – ${date(to - day, year)}`
  const points = rows.map((row, i) => {
    const from = Math.max(start, stamp(row.date)), to = Math.min(end, nextBucket(stamp(row.date), data.bucket))
    return { ...row, from, to, x: x(i) }
  })
  const selected = points.find(point => point.date === selectedDate)
  const labelIndexes = new Set<number>()
  for (const i of [0, Math.floor((rows.length - 1) / 2), rows.length - 1]) {
    if ([...labelIndexes].every(other => Math.abs(points[other].x - points[i].x) >= 45)) labelIndexes.add(i)
  }
  // Thin labels, never observations. Every date/value remains available by touch,
  // keyboard and in the table. No empty calendar buckets occupy horizontal space.
  const ticks = [0]
  const multipleYears = points[0].date.slice(0, 4) !== points[points.length - 1].date.slice(0, 4)
  const tickGap = data.bucket === 'week' ? 56 : multipleYears ? 120 : 64
  for (let i = 1; i < points.length - 1; i++) {
    if (x(i) - x(ticks[ticks.length - 1]) >= tickGap && x(points.length - 1) - x(i) >= tickGap) ticks.push(i)
  }
  if (points.length > 1) ticks.push(points.length - 1)
  const tickDate = (value: string) => new Date(stamp(value)).toLocaleDateString(locale, data.bucket === 'week'
    ? { day: '2-digit', month: '2-digit', timeZone: 'UTC' }
    : { month: 'short', year: multipleYears ? 'numeric' : undefined, timeZone: 'UTC' })

  return <>
    <div className="statistics-chart-legend">
      <span><i className="statistics-legend-rating" aria-hidden="true" />{t.average}</span>
      <span><i className="statistics-legend-count" aria-hidden="true" />{t.chartCount}</span>
    </div>
    <svg className="statistics-chart" viewBox="0 0 360 224" role="group" aria-label={`${t.evolving}. ${data.bucket === 'week' ? t.weeklyMean : t.monthlyMean}`}>
      <g aria-hidden="true">
        {[1, 2, 3, 4, 5].map(value => <g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} className="statistics-grid" /><text className="statistics-y-label" x="30" y={y(value) + 4} textAnchor="end">{value} ★</text></g>)}
        {scale.ticks.map(value => <g key={value}><line className="statistics-count-tick" x1={right} x2={right + 4} y1={countY(value)} y2={countY(value)} /><text className="statistics-count-label" data-count={value} x="318" y={countY(value) + 4}>{count(value)}</text></g>)}
      </g>
      <g className="statistics-volume-bars" aria-hidden="true">
        {points.map(point => <rect key={point.date} className="statistics-volume-bar" data-date={point.date} data-count={point.count} data-selected={point.date === selectedDate} x={point.x - barWidth / 2} y={countY(point.count)} width={barWidth} height={bottom - countY(point.count)} rx="2" />)}
      </g>
      {/* Paint the entire line after all bars, so no bar can cover the curve. */}
      {points.length > 1 && <polyline className="statistics-line" fill="none" points={points.map(point => `${point.x},${y(point.average)}`).join(' ')} aria-hidden="true" />}
      {points.map((point, i) => <g key={point.date} className="statistics-observation" data-date={point.date} role="button" tabIndex={0}
        aria-label={`${interval(point.from, point.to, true)} · ${count(point.count)} ${t.reviews} · ${t.average} ${number(point.average)} / 5`}
        aria-pressed={point.date === selectedDate} aria-describedby={point.date === selectedDate ? detailId : undefined}
        onClick={() => setSelectedDate(point.date)}
        onFocus={() => setSelectedDate(point.date)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedDate(point.date) }
          if (event.key === 'Escape') { event.preventDefault(); setSelectedDate(null) }
        }}>
        <rect className="statistics-period-target" x={Math.max(left, point.x - spacing / 2)} y={top - 12} width={Math.min(right, point.x + spacing / 2) - Math.max(left, point.x - spacing / 2)} height={bottom - top + 16} fill="transparent" />
        <circle className="statistics-rating-point" data-date={point.date} cx={point.x} cy={y(point.average)} r={radius} aria-hidden="true" />
        {labelIndexes.has(i) && <text x={point.x} y={y(point.average) - 12} textAnchor="middle" className="statistics-point-label" aria-hidden="true">{number(point.average)}</text>}
      </g>)}
      {ticks.map(i => <text key={points[i].date} className="statistics-x-label" data-date={points[i].date} x={points[i].x} y="211" textAnchor={data.bucket === 'week' || points.length === 1 ? 'middle' : i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>{tickDate(points[i].date)}</text>)}
    </svg>
    {selected ? <div className="statistics-chart-selection">
      <div id={detailId} role="status"><strong>{interval(selected.from, selected.to, true)}</strong><span>{count(selected.count)} {t.reviews}</span><span>{t.average} <b>{number(selected.average)} / 5</b></span></div>
      <button type="button" aria-label={t.chartClose} onClick={() => setSelectedDate(null)}>×</button>
    </div> : <p className="statistics-chart-hint">{t.chartTouch}</p>}
    <details className="statistics-values"><summary>{t.values}</summary><table><thead><tr><th>{t.chartPeriod}</th><th>{t.average}</th><th>{t.count}</th></tr></thead><tbody>{points.map(point => <tr key={point.date}><th>{interval(point.from, point.to)}</th><td>{number(point.average)} / 5</td><td>{count(point.count)}</td></tr>)}</tbody></table></details>
  </>
}
