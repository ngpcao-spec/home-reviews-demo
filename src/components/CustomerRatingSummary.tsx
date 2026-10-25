import {useI18n} from '../i18n'
import {CUSTOMER_CATEGORIES,type customerRatingStats} from '../../supabase/functions/_shared/customer-ratings'
export type CustomerStats=ReturnType<typeof customerRatingStats>
export function CustomerRatingSummary({stats}:{stats:CustomerStats|undefined}){
 const {language}=useI18n(),fr=language==='fr'
 if(!stats?.categories||!stats.overall)return null
 const labels={food:fr?'Qualité':'Đồ ăn',service:fr?'Service':'Dịch vụ',atmosphere:fr?'Ambiance':'Không gian',price:fr?'Prix':'Giá'}
 const score=(s:{average:number|null;count:number})=>`${s.average===null?'—':new Intl.NumberFormat(fr?'fr-FR':'vi-VN',{maximumFractionDigits:2}).format(s.average)+' / 5'} (${s.count} ${fr?'notes':'lượt chấm'})`
 return <div className="customer-rating-summary"><strong>{fr?'Notes des clients':'Điểm khách hàng chấm'}</strong><p>{fr?'Note globale':'Điểm chung'} : {score(stats.overall)}</p><dl>{CUSTOMER_CATEGORIES.map(k=><div key={k}><dt>{labels[k]}</dt><dd>{score(stats.categories[k])}</dd></div>)}</dl><small>{fr?'Ces notes sont fournies par les clients. Les sentiments JEV proviennent des commentaires et ne remplacent pas ces notes. Une valeur absente reste indisponible.':'Các điểm này do khách hàng cung cấp. Cảm xúc JEV lấy từ nội dung, không thay cho điểm. Không suy ra điểm còn thiếu.'}</small></div>
}
export function ReportLanguageInfo({source}:{source:Record<string,unknown>|null|undefined}){
 const {language}=useI18n(),fr=language==='fr',stats=source?.analysis_input_stats as {policy?:string;target_language?:string;missing_target_translation_count?:number;analysis_missing_count?:number}|undefined
 if(stats?.policy!=='account_google_or_original_v1')return null
 return <div className="report-language-scope"><p>{fr?'Langue figée du rapport':'Ngôn ngữ báo cáo đã chốt'} : {stats.target_language==='vi'?'Tiếng Việt':'Français'}. {fr?'Commentaires sans version Google dans cette langue, analysés depuis l’original':'Nội dung chưa có bản Google ở ngôn ngữ này, phân tích từ bản gốc'} : {stats.missing_target_translation_count??'—'}. {fr?'Analyses manquantes':'Phân tích còn thiếu'} : {stats.analysis_missing_count??'—'}.</p><CustomerRatingSummary stats={source?.customer_rating_statistics as CustomerStats|undefined}/></div>
}
