import { AXES, type ConsultantReportData } from '../../supabase/functions/_shared/consultant-contract'
import { buildAxisDiagnostics, diagnosticConclusion, globalDecisionSummary, type CountedTopic } from '../../supabase/functions/_shared/consultant-diagnostics'

export function shabuTopics(language:'fr'|'vi'):CountedTopic[] {
  const topic=(key:string,axis:CountedTopic['axis'],sentiment:CountedTopic['sentiment'],count:number,fr:string,vi:string,offset=0):CountedTopic=>({key:`${key}:${sentiment}`,axis,sentiment,mentions:count,label:language==='fr'?fr:vi,review_ids:Array.from({length:count},(_,i)=>`r${i+offset}`)})
  return [topic('food_quality','quality','positive',67,'Qualité et goût des plats','Chất lượng và hương vị món ăn'),topic('food_quality','quality','negative',3,'Qualité des plats','Chất lượng món ăn'),
    topic('friendly_staff','service','positive',33,'Accueil et amabilité','Sự thân thiện'),topic('attentiveness','service','positive',16,'Attention','Sự chu đáo'),topic('professionalism','service','positive',14,'Professionnalisme','Sự chuyên nghiệp'),
    topic('atmosphere','atmosphere','positive',30,'Ambiance générale','Bầu không khí'),topic('noise','atmosphere','negative',6,'Niveau sonore','Độ ồn'),topic('cleanliness','atmosphere','negative',1,'Propreté','Vệ sinh'),
    topic('value','price','positive',11,'Rapport qualité-prix','Giá trị so với giá tiền'),topic('billing','price','negative',1,'Facturation','Hóa đơn',10),topic('price_level','price','negative',1,'Niveau des prix','Mức giá',11),topic('value','price','negative',1,'Rapport qualité-prix','Giá trị so với giá tiền',12)]
}
export const shabuSource={sample_average_rating:4.91,food_average:4.913978,food_review_count:93,service_average:4.946236,service_review_count:93,atmosphere_average:4.902173,atmosphere_review_count:92}
export function shabuReport(language:'fr'|'vi'):ConsultantReportData {
  const topics=shabuTopics(language),axis_diagnostics=buildAxisDiagnostics(100,topics,shabuSource,language),decision_summary=globalDecisionSummary(axis_diagnostics,language)
  const aspects=topics.map(t=>({theme_key:t.key.split(':')[0],axis:t.axis,sentiment:t.sentiment,label:t.label,mentions:t.mentions,explanation:t.label}))
  return {version:5,language,total:100,positive:94,negative:6,sample_average_rating:4.91,axis_diagnostics,decision_summary,
    axes:AXES.map(key=>({key,positive:0,negative:0,summary:axis_diagnostics[key].summary,recommendation:language==='fr'?'Préserver les points forts documentés.':'Duy trì các điểm mạnh đã ghi nhận.'})),
    positive_aspects:aspects.filter(t=>t.sentiment==='positive'),negative_aspects:aspects.filter(t=>t.sentiment==='negative'),conclusion:diagnosticConclusion(decision_summary,94,6,language)}
}
