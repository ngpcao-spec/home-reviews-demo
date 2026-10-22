import {useCallback,useState} from 'react'
import {ChevronRight} from 'lucide-react'
import {useI18n} from '../i18n'
import {consultantReportCopy} from '../lib/consultant-report-copy'
import {experimentalPresentation,type ExperimentalRow} from '../lib/experimental-report-presentation'
import {AXES,type Axis} from '../../supabase/functions/_shared/consultant-contract'
import {ConsultantReportLayout,ConsultantQuickGrid} from './ConsultantReportLayout'
import {GoogleContextInfo} from './GoogleContextInfo'
import {ExperimentalNegativeReviews,type NegativeReviewSelection} from './ExperimentalNegativeReviews'

export function ExperimentalReport({row,operation,methodology}:{row:ExperimentalRow;operation?:unknown;methodology:string}){
 const {language}=useI18n(),fr=language==='fr',m=consultantReportCopy[language],data=experimentalPresentation(row)
 const [negativeSelection,setNegativeSelection]=useState<NegativeReviewSelection|null>(null)
 const closeNegativeReviews=useCallback(()=>setNegativeSelection(null),[])
 const r=data.report,scope=data.scope,format=(n:number|null|undefined)=>n==null?'—':n.toLocaleString(fr?'fr-FR':'vi-VN',{maximumFractionDigits:2})
 const pending=fr?'À réexaminer : couverture des preuves insuffisante.':'Cần xem lại: chưa đủ căn cứ.'
 const issue=(path:string)=>row.controls?.section_issues?.some(i=>i.path===path)
 const categoryTitle=(category:string|undefined)=>{const axis=AXES.find(key=>data.axis(key).category===category);return axis?m.axes[axis]:fr?'Catégorie non renseignée':'Chưa có nhóm'}
 const groups=r?[
  ...r.categories.map((s,i)=>({path:`categories[${i}]`,title:categoryTitle(s.category),ids:s.evidence_ids})),
  ...r.positive_aspects.map((s,i)=>({path:`positive_aspects[${i}]`,title:fr?'Point positif':'Điểm tích cực',ids:s.evidence_ids})),
  ...r.negative_aspects.map((s,i)=>({path:`negative_aspects[${i}]`,title:fr?'Point négatif':'Điểm tiêu cực',ids:s.evidence_ids})),
  {path:'conclusion',title:m.conclusion,ids:r.conclusion.evidence_ids},
  ...r.recommendations.map((s,i)=>({path:`recommendations[${i}]`,title:s.title,ids:s.evidence_ids}))]:[]
 const prose=(text:string,path:string)=><p className="consultant-prose">{issue(path)?pending:text}</p>
 const metrics=(key:Axis,compact=false)=>{const a=data.axis(key);return <>
  {a.googleAverage!==null&&a.googleCount!==null&&<><p className="v5-score">{format(a.googleAverage)} <span>/ 5</span></p><small>{format(a.googleCount)} {m.notes} · {fr?'corpus figé':'bộ đánh giá cố định'}</small></>}
  <dl className="reputation-replies experimental-category-counts"><div><dt>{fr?'Avis positifs, mixtes inclus':'Đánh giá tích cực, gồm hỗn hợp'}</dt><dd>{format(a.positive)}</dd></div><div className={a.negative!==null&&a.negative>0?'experimental-negative-link':undefined}><dt>{fr?'Avis négatifs, mixtes inclus':'Đánh giá tiêu cực, gồm hỗn hợp'}{a.negative!==null&&a.negative>0&&<button className="experimental-negative-open" type="button" aria-haspopup="dialog" aria-label={`${fr?'Avis négatifs, mixtes inclus':'Đánh giá tiêu cực, gồm hỗn hợp'} : ${format(a.negative)} — ${m.axes[key]}`} onClick={e=>setNegativeSelection({axis:key,reportId:row.id,trigger:e.currentTarget,scrollX:window.scrollX,scrollY:window.scrollY})}><ChevronRight size={15} aria-hidden="true"/></button>}</dt><dd>{format(a.negative)}</dd></div></dl>
  <p className="v5-coverage">{fr?'Avis distincts abordant la catégorie':'Đánh giá riêng biệt đề cập nhóm'} : {format(a.mentioned)} / {format(a.denominator)}{a.mentioned!==null&&a.denominator!==null&&a.denominator>0&&<> · {format(a.mentioned/a.denominator*100)} %</>}</p>
  {!compact&&<small>{fr?'Comptages automatiques JEV sur les textes analysés, pas la fréquence d’un incident précis.':'Số liệu JEV tự động trên nội dung đã phân tích, không phải tần suất của một sự cố cụ thể.'}</small>}
 </>}
 const axis=(key:Axis)=>{const a=data.axis(key),index=r?.categories.findIndex(s=>s.category===a.category)??-1;return <div className="v5-axis" data-axis={key}>
  {metrics(key)}{a.section?prose(a.section.text,`categories[${index}]`):<p className="v5-muted">{fr?'Synthèse non fournie.':'Chưa có nội dung tổng hợp.'}</p>}
  {a.recommendations.length>0&&<><h3>{m.recommendation}</h3><div className="consultant-aspects">{a.recommendations.map(({value:s,index:i})=><article key={i} data-recommendation={i}><h4>{s.title}</h4>{issue(`recommendations[${i}]`)?<p className="consultant-prose">{pending}</p>:<>
   {s.observations.map((o,j)=><p className="consultant-prose" key={j}><strong>{fr?'Constat rapporté : ':'Nhận xét của khách: '}</strong>{o.text}</p>)}
   <p className="consultant-prose"><strong>{fr?'Action proposée : ':'Hành động đề xuất: '}</strong>{s.proposed_action}</p><p className="consultant-prose">{s.priority_reason}</p>
  </>}</article>)}</div></>}
  <GoogleContextInfo stats={data.reference?.structured_context_stats} axis={key} language={language}/>
 </div>}
 return <>
  {row.controls?.technical_checks_passed===false&&<p role="alert">{fr?'Certains contrôles restent non satisfaits. Les sections concernées sont signalées.':'Một số kiểm tra chưa đạt. Các phần liên quan được đánh dấu.'}</p>}
  {r&&<ConsultantReportLayout reportLanguage={data.language}
   overview={<><dl className="reputation-replies"><div><dt>{fr?'Avis dans le corpus figé':'Đánh giá trong bộ dữ liệu cố định'}</dt><dd>{format(scope?.source_reviews)}</dd></div><div><dt>{fr?'Avis avec texte analysés':'Đánh giá có nội dung đã phân tích'}</dt><dd>{format(scope?.analysed_text_reviews)}</dd></div><div><dt>{fr?'Avis sans texte — statistiques générales uniquement':'Đánh giá không có nội dung — chỉ dùng trong thống kê chung'}</dt><dd>{format(scope?.textless_statistics_only)}</dd></div>{data.reference?.sample_average_rating!=null&&<div><dt>{m.average} · {format(scope?.source_reviews)} {fr?'avis':'đánh giá'}</dt><dd>{format(data.reference.sample_average_rating)} / 5</dd></div>}</dl></>}
   quick={<><ConsultantQuickGrid render={key=>metrics(key,true)}/><small>{fr?'Un avis mixte contribue aux deux polarités et reste un seul avis distinct. Les catégories ne s’additionnent pas pour compter les avis.':'Đánh giá hỗn hợp được tính ở cả hai chiều nhưng vẫn chỉ là một đánh giá riêng biệt. Không cộng các nhóm để tính tổng số đánh giá.'}</small></>}
   axis={axis}
   takeaway={<div className="v5-decisions"><div><h3>{m.strengths}</h3>{r.positive_aspects.map((s,i)=><div key={i}>{prose(s.text,`positive_aspects[${i}]`)}</div>)}{!r.positive_aspects.length&&<p className="v5-muted">{fr?'Aucun passage fourni.':'Chưa có nội dung được cung cấp.'}</p>}</div><div><h3>{m.statuses.watch}</h3>{r.negative_aspects.map((s,i)=><div key={i}>{prose(s.text,`negative_aspects[${i}]`)}</div>)}{!r.negative_aspects.length&&<p className="v5-muted">{fr?'Aucun passage fourni.':'Chưa có nội dung được cung cấp.'}</p>}</div></div>}
   conclusion={prose(r.conclusion.text,'conclusion')}
  />}
  <details className="card parallel-report-audit"><summary>{fr?'Sources, méthode et détails techniques':'Nguồn, phương pháp và chi tiết kỹ thuật'}</summary>
   <aside className="v5-muted"><p>{methodology}</p>{row.imported_derivative_id&&<p>{fr?'Version dérivée importée ; le résultat historique invalid_output reste conservé.':'Phiên bản dẫn xuất được nhập; kết quả invalid_output cũ vẫn được giữ nguyên.'}</p>}</aside>
   {groups.map(group=><section data-evidence-group={group.path} key={group.path}><h3>{group.title}</h3>{group.ids.map((id,i)=>{const e=row.controls?.evidence?.find(e=>e.evidence_id===id),s=row.source_reviews.find(s=>s.id===e?.review_id);return <article key={`${id}:${i}`}><blockquote>{e?.quote??(fr?'Citation non disponible.':'Chưa có trích dẫn.')}</blockquote>{s&&<details><summary>{fr?'Avis complet et original':'Toàn bộ đánh giá và bản gốc'}</summary><p className="consultant-prose">{s.analysis_text}</p><p className="consultant-prose">{s.original_text}</p></details>}<small className="parallel-audit-id">{id}</small></article>})}</section>)}
   <details><summary>{fr?'Comptages JEV et dénominateurs':'Số liệu JEV và mẫu số'}</summary><pre>{JSON.stringify(row.statistics,null,2)}</pre></details>
   <details><summary>{fr?'Réponse originale, version dérivée et corrections':'Phản hồi gốc, bản dẫn xuất và chỉnh sửa'}</summary><p className="parallel-audit-id">{row.id}</p><pre>{JSON.stringify({raw_response:row.raw_response,original_report:row.original_report,derived_report:row.derived_report,corrections:row.corrections,controls:row.controls,usage:row.usage,operation},null,2)}</pre></details>
  </details>
  {negativeSelection?.reportId===row.id&&<ExperimentalNegativeReviews row={row} selection={negativeSelection} onClose={closeNegativeReviews}/>}
 </>
}
