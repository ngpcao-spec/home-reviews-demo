import type { Axis, ConsultantReportData, DecisionSummary, DiagnosticTopic } from './consultant-contract.ts'
import { formatNaturalList } from './natural-list.ts'

// Prose labels only: never change the catalogue, counts or selected topics.
const wording:Record<string,readonly [string,string]>={
  food_quality:['la qualité des plats','chất lượng món ăn'],
  friendly_staff:['l’accueil','sự thân thiện trong phục vụ'],
  atmosphere:['l’ambiance','bầu không khí'],
  freshness:['la fraîcheur','độ tươi ngon'],cooking:['la cuisson','độ chín của món ăn'],
  temperature:['la température des plats','nhiệt độ món ăn'],portions:['les portions','khẩu phần'],
  presentation:['la présentation des plats','cách trình bày món ăn'],drinks:['les boissons','đồ uống'],
  variety:['le choix proposé','sự đa dạng của thực đơn'],attentiveness:['l’attention portée aux clients','sự chu đáo'],
  wait_time:['le temps d’attente','thời gian chờ'],coordination:['l’organisation du service','sự phối hợp phục vụ'],
  communication:['la communication','cách trao đổi với khách'],order_accuracy:['l’exactitude des commandes','độ chính xác của đơn hàng'],
  professionalism:['le professionnalisme du service','tính chuyên nghiệp trong phục vụ'],
  consistency:['la régularité des plats','sự ổn định của món ăn'],decor:['le cadre','không gian'],
  noise:['le niveau sonore','độ ồn'],comfort:['le confort','sự thoải mái'],cleanliness:['la propreté','vệ sinh'],
  value:['le rapport qualité-prix','giá trị so với giá tiền'],price_level:['les prix','mức giá'],
  billing:['la facturation','hóa đơn'],location:['l’emplacement','vị trí'],
}
const axisWording:Record<Axis,readonly [string,string]>={service:['le service','dịch vụ'],quality:['la qualité des plats','chất lượng món ăn'],price:['les prix','giá cả'],atmosphere:['l’ambiance','không gian']}

export function managerConclusion(decision:DecisionSummary,positive:number,negative:number,language:'fr'|'vi') {
  const fr=language==='fr',index=fr?0:1
  const topics=(items:DiagnosticTopic[],max:number)=>formatNaturalList(items.slice(0,max).map(t=>wording[t.key.split(':')[0]]?.[index]??t.label.toLocaleLowerCase(language)),language)
  const strengths=topics(decision.strengths,3),priorities=topics(decision.manager_priorities,2)
  const overall=positive+negative===0?(fr?'Les retours disponibles ne permettent pas encore de dégager une tendance':'Chưa có đủ phản hồi để nhận định xu hướng chung')
    :positive>negative?(fr?'Dans l’ensemble, les retours des clients sont positifs':'Nhìn chung, phản hồi của khách hàng tích cực')
    :negative>positive?(fr?'Dans l’ensemble, les retours des clients sont plutôt négatifs':'Nhìn chung, phản hồi của khách hàng còn nhiều điểm chưa hài lòng')
    :(fr?'Dans l’ensemble, les retours des clients sont partagés':'Nhìn chung, phản hồi của khách hàng còn trái chiều')
  const first=overall+(strengths?(fr?`, avec pour points forts ${strengths}`:`, nổi bật ở ${strengths}`):'')+'.'
  const second=priorities?(fr?`Les principaux points à surveiller concernent ${priorities}.`:`Điểm cần theo dõi chủ yếu là ${priorities}.`)
    :(fr?'Aucun problème négatif n’apparaît assez fréquemment pour constituer une tendance préoccupante.':'Không có vấn đề tiêu cực nào xuất hiện đủ thường xuyên để được xem là xu hướng đáng lo ngại.')
  const limited=formatNaturalList(decision.limited_axes.map(axis=>axisWording[axis][index]),language)
  const third=limited?(fr?`Les données restent cependant limitées concernant ${limited}, ce qui ne permet pas de tirer une conclusion solide.`:`Riêng về ${limited}, dữ liệu hiện còn hạn chế nên chưa thể đưa ra kết luận chắc chắn.`):''
  return [first,second,third].filter(Boolean).join(' ')
}

/** Apply after assembly, without modifying any decision or any older version. */
export function withManagerConclusion(report:ConsultantReportData):ConsultantReportData {
  if((report.version!==6 && report.version!==7 && report.version!==8) || !report.decision_summary) return report
  return {...report,conclusion:managerConclusion(report.decision_summary,report.positive,report.negative,report.language)}
}
