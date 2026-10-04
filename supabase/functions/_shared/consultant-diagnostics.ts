import { AXES, type Axis, type AxisDiagnostic, type CoverageLevel, type DiagnosticStatus, type DiagnosticTopic, type DecisionSummary } from './consultant-contract.ts'
import { HEADLINES } from './consultant-priorities.ts'

export interface DiagnosticSource {
  sample_average_rating?:number|null
  food_average?:number|null; food_review_count?:number
  service_average?:number|null; service_review_count?:number
  atmosphere_average?:number|null; atmosphere_review_count?:number
}
export type CountedTopic = DiagnosticTopic & {review_ids:string[]}
export const recurringThreshold=(total:number)=>Math.max(5,Math.ceil(total*0.05))
export const strongSignalThreshold=(total:number)=>Math.max(10,Math.ceil(total*0.10))
export const coverageLevel=(rate:number):CoverageLevel=>rate>=0.5?'strong':rate>=0.2?'medium':'limited'
export const uniqueAxisCoverage=(topics:CountedTopic[],axis:Axis)=>new Set(topics.filter(t=>t.axis===axis).flatMap(t=>t.review_ids)).size
const rank=(a:DiagnosticTopic,b:DiagnosticTopic)=>b.mentions-a.mentions || a.key.localeCompare(b.key)
export function axisStatus(average:number|null,coverage:number,negative:DiagnosticTopic[],total:number):DiagnosticStatus {
  if(negative.some(t=>t.mentions>=strongSignalThreshold(total))) return 'priority'
  if(coverage<0.2) return 'limited_data'
  if(negative.some(t=>t.mentions>=recurringThreshold(total))) return 'watch'
  if(average!==null && average>=4.7) return 'major_strength'
  if(average!==null && average>=4.5) return 'strength'
  return 'neutral'
}
const labels=(topics:DiagnosticTopic[],fr:boolean)=>topics.map(t=>t.label).join(fr?' et ':' và ')
export function diagnosticSummary(d:AxisDiagnostic,language:'fr'|'vi') {
  const fr=language==='fr'
  const assessment:Record<DiagnosticStatus,string>=fr?{
    major_strength:'Cet axe constitue un point fort majeur.',strength:'Cet axe constitue un point fort.',
    watch:d.subrating_average!==null && d.subrating_average>=4.5?'Cet axe reste très bien noté, avec un point de vigilance.':'Un signal récurrent mérite une attention.',
    priority:'Un signal négatif fort mérite une attention prioritaire.',limited_data:'La couverture est trop limitée pour conclure fortement.',neutral:'Aucun signal majeur ne se dégage.',
  }:{major_strength:'Đây là một điểm mạnh nổi bật.',strength:'Đây là một điểm mạnh.',
    watch:d.subrating_average!==null && d.subrating_average>=4.5?'Khía cạnh này vẫn được chấm điểm rất tốt, nhưng có điểm cần theo dõi.':'Có tín hiệu lặp lại cần được chú ý.',
    priority:'Có tín hiệu tiêu cực mạnh cần được ưu tiên cải thiện.',limited_data:'Dữ liệu còn quá hạn chế để đưa ra kết luận chắc chắn.',neutral:'Chưa có tín hiệu nổi bật.'}
  const positive=d.top_positive.length?(fr?`Les points appréciés cités sont : ${labels(d.top_positive,fr)}.`:`Các điểm được đánh giá cao gồm : ${labels(d.top_positive,fr)}.`):''
  const concern=d.recurring_negative.length?(fr?`Les points à surveiller concernent : ${labels(d.recurring_negative,fr)}.`:`Các điểm cần theo dõi gồm : ${labels(d.recurring_negative,fr)}.`)
    :d.isolated_negative.length?(fr?'Les critiques disponibles restent sous le seuil de récurrence.':'Các phàn nàn hiện có chưa đạt ngưỡng lặp lại.')
    :(fr?'Aucun problème récurrent n’est détecté dans les avis analysés.':'Không phát hiện vấn đề lặp lại trong các đánh giá được phân tích.')
  return [assessment[d.status],positive,concern].filter(Boolean).join(' ')
}
export function buildAxisDiagnostics(total:number,topics:CountedTopic[],source:DiagnosticSource,language:'fr'|'vi'):Record<Axis,AxisDiagnostic> {
  return Object.fromEntries(AXES.map(axis=>{
    const prefix=axis==='quality'?'food':axis
    const count=prefix==='price'?0:source[`${prefix}_review_count`]??0
    const average=prefix==='price'?null:source[`${prefix}_average`]??null
    const textual=uniqueAxisCoverage(topics,axis)
    const ratio=(n:number)=>total>0?Math.min(1,n/total):0
    const coverage=ratio(axis==='price'?textual:count)
    const ranked=topics.filter(t=>t.axis===axis).map(({review_ids:_,...topic})=>topic).sort(rank)
    const negative=ranked.filter(t=>t.sentiment==='negative')
    const d:AxisDiagnostic={subrating_average:average,subrating_count:count,coverage_rate:coverage,coverage_level:coverageLevel(coverage),
      textual_review_count:textual,textual_coverage_rate:ratio(textual),status:axisStatus(average,coverage,negative,total),
      top_positive:ranked.filter(t=>t.sentiment==='positive').slice(0,3),
      recurring_negative:negative.filter(t=>t.mentions>=recurringThreshold(total)).slice(0,2),
      isolated_negative:negative.filter(t=>t.mentions<recurringThreshold(total)),recurring_threshold:recurringThreshold(total),strong_signal_threshold:strongSignalThreshold(total),summary:''}
    if(axis==='price' && d.status==='neutral' && d.top_positive.some(t=>t.mentions>=recurringThreshold(total))) d.status='strength'
    d.summary=diagnosticSummary(d,language)
    return [axis,d]
  })) as Record<Axis,AxisDiagnostic>
}
export function globalDecisionSummary(axes:Record<Axis,AxisDiagnostic>,language:'fr'|'vi'):DecisionSummary {
  // One well-supported representative per axis. Never add overlapping mentions.
  const strengths=AXES.flatMap(axis=>{
    const d=axes[axis]
    return d.coverage_level!=='limited' && d.status!=='priority' && (d.subrating_average===null || d.subrating_average>=4.5)
      ?d.top_positive.filter(t=>t.mentions>=d.recurring_threshold && t.mentions>=d.top_positive[0].mentions/2)
        .sort((a,b)=>{
          const order=(t:DiagnosticTopic)=>{const i=HEADLINES[axis].indexOf(t.key.split(':')[0]);return i<0?999:i}
          return order(a)-order(b)||rank(a,b)
        }).slice(0,1):[]
  }).sort(rank).slice(0,3)
  const watch=AXES.flatMap(axis=>axes[axis].recurring_negative).sort(rank)
  const manager_priorities=[...watch].sort((a,b)=>{
    const da=axes[a.axis],db=axes[b.axis]
    return Number(b.mentions>=db.strong_signal_threshold)-Number(a.mentions>=da.strong_signal_threshold)
      || b.mentions-a.mentions || db.coverage_rate-da.coverage_rate
      || (da.subrating_average??5)-(db.subrating_average??5) || a.key.localeCompare(b.key)
  }).slice(0,2)
  const fr=language==='fr'
  const preserve=strengths.length?(fr?'Préserver les points forts documentés. ':'Duy trì các điểm mạnh đã ghi nhận. '):''
  const manager_summary=preserve+(manager_priorities.length
    ?(fr?`Concentrer l’attention sur : ${labels(manager_priorities,fr)}.`:`Tập trung theo dõi : ${labels(manager_priorities,fr)}.`)
    :(fr?'Suivre les retours avant de définir une priorité d’amélioration.':'Theo dõi phản hồi trước khi xác định ưu tiên cải thiện.'))
  return {strengths,watch,limited_axes:AXES.filter(axis=>axes[axis].coverage_level==='limited'),manager_priorities,manager_summary}
}
export function diagnosticConclusion(decision:DecisionSummary,positive:number,negative:number,language:'fr'|'vi') {
  const fr=language==='fr'
  const overall=positive>negative?(fr?'Les retours sont globalement positifs.':'Phản hồi nhìn chung tích cực.'):negative>positive?(fr?'Les retours négatifs prédominent.':'Phản hồi tiêu cực chiếm ưu thế.'):(fr?'Les retours sont partagés.':'Phản hồi còn trái chiều.')
  return [overall,decision.strengths.length?(fr?`Les principales forces sont : ${labels(decision.strengths,fr)}.`:`Các điểm mạnh chính là : ${labels(decision.strengths,fr)}.`):'',decision.manager_priorities.length?(fr?`Les points à surveiller en priorité sont : ${labels(decision.manager_priorities,fr)}.`:`Các điểm cần ưu tiên theo dõi là : ${labels(decision.manager_priorities,fr)}.`):(fr?'Aucun thème négatif n’atteint le seuil de récurrence.':'Không có chủ đề tiêu cực đạt ngưỡng lặp lại.')].filter(Boolean).join(' ')
}
