import { useId, useState } from 'react'
import { Check, ChevronDown, CircleAlert } from 'lucide-react'
import { useI18n } from '../i18n'
import { formatHistoricalGeneratedAt, type HistoricalReport } from '../lib/historical-report'
import { summaryPreview } from '../lib/executive-summary'

export function ExecutiveSummary({ report }: { report: HistoricalReport }) {
  const { language, messages } = useI18n()
  const m = messages.reputation
  const [expanded, setExpanded] = useState(false)
  const [about, setAbout] = useState(false)
  const id = useId()
  const data = report.reputation!
  const number = (value: number | null, digits = 2) => value === null ? '—' : Number(value).toLocaleString(language === 'vi' ? 'vi-VN' : 'fr-FR', { maximumFractionDigits: digits })
  const level = data.sample_reviews_count === 0 ? m.noSubrating : data.positive_rate >= 90 ? m.satisfactionVeryHigh : data.positive_rate >= 80 ? m.satisfactionHigh : data.positive_rate >= 70 ? m.satisfactionPositive : m.satisfactionMixed
  const summary = data.ai_overall_summary
  const themeList = (sentiment: 'positive' | 'negative') => {
    const items = (sentiment === 'positive' ? data.positive_themes : data.negative_themes).slice(0, 4)
    const Icon = sentiment === 'positive' ? Check : CircleAlert
    return items.length ? <ul className={`executive-themes executive-${sentiment}`}>{items.map(theme => <li key={theme.theme_key}>
      <Icon size={16} aria-hidden="true"/><span>{language === 'vi' ? theme.label_vi : theme.label_fr}</span><b>{m.mentions.replace('{count}', number(theme.mentions, 0))}</b>
    </li>)}</ul> : <p className="reputation-muted">{sentiment === 'positive' ? m.noStrength : m.noWatch}</p>
  }
  return <article className="card executive-summary">
    <div className="executive-satisfaction"><h3>{level}</h3>
      <p>{m.satisfactionDetail.replace('{rate}', number(data.positive_rate, 1)).replace('{count}', number(data.sample_reviews_count, 0))}</p>
      <small>{m.sampleRating} : {number(data.sample_average_rating)} / 5</small>
    </div>
    <div className="executive-block"><h3>{m.strengths}</h3>{themeList('positive')}</div>
    <div className="executive-block"><h3>{m.watch}</h3>{themeList('negative')}</div>
    <div className="executive-block"><h3>{m.inBrief}</h3>
      <p id={`${id}-summary`} className={`executive-text${expanded ? '' : ' executive-preview'}`}>{summary ? expanded ? summary : summaryPreview(summary) || m.details : messages.analytics.summaryFailed}</p>
      <button type="button" className="executive-toggle" aria-expanded={expanded} aria-controls={`${id}-summary`} disabled={!summary} onClick={() => setExpanded(!expanded)}>{expanded ? m.collapse : m.details}</button>
    </div>
    <button type="button" className="executive-toggle executive-about" aria-expanded={about} aria-controls={`${id}-about`} onClick={() => setAbout(!about)}>{m.about}<ChevronDown size={18} aria-hidden="true"/></button>
    <div id={`${id}-about`} hidden={!about}>
      <dl className="executive-methodology">
        <div><dt>{m.analyzed}</dt><dd>{number(data.sample_reviews_count, 0)}</dd></div>
        <div><dt>{m.googleTotal}</dt><dd>{number(report.googleTotalReviews, 0)}</dd></div>
        <div><dt>{m.coverage}</dt><dd>{report.dataComplete ? m.completeHistory : m.sampleHistory}</dd></div>
        <div><dt>{m.sampleRating}</dt><dd>{number(data.sample_average_rating)} / 5</dd></div>
        <div><dt>{m.googleRating}</dt><dd>{number(report.googleRating)} / 5</dd></div>
        {(['food', 'service', 'atmosphere'] as const).map(category => <div key={category}><dt>{m[category]}</dt><dd>{m.evaluations.replace('{count}', number(data[`${category}_review_count`], 0)).replace('{total}', number(data.sample_reviews_count, 0))}</dd></div>)}
        <div><dt>{m.lastUpdated}</dt><dd>{report.generatedAt ? formatHistoricalGeneratedAt(report.generatedAt) : '—'}</dd></div>
      </dl><p className="reputation-muted">{m.themeNote}</p>
    </div>
  </article>
}
