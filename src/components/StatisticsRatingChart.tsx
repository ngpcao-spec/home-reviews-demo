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

// This is an ordered observation chart, not an elapsed-time axis. Every point
// uses an unchanged server average; empty buckets add neither space nor values.
export function StatisticsRatingChart({ data, locale, t }: { data: Statistics; locale: string; t: Labels }) {
  const rows = data.series.filter(row => row.count > 0).sort((a, b) => a.date.localeCompare(b.date))
  if (!rows.length) return <p>{t.chartEmpty}</p>
  const start = stamp(data.start_date ?? rows[0].date), end = stamp(data.end_date) + day
  const left = 44, right = 340, top = 28, bottom = 166
  const x = (index: number) => rows.length === 1 ? (left + right) / 2 : left + (right - left) * index / (rows.length - 1)
  const y = (value: number) => bottom - (bottom - top) * (value - 1) / 4
  const number = (value: number) => value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const date = (value: number) => new Date(value).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const interval = (from: number, to: number) => `${date(from)} – ${date(to - day)}`
  const points = rows.map((row, i) => {
    const from = Math.max(start, stamp(row.date)), to = Math.min(end, nextBucket(stamp(row.date), data.bucket))
    return { ...row, from, to, x: x(i) }
  })
  const labelX = (i: number) => Math.max(65, Math.min(320, points[i].x))
  const labelIndexes = new Set<number>()
  for (const i of [0, Math.floor((rows.length - 1) / 2), rows.length - 1]) {
    if ([...labelIndexes].every(other => Math.abs(labelX(other) - labelX(i)) >= 45)) labelIndexes.add(i)
  }
  // Use actual bucket dates only. For dense series, leave some labels out so
  // mobile text remains readable; every point/date is also listed in the table.
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
    <svg className="statistics-chart" viewBox="0 0 360 208" role="img" aria-label={`${t.evolving}. ${data.bucket === 'week' ? t.weeklyMean : t.monthlyMean}`}>
      {[1, 2, 3, 4, 5].map(value => <g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} className="statistics-grid" /><text className="statistics-y-label" x="30" y={y(value) + 4} textAnchor="end">{value}</text></g>)}
      {points.map((point, i) => <g key={point.date}>
        {i > 0 && <line x1={points[i - 1].x} y1={y(points[i - 1].average)} x2={point.x} y2={y(point.average)} className="statistics-line" />}
        <circle data-date={point.date} cx={point.x} cy={y(point.average)} r="3.5"><title>{point.date} · {interval(point.from, point.to)} : {number(point.average)} / 5 · {point.count} {t.reviews}</title></circle>
        {labelIndexes.has(i) && <text x={labelX(i)} y={y(point.average) - 12} textAnchor="middle" className="statistics-point-label">{number(point.average)}</text>}
      </g>)}
      {ticks.map(i => <text key={points[i].date} className="statistics-x-label" data-date={points[i].date} x={points[i].x} y="193" textAnchor={data.bucket === 'week' || points.length === 1 ? 'middle' : i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>{tickDate(points[i].date)}</text>)}
    </svg>
    <details className="statistics-values"><summary>{t.values}</summary><table><thead><tr><th>{t.chartPeriod}</th><th>{t.average}</th><th>{t.count}</th></tr></thead><tbody>{points.map(point => <tr key={point.date}><th>{interval(point.from, point.to)}</th><td>{number(point.average)} / 5</td><td>{point.count}</td></tr>)}</tbody></table></details>
  </>
}
