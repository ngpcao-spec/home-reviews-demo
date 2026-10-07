import { useI18n } from '../i18n'
import type { ReactNode } from 'react'
import { AXES, type ConsultantReportData } from '../../supabase/functions/_shared/consultant-contract'
import './ReputationReport.css'
import { axisSummaryText } from '../lib/report-presentation'
import { ConsultantReportV5 } from './ConsultantReportV5'

function ReportSection({index,title,className='',children}:{index:number;title:string;className?:string;children:ReactNode}) {
  return <section className={`weekly-section ${className}`}><article className="card reputation-theme-card consultant-section-card">
    <header className="weekly-section-heading consultant-section-banner"><span className="eyebrow">{String(index).padStart(2,'0')}</span><h2>{title}</h2></header>
    <div className="consultant-section-body">{children}</div>
  </article></section>
}

export function ConsultantReport({report}: {report: ConsultantReportData}) {
  const {messages, language} = useI18n()
  const m = messages.reputation
  if (report.language !== language) return <p role="status">{m.languageUnavailable}</p>
  if (report.version === 5 || report.version === 6 || report.version === 7 || report.version === 8) return <ConsultantReportV5 report={report}/>
  const label = {service:m.service,quality:m.quality,price:m.price,atmosphere:m.atmosphere}
  const aspects = (items: ConsultantReportData['positive_aspects'] = [], compact = false, countOnly = false) => {
    const displayed = compact ? [...items].sort((a,b)=>b.mentions-a.mentions).slice(0,5) : items
    return displayed.length ? <ul className="consultant-count-list">{displayed.map(item=><li key={`${item.theme_key}:${item.sentiment}`}><span>- {item.label}</span><strong>{compact || countOnly ? item.mentions : m.exactReviews.replace('{count}',String(item.mentions))}</strong></li>)}</ul> : <p>{m.noSubrating}</p>
  }
  return <div className="consultant-report">
    <ReportSection index={1} title={m.consultantOverview}><dl className="reputation-replies">
      <div><dt>{m.analyzedTotal}</dt><dd>{report.total}</dd></div><div><dt>{m.positive}</dt><dd>{report.positive}</dd></div><div><dt>{m.analyticalNegative}</dt><dd>{report.negative}</dd></div>
    </dl><small>{m.analyticalNote}</small></ReportSection>
    <ReportSection index={2} title={m.analysisSynthesis} className="consultant-synthesis">
      <p className="consultant-total"><strong>{report.total ?? '—'}</strong> {m.analyzed}</p>
      <dl className="consultant-sentiments"><div><dt>{m.positive}</dt><dd>{report.positive ?? '—'}</dd></div><div><dt>{m.analyticalNegative}</dt><dd>{report.negative ?? '—'}</dd></div></dl>
      <div className="consultant-axis-grid">{AXES.map(key=>{
        const axis=report.axes?.find(item=>item.key===key)
        return <div className="consultant-axis-tile" key={key}><h3>{label[key]}</h3>{axis ? <dl><div><dt>{m.shortPositive}</dt><dd>{axis.positive ?? '—'}</dd></div><div><dt>{m.shortNegative}</dt><dd>{axis.negative ?? '—'}</dd></div></dl> : <p>{m.noSubrating}</p>}</div>
      })}</div>
      <div className="consultant-summary-themes"><h3>{m.mainStrengths}</h3>{aspects(report.positive_aspects,true)}</div>
      <div className="consultant-summary-themes consultant-negative"><h3>{m.mainImprovements}</h3>{aspects(report.negative_aspects,true)}</div>
    </ReportSection>
    {AXES.map((key,index)=>{
      const axis=report.axes?.find(item=>item.key===key)
      return <ReportSection key={key} index={index+3} title={label[key]} className="consultant-axis-section">
        <dl className="reputation-replies"><div><dt>{m.axisPositive}</dt><dd>{axis?.positive ?? '—'}</dd></div><div><dt>{m.axisNegative}</dt><dd>{axis?.negative ?? '—'}</dd></div></dl>
        <p className="consultant-prose consultant-axis-prose" lang={language}>{axis?.summary ? axisSummaryText(axis.summary,label[key]) : m.insufficientAnalysis}</p>
      </ReportSection>
    })}
    <ReportSection index={7} title={m.positiveAspects} className="consultant-positive-details">{aspects(report.positive_aspects,false,true)}<small>{m.themeNote}</small></ReportSection>
    <ReportSection index={8} title={m.negativeAspects} className="consultant-negative">{aspects(report.negative_aspects,false,true)}</ReportSection>
    <ReportSection index={9} title={m.conclusion}><h3>{m.globalSynthesis}</h3><p className="consultant-prose">{report.conclusion || m.noSubrating}</p><h3>{m.recommendations}</h3><ul className="consultant-aspects">
      {AXES.map(key=><li key={key}><span aria-hidden="true">- </span><strong>{label[key]} :</strong> {report.axes?.find(axis=>axis.key===key)?.recommendation || m.insufficientAnalysis}</li>)}
    </ul></ReportSection>
  </div>
}
