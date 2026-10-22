import { useI18n } from '../i18n'
import { type Axis, type ConsultantReportData, type DiagnosticTopic } from '../../supabase/functions/_shared/consultant-contract'
import './ReputationReport.css'
import './ConsultantReportV5.css'
import { GoogleContextInfo } from './GoogleContextInfo'
import {V9ReportInfo} from './V9ReportInfo'
import {V10ReportInfo} from './V10ReportInfo'
import {V11ReportInfo} from './V11ReportInfo'
import {CrossRatingSection} from './CrossRatingSection'
import {crossRatingMessages} from '../i18n/cross-rating'
import {consultantReportCopy as copy} from '../lib/consultant-report-copy'
import {ConsultantReportLayout,ConsultantQuickGrid} from './ConsultantReportLayout'

export function ConsultantReportV5({report}:{report:ConsultantReportData}) {
  const {language}=useI18n(),m=copy[language]
  const diagnostics=report.axis_diagnostics,decision=report.decision_summary,cross=(report.version===8||report.version===9||report.version===10||report.version===11)?report.cross_rating_analysis:undefined,crossWords=crossRatingMessages[language]
  if(!diagnostics || !decision) return <p role="status">{m.empty}</p>
  const number=(n:number)=>n.toLocaleString(language==='fr'?'fr-FR':'vi-VN',{minimumFractionDigits:2,maximumFractionDigits:2})
  const topics=(items:DiagnosticTopic[],empty:string)=>items.length?<ul className="v5-topics">{items.map(t=><li key={t.key}><span>{t.label}</span><small>{t.mentions} {m.mentions}</small></li>)}</ul>:<p className="v5-muted">{empty}</p>
  const metric=(key:Axis,compact=false,showRating=true)=>{
    const d=diagnostics[key]
    return <>{showRating&&(d.subrating_average!==null?<><p className="v5-score">{number(d.subrating_average)} <span>/ 5</span></p><small>{d.subrating_count} {m.notes}</small></>:<p className="v5-muted">{key==='price'?m.noRating:m.noData}</p>)}
      <p className="v5-coverage">{m.levels[d.coverage_level]} · <span style={{whiteSpace:'nowrap'}}>{Math.round(d.coverage_rate*100)} %</span></p>{key==='price'&&!compact&&<small>{Math.round(d.textual_coverage_rate*100)} % {m.textCoverage}</small>}
      <p><span className={`v5-status v5-${d.status}`}>{m.statuses[d.status]}</span></p></>
  }
  return <ConsultantReportLayout
    introduction={<>
      {report.version===9&&<V9ReportInfo report={report}/>}
      {report.version===10&&<V10ReportInfo report={report}/>}
      {report.version===11&&<V11ReportInfo report={report}/>}
      {report.version>=7&&<p className="v5-muted">{language==='fr'?'Analyse EN':'Phân tích EN'} · {report.analysis_input_stats?.english_analysis_coverage_percent.toLocaleString(language==='fr'?'fr-FR':'vi-VN',{maximumFractionDigits:1})??'—'} %{(report.analysis_input_stats?.fallback_non_english_count??0)>0&&<> · {report.analysis_input_stats!.fallback_non_english_count} {language==='fr'?'avis analysés dans leur langue originale':'đánh giá phân tích bằng ngôn ngữ gốc'}</>}</p>}
    </>}
    overview={<dl className="reputation-replies"><div><dt>{m.analyzed}</dt><dd>{report.total}</dd></div>{report.sample_average_rating!=null&&<div><dt>{m.average}</dt><dd>{number(report.sample_average_rating)} / 5</dd></div>}</dl>}
    quick={<><ConsultantQuickGrid render={key=><>{metric(key,true)}<p className="v5-signal">{diagnostics[key].recurring_negative[0]?.label??diagnostics[key].top_positive[0]?.label??m.empty}</p></>}/><small>{m.coverageNote}</small></>}
    cross={cross&&<CrossRatingSection analysis={cross}/>}
    axis={key=><div className="v5-axis" data-axis={key}>{cross&&key!=="price"&&<p className="v8-category-line">{crossWords.google} · {cross.axes[key==="quality"?"food":key].average_rating===null?crossWords.none:number(cross.axes[key==="quality"?"food":key].average_rating!)+" / 5"} · {cross.axes[key==="quality"?"food":key].rating_count} {crossWords.available}</p>}{metric(key,false,!cross||key==="price")}{cross&&<h3>{crossWords.comments}</h3>}<h3>{m.appreciated}</h3>{topics(diagnostics[key].top_positive,m.noPositive)}<h3>{m.watch}</h3>{topics(diagnostics[key].recurring_negative,m.none)}<p className="consultant-prose">{diagnostics[key].summary}</p><h3>{m.recommendation}</h3><p className="consultant-prose">{report.axes.find(a=>a.key===key)?.recommendation}</p>{report.version>=6&&<GoogleContextInfo stats={report.structured_context_stats} axis={key} language={language}/>}</div>}
    takeaway={<><div className="v5-decisions"><div><h3>{m.strengths}</h3>{topics(decision.strengths,m.empty)}</div><div><h3>{m.statuses.watch}</h3>{topics(decision.watch,m.none)}</div><div><h3>{m.limited}</h3>{decision.limited_axes.length?<ul>{decision.limited_axes.map(key=><li key={key}>{m.axes[key]}</li>)}</ul>:<p>{m.empty}</p>}</div><div><h3>{m.manager}</h3><p>{decision.manager_summary}</p></div></div><small>{m.note}</small></>}
    conclusion={<p className="consultant-prose">{report.conclusion}</p>}
    ending={<>{report.version===9&&<V9ReportInfo report={report} comparisonOnly/>}{report.version===10&&<V10ReportInfo report={report} comparisonOnly/>}{report.version===11&&<V11ReportInfo report={report} comparisonOnly/>}</>}
  />
}
