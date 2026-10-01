import { useI18n } from '../i18n'
import { AXES, type ConsultantReportData } from '../../supabase/functions/_shared/consultant-contract'
import './ReputationReport.css'

export function ConsultantReport({report}: {report: ConsultantReportData}) {
  const {messages, language} = useI18n()
  const m = messages.reputation
  if (report.language !== language) return <p role="status">{m.languageUnavailable}</p>
  const heading = (index: number, title: string) => <div className="weekly-section-heading"><span className="eyebrow">{String(index).padStart(2,'0')}</span><h2>{title}</h2></div>
  const label = {service:m.service,quality:m.quality,price:m.price,atmosphere:m.atmosphere}
  const aspects = (items: ConsultantReportData['positive_aspects'] = [], compact = false) => {
    const displayed = compact ? [...items].sort((a,b)=>b.mentions-a.mentions).slice(0,5) : items
    return displayed.length ? <ul className="consultant-count-list">{displayed.map(item=><li key={`${item.theme_key}:${item.sentiment}`}><span>- {item.label}</span><strong>{compact ? item.mentions : m.exactReviews.replace('{count}',String(item.mentions))}</strong></li>)}</ul> : <p>{m.noSubrating}</p>
  }
  return <div className="consultant-report">
    <section className="weekly-section">{heading(1,m.consultantOverview)}<article className="card reputation-theme-card"><dl className="reputation-replies">
      <div><dt>{m.analyzedTotal}</dt><dd>{report.total}</dd></div><div><dt>{m.positive}</dt><dd>{report.positive}</dd></div><div><dt>{m.analyticalNegative}</dt><dd>{report.negative}</dd></div>
    </dl><small>{m.analyticalNote}</small></article></section>
    <section className="weekly-section consultant-synthesis">{heading(2,m.analysisSynthesis)}<article className="card reputation-theme-card">
      <p className="consultant-total"><strong>{report.total ?? '—'}</strong> {m.analyzed}</p>
      <dl className="consultant-sentiments"><div><dt>{m.positive}</dt><dd>{report.positive ?? '—'}</dd></div><div><dt>{m.analyticalNegative}</dt><dd>{report.negative ?? '—'}</dd></div></dl>
      <div className="consultant-axis-grid">{AXES.map(key=>{
        const axis=report.axes?.find(item=>item.key===key)
        return <div className="consultant-axis-tile" key={key}><h3>{label[key]}</h3>{axis ? <dl><div><dt>{m.shortPositive}</dt><dd>{axis.positive ?? '—'}</dd></div><div><dt>{m.shortNegative}</dt><dd>{axis.negative ?? '—'}</dd></div></dl> : <p>{m.noSubrating}</p>}</div>
      })}</div>
      <div className="consultant-summary-themes"><h3>{m.mainStrengths}</h3>{aspects(report.positive_aspects,true)}</div>
      <div className="consultant-summary-themes consultant-negative"><h3>{m.mainImprovements}</h3>{aspects(report.negative_aspects,true)}</div>
    </article></section>
    {AXES.map((key,index)=>{
      const axis=report.axes?.find(item=>item.key===key)
      return <section className="weekly-section" key={key}>{heading(index+3,label[key])}<article className="card reputation-theme-card">
        <dl className="reputation-replies"><div><dt>{m.axisPositive.replace('{axis}',label[key])}</dt><dd>{axis?.positive ?? '—'}</dd></div><div><dt>{m.axisNegative.replace('{axis}',label[key])}</dt><dd>{axis?.negative ?? '—'}</dd></div></dl>
        <p className="consultant-prose">{axis?.summary || m.insufficientAnalysis}</p>
      </article></section>
    })}
    <section className="weekly-section">{heading(7,m.positiveAspects)}<article className="card reputation-theme-card">{aspects(report.positive_aspects)}<small>{m.themeNote}</small></article></section>
    <section className="weekly-section consultant-negative">{heading(8,m.negativeAspects)}<article className="card reputation-theme-card">{aspects(report.negative_aspects)}</article></section>
    <section className="weekly-section">{heading(9,m.conclusion)}<article className="card reputation-theme-card"><h3>{m.globalSynthesis}</h3><p className="consultant-prose">{report.conclusion || m.noSubrating}</p><h3>{m.recommendations}</h3><ul className="consultant-aspects">
      {AXES.map(key=><li key={key}><span aria-hidden="true">- </span><strong>{label[key]} :</strong> {report.axes?.find(axis=>axis.key===key)?.recommendation || m.insufficientAnalysis}</li>)}
    </ul></article></section>
  </div>
}
