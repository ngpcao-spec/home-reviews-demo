import {useEffect,useId,useRef} from 'react'
import {createPortal} from 'react-dom'
import {X} from 'lucide-react'
import type {Axis} from '../../supabase/functions/_shared/consultant-contract'
import {useI18n} from '../i18n'
import {consultantReportCopy} from '../lib/consultant-report-copy'
import {experimentalNegativeReviews} from '../lib/experimental-negative-reviews'
import type {ExperimentalRow} from '../lib/experimental-report-presentation'

export interface NegativeReviewSelection {axis:Axis;reportId:string;trigger:HTMLButtonElement;scrollX:number;scrollY:number}
export function ExperimentalNegativeReviews({row,selection,onClose}:{row:ExperimentalRow;selection:NegativeReviewSelection;onClose:()=>void}){
 const {language}=useI18n(),fr=language==='fr',title=useId(),dialog=useRef<HTMLDialogElement>(null),data=experimentalNegativeReviews(row,selection.axis)
 useEffect(()=>{
  const element=dialog.current!,body=document.body,old={position:body.style.position,top:body.style.top,left:body.style.left,width:body.style.width,overflow:body.style.overflow}
  Object.assign(body.style,{position:'fixed',top:`-${selection.scrollY}px`,left:`-${selection.scrollX}px`,width:'100%',overflow:'hidden'})
  if(typeof element.showModal==='function')element.showModal();else element.setAttribute('open','')
  return()=>{
   if(typeof element.close==='function'&&element.open)element.close()
   Object.assign(body.style,old)
   if(selection.trigger.isConnected){window.scrollTo(selection.scrollX,selection.scrollY);selection.trigger.focus({preventScroll:true})}
  }
 },[selection])
 const missing=fr?'Non disponible dans le corpus figé':'Không có trong bộ đánh giá cố định'
 const date=(value:string|null|undefined)=>value&&Number.isFinite(new Date(value).getTime())?new Date(value).toLocaleDateString(fr?'fr-FR':'vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):missing
 return createPortal(<dialog className="parallel-negative-panel card" ref={dialog} aria-labelledby={title} aria-modal="true" onCancel={e=>{e.preventDefault();onClose()}} onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
  <div className="parallel-negative-panel-inner">
   <header className="parallel-negative-header"><div><h2 id={title}>{fr?'Avis négatifs et mixtes':'Đánh giá tiêu cực và hỗn hợp'} — {consultantReportCopy[language].axes[selection.axis]}</h2><p>{fr?'Avis du corpus figé, classés par JEV.':'Đánh giá trong bộ dữ liệu cố định, được JEV phân loại.'}</p></div><button autoFocus type="button" className="secondary-button" onClick={onClose} aria-label={fr?'Fermer et revenir au rapport':'Đóng và quay lại báo cáo'}><X size={18} aria-hidden="true"/>{fr?'Fermer':'Đóng'}</button></header>
   <div className="parallel-negative-content">
    <p>{fr?'Avis disponibles':'Đánh giá có sẵn'} : {data.reviews.length} / {data.expectedCount??'—'}</p>
    {!data.available&&<p role="status">{fr?'Les identifiants de classification nécessaires ne sont pas disponibles dans cette archive. Aucun avis ne sera recherché ou reclassé.':'Bản lưu này không có đủ mã định danh phân loại. Hệ thống không tìm thêm hoặc phân loại lại đánh giá.'}</p>}
    {data.missingReviewIds.length>0&&<p role="status">{fr?`${data.missingReviewIds.length} référence(s) devenue(s) indisponible(s) : avis retirés ou modifiés depuis la génération. Les compteurs datés restent inchangés.`:`${data.missingReviewIds.length} nguồn không còn có sẵn do đánh giá bị xóa hoặc sửa sau khi tạo báo cáo. Số đếm tại thời điểm tạo vẫn được giữ nguyên.`}</p>}
    {data.countMismatch&&<p role="status">{fr?'La liste des identifiants archivés ne correspond pas au compteur enregistré. Le compteur n’a pas été modifié.':'Danh sách mã định danh đã lưu không khớp với số đếm đã ghi. Số đếm không bị thay đổi.'}</p>}
    {data.reviews.map(({source,classification})=>{const original=source.original_text,analysis=source.analysis_text,different=!!analysis?.trim()&&analysis!==original;return <article key={source.id} className="card parallel-negative-review" data-review-id={source.id}>
     <span className={`parallel-review-badge ${classification==='mixed'?'parallel-review-mixed':''}`}>{classification==='mixed'?(fr?'Avis mixte — positif et négatif':'Đánh giá hỗn hợp — tích cực và tiêu cực'):(fr?'Avis négatif':'Đánh giá tiêu cực')}</span>
     <dl className="parallel-review-meta"><div><dt>{fr?'Note Google':'Điểm Google'}</dt><dd>{typeof source.rating==='number'&&Number.isFinite(source.rating)&&source.rating>=1&&source.rating<=5?`${source.rating} / 5` :missing}</dd></div><div><dt>{fr?'Date':'Ngày'}</dt><dd>{date(source.published_at)}</dd></div></dl>
     <h3>{fr?'Texte original complet':'Toàn bộ nội dung gốc'}</h3><p className="consultant-prose" lang={source.original_language??source.translation_provenance?.original_language??undefined}>{original?.trim()?original:missing}</p>
     {different?<><h3>{fr?'Traduction / texte d’analyse enregistré':'Bản dịch / văn bản phân tích đã lưu'}{source.analysis_language&&<> ({source.analysis_language})</>}</h3><p className="consultant-prose" lang={source.analysis_language??undefined}>{analysis}</p></>:<p className="v5-muted">{fr?'Aucune traduction distincte enregistrée dans ce corpus.':'Bộ đánh giá này không có bản dịch riêng đã lưu.'}</p>}
    </article>})}
   </div>
  </div>
 </dialog>,document.body)
}
