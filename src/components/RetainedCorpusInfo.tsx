import {useApp} from '../app/AppContext'
import {useI18n} from '../i18n'
export function RetainedCorpusInfo({establishmentId}:{establishmentId:string}){
 const {reviews}=useApp(),{language}=useI18n(),fr=language==='fr'
 const rows=reviews.filter(r=>r.establishmentId===establishmentId),texts=rows.filter(r=>(r.originalText??r.reviewText).trim())
 const dates=rows.filter(r=>r.hasGooglePublicationDate!==false).map(r=>r.publishedAt).filter(d=>Number.isFinite(Date.parse(d))).sort()
 const date=(s:string|undefined)=>s?new Date(s).toLocaleDateString(fr?'fr-FR':'vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'—'
 return <section className="card"><p>{fr?'Les 150 derniers avis uniques, avec ou sans texte, sans limite d’ancienneté.':'150 đánh giá duy nhất mới nhất, có hoặc không có nội dung, không giới hạn thời gian.'}</p><p>{rows.length} {fr?'avis dont':'đánh giá, gồm'} {texts.length} {fr?'commentaires textuels':'nội dung'} · {date(dates[0])} → {date(dates.at(-1))}</p><small>{fr?'Notes et statistiques sur ce corpus uniquement. Une note par rubrique compte seulement si elle est renseignée. JEV analyse uniquement les commentaires.':'Điểm và thống kê chỉ theo bộ đánh giá này. Điểm nhóm chỉ tính khi được cung cấp. JEV chỉ phân tích nội dung.'}</small></section>
}
