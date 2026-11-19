import { adjacentBuckets, type Statistics } from '../lib/restaurant-statistics'
import type { statisticsMessages } from '../i18n/statistics'

type Labels = typeof statisticsMessages.fr | typeof statisticsMessages.vi
const day = 86_400_000
const stamp = (value: string) => Date.parse(value + 'T00:00:00Z')
const iso = (value: number) => new Date(value).toISOString().slice(0, 10)
function nextBucket(value: number, bucket: Statistics['bucket']) {
  const date = new Date(value)
  if (bucket === 'week') date.setUTCDate(date.getUTCDate() + 7)
  else date.setUTCMonth(date.getUTCMonth() + 1)
  return date.getTime()
}

// Calendar slots explain missing observations; only actual server rows become
// points. Clip the first/last bucket to the selected period, without recalculating
// the server averages or using the browser timezone.
export function StatisticsRatingChart({ data, locale, t }: { data: Statistics; locale: string; t: Labels }) {
  const rows = data.series
  if (!rows.length) return <p>{t.empty}</p>
  const start = stamp(data.start_date ?? rows[0].date), end = stamp(data.end_date) + day
  const left = 44, right = 340, top = 28, bottom = 166
  const x = (value: number) => left + (right - left) * (value - start) / Math.max(day, end - start)
  const y = (value: number) => bottom - (bottom - top) * (value - 1) / 4
  const number = (value: number) => value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const date = (value: number) => new Date(value).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const interval = (from: number, to: number) => `${date(from)} – ${date(to - day)}`
  const points = rows.map(row => {
    const from = Math.max(start, stamp(row.date)), to = Math.min(end, nextBucket(stamp(row.date), data.bucket))
    return { ...row, from, to, x: x((from + to) / 2) }
  })
  const gaps: { from: number; to: number }[] = []
  let cursor = start
  for (const point of points) {
    if (point.from > cursor) gaps.push({ from: cursor, to: point.from })
    cursor = point.to
  }
  if (cursor < end) gaps.push({ from: cursor, to: end })
  const labelX = (i: number) => Math.max(65, Math.min(320, points[i].x))
  const labelIndexes = new Set<number>()
  for (const i of [0, Math.floor((rows.length - 1) / 2), rows.length - 1]) {
    if ([...labelIndexes].every(other => Math.abs(labelX(other) - labelX(i)) >= 45)) labelIndexes.add(i)
  }
  const ticks = [...new Set([start, start + Math.floor((end - start) / day / 2) * day, end - day])]
  return <>
    <svg className="statistics-chart" viewBox="0 0 360 208" role="img" aria-label={`${t.evolving}. ${data.bucket === 'week' ? t.weeklyMean : t.monthlyMean}${gaps.length ? '. ' + t.gaps : ''}`}>
      {gaps.map(gap => <rect key={gap.from} className="statistics-chart-gap" x={x(gap.from)} y={top} width={x(gap.to) - x(gap.from)} height={bottom - top}><title>{interval(gap.from, gap.to)} : {t.noStoredReviews}</title></rect>)}
      {[1, 2, 3, 4, 5].map(value => <g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} className="statistics-grid" /><text className="statistics-y-label" x="30" y={y(value) + 4} textAnchor="end">{value}</text></g>)}
      {points.map((point, i) => <g key={point.date}>
        {i > 0 && adjacentBuckets(points[i - 1].date, point.date, data.bucket) && <line x1={points[i - 1].x} y1={y(points[i - 1].average)} x2={point.x} y2={y(point.average)} className="statistics-line" />}
        <circle cx={point.x} cy={y(point.average)} r="3.5"><title>{interval(point.from, point.to)} : {number(point.average)} / 5 · {point.count} {t.reviews}</title></circle>
        {labelIndexes.has(i) && <text x={labelX(i)} y={y(point.average) - 12} textAnchor="middle" className="statistics-point-label">{number(point.average)}</text>}
      </g>)}
      {ticks.map((value, i) => <text key={value} className="statistics-x-label" data-date={iso(value)} x={ticks.length === 1 ? (left + right) / 2 : i === ticks.length - 1 ? right : x(value)} y="193" textAnchor={ticks.length === 1 ? 'middle' : i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}>{date(value)}</text>)}
    </svg>
    {gaps.length > 0 && <p className="statistics-gap-legend"><span aria-hidden="true" />{t.gaps}</p>}
    <details className="statistics-values"><summary>{t.values}</summary><table><thead><tr><th>{t.chartPeriod}</th><th>{t.average}</th><th>{t.count}</th></tr></thead><tbody>{points.map(point => <tr key={point.date}><th>{interval(point.from, point.to)}</th><td>{number(point.average)} / 5</td><td>{point.count}</td></tr>)}</tbody></table></details>
  </>
}
