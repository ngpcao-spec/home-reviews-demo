import type {ReactNode} from 'react'
import {AXES,type Axis} from '../../supabase/functions/_shared/consultant-contract'
import {useI18n} from '../i18n'
import {consultantReportCopy} from '../lib/consultant-report-copy'
import {crossRatingMessages} from '../i18n/cross-rating'
import './ReputationReport.css'
import './ConsultantReportV5.css'

export function ConsultantSection({index,title,className='',children}:{index:number;title:string;className?:string;children:ReactNode}){
 return <section className={`weekly-section${className?' '+className:''}`}><article className="card reputation-theme-card consultant-section-card"><header className="weekly-section-heading consultant-section-banner"><span className="eyebrow">{String(index).padStart(2,'0')}</span><h2>{title}</h2></header><div className="consultant-section-body">{children}</div></article></section>
}
export function ConsultantQuickGrid({render}:{render:(axis:Axis)=>ReactNode}){
 const {language}=useI18n(),m=consultantReportCopy[language]
 return <div className="v5-grid">{AXES.map(key=><div className="v5-quick-axis" key={key} data-axis={key}><h3>{m.axes[key]}</h3>{render(key)}</div>)}</div>
}
// Presentation slots deliberately do not coerce JEV counts into Sol diagnostics.
export function ConsultantReportLayout({introduction,ending,overview,quick,cross,axis,takeaway,conclusion,reportLanguage,summaryFirst=false}:{summaryFirst?:boolean;
 introduction?:ReactNode;ending?:ReactNode;overview:ReactNode;quick:ReactNode;cross?:ReactNode;axis:(axis:Axis)=>ReactNode;takeaway:ReactNode;conclusion:ReactNode;reportLanguage?:string
}){
 const {language}=useI18n(),m=consultantReportCopy[language]
 return <div className="consultant-report consultant-v5" lang={reportLanguage??language}>
  {!summaryFirst&&introduction}
  {summaryFirst&&<section className="report-summary card"><h2>{language==='fr'?'Synthèse':'Tổng hợp'}</h2>{conclusion}</section>}
  {summaryFirst?<details className="report-details"><summary>{language==='fr'?'Avis analysés dans ce rapport':'Đánh giá đã phân tích trong báo cáo'}</summary>{introduction}{overview}</details>:<ConsultantSection index={1} title={m.overview}>{overview}</ConsultantSection>}
  <ConsultantSection index={2} title={m.quick}>{quick}</ConsultantSection>
  {cross&&<ConsultantSection index={3} title={crossRatingMessages[language].title}>{cross}</ConsultantSection>}
  {AXES.map((key,i)=><ConsultantSection index={i+(cross?4:3)} key={key} title={m.axes[key]}>{axis(key)}</ConsultantSection>)}
  <ConsultantSection index={cross?8:7} title={m.takeaway}>{takeaway}</ConsultantSection>
  {!summaryFirst&&<ConsultantSection index={cross?9:8} title={m.conclusion}>{conclusion}</ConsultantSection>}
  {ending}
 </div>
}
