import { useI18n } from '../i18n'
import { AXES, type ConsultantReportData } from '../../supabase/functions/_shared/consultant-contract'
import './ReputationReport.css'

export function ConsultantReport({report}: {report: ConsultantReportData}) {
  const {messages, language} = useI18n()
  const m = messages.reputation
  if (report.language !== language) return <p role="status">{m.languageUnavailable}</p>
  const heading = (index: number, title: string) => <div className="weekly-section-heading"><span className="eyebrow">{String(index).padStart(2,'0')}</span><h2>{title}</h2></div>
  const label = {service:m.service,quality:m.quality,price:m.price,atmosphere:m.atmosphere}
  const aspects = (items: ConsultantReportData['positive_aspects']) => items.length ? <ul className="consultant-aspects">{items.map(item=><li key={`${item.theme_key}:${item.sentiment}`}><span aria-hidden="true">- </span><strong>{item.label} : {m.exactReviews.replace('{count}',String(item.mentions))}</strong> — {item.explanation}{item.mentions===1 && <small> {m.isolated}</small>}</li>)}</ul> : <p>{m.noTheme}</p>
  return <div className="consultant-report">
    <section className="weekly-section">{heading(1,m.reviewSynthesis)}<article className="card reputation-theme-card"><dl className="reputation-replies">
      <div><dt>{m.analyzedTotal}</dt><dd>{report.total}</dd></div><div><dt>{m.positive}</dt><dd>{report.positive}</dd></div><div><dt>{m.analyticalNegative}</dt><dd>{report.negative}</dd></div>
    </dl><small>{m.analyticalNote}</small></article></section>
    {AXES.map((key,index)=>{
      const axis=report.axes.find(item=>item.key===key)
      return <section className="weekly-section" key={key}>{heading(index+2,label[key])}<article className="card reputation-theme-card">
        <dl className="reputation-replies"><div><dt>{m.axisPositive.replace('{axis}',label[key])}</dt><dd>{axis?.positive ?? '—'}</dd></div><div><dt>{m.axisNegative.replace('{axis}',label[key])}</dt><dd>{axis?.negative ?? '—'}</dd></div></dl>
        <p className="consultant-prose">{axis?.summary || m.insufficientAnalysis}</p>
      </article></section>
    })}
    <section className="weekly-section">{heading(6,m.positiveAspects)}<article className="card reputation-theme-card">{aspects(report.positive_aspects)}<small>{m.themeNote}</small></article></section>
    <section className="weekly-section">{heading(7,m.negativeAspects)}<article className="card reputation-theme-card">{aspects(report.negative_aspects)}</article></section>
    <section className="weekly-section">{heading(8,m.conclusion)}<article className="card reputation-theme-card"><h3>{m.globalSynthesis}</h3><p className="consultant-prose">{report.conclusion}</p><h3>{m.recommendations}</h3><ul className="consultant-aspects">
      {AXES.map(key=><li key={key}><span aria-hidden="true">- </span><strong>{label[key]} :</strong> {report.axes.find(axis=>axis.key===key)?.recommendation || m.insufficientAnalysis}</li>)}
    </ul></article></section>
  </div>
}
