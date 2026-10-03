import { AXES, type Axis, type AnalyticalSentiment } from './consultant-contract.ts'

export interface PriorityTopic { key:string; axis:Axis; sentiment:AnalyticalSentiment; mentions:number; label:string }
export function narrativePriorities(total:number, topics:PriorityTopic[]) {
  const threshold=Math.max(3,Math.ceil(total/100))
  const ranked=[...topics].sort((a,b)=>b.mentions-a.mentions || (a.key<b.key?-1:a.key>b.key?1:0))
  const axes=Object.fromEntries(AXES.map(axis=>{
    const positive=ranked.filter(t=>t.axis===axis && t.sentiment==='positive')
    const negative=ranked.filter(t=>t.axis===axis && t.sentiment==='negative')
    const recurring_negative=negative.filter(t=>t.mentions>=threshold)
    // Price perception precedes billing; the complete arrays remain volume-ranked.
    const selected=axis==='price' ? [...recurring_negative].sort((a,b)=>{
      const order=(t:PriorityTopic)=>t.key==='price_level:negative'?0:t.key==='value:negative'?1:2
      return order(a)-order(b) || ranked.indexOf(a)-ranked.indexOf(b)
    }) : recurring_negative
    return [axis,{positive,negative,recurring_negative,isolated_negative:negative.filter(t=>t.mentions<threshold),
      recommendation_priorities:(selected.length?selected:positive).slice(0,2),mode:selected.length?'improve':positive.length?'maintain':'observe'}]
  })) as Record<Axis,{positive:PriorityTopic[];negative:PriorityTopic[];recurring_negative:PriorityTopic[];isolated_negative:PriorityTopic[];recommendation_priorities:PriorityTopic[];mode:string}>
  return {threshold,axes,global_positive:ranked.filter(t=>t.sentiment==='positive').slice(0,2),
    global_negative:ranked.filter(t=>t.sentiment==='negative' && t.mentions>=threshold).slice(0,2)}
}
export type NarrativePriorities=ReturnType<typeof narrativePriorities>
const labels=(topics:PriorityTopic[],language:'fr'|'vi')=>topics.map(t=>t.label).join(language==='fr'?' et ':' và ')

/** A stylistic or priority violation is repaired without another model call. */
export function priorityRecommendation(axis:NarrativePriorities['axes'][Axis],language:'fr'|'vi') {
  const subject=labels(axis.recommendation_priorities,language)
  if(axis.mode==='improve') return language==='fr'?`Concentrer les améliorations sur les retours récurrents concernant ${subject}.`:`Tập trung cải thiện những vấn đề được phản ánh lặp lại về ${subject}.`
  if(axis.mode==='maintain') return language==='fr'?`Maintenir les points forts reconnus par les clients concernant ${subject}.`:`Duy trì những điểm mạnh được khách hàng ghi nhận về ${subject}.`
  return language==='fr'?'Suivre les retours ponctuels avant de définir une priorité d’amélioration.':'Theo dõi các phản ánh riêng lẻ trước khi xác định ưu tiên cải thiện.'
}
export function validPriorityKeys(keys:unknown, axis:NarrativePriorities['axes'][Axis]) {
  const allowed=axis.recommendation_priorities.map(t=>t.key)
  return Array.isArray(keys) && keys.length>0 && keys.length<=2 && new Set(keys).size===keys.length
    && keys.includes(allowed[0]) && keys.every(key=>allowed.includes(key))
}
export function priorityConclusion(context:NarrativePriorities,positive:number,negative:number,language:'fr'|'vi') {
  const fr=language==='fr'
  const satisfaction=positive>negative ? (fr?'Les retours sont globalement positifs.':'Phản hồi nhìn chung tích cực.')
    :negative>positive?(fr?'Les retours négatifs prédominent.':'Phản hồi tiêu cực chiếm ưu thế.')
    :(fr?'Les retours sont partagés.':'Phản hồi còn trái chiều.')
  const strengths=context.global_positive.length?(fr?`Les principales forces concernent ${labels(context.global_positive,language)}.`:`Các điểm mạnh chính là ${labels(context.global_positive,language)}.`):''
  const problems=context.global_negative.length?(fr?`Les priorités d’amélioration concernent ${labels(context.global_negative,language)}.`:`Các ưu tiên cải thiện là ${labels(context.global_negative,language)}.`)
    :(fr?'Aucun thème négatif n’atteint le seuil de récurrence.':'Không có chủ đề tiêu cực nào đạt ngưỡng lặp lại.')
  return [satisfaction,strengths,problems].filter(Boolean).join(' ')
}
export function sentenceCount(text:string) { return text.split(/[.!?。！？]+(?:\s|$)/u).filter(s=>s.trim()).length }
