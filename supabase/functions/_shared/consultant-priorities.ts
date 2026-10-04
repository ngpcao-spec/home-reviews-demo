import { AXES, type Axis, type AnalyticalSentiment } from './consultant-contract.ts'

export interface PriorityTopic { key:string; axis:Axis; sentiment:AnalyticalSentiment; mentions:number; label:string }
// Conclusion only: these preferences never change extraction or negative priorities.
export const HEADLINES:Record<Axis,string[]>={
  quality:['food_quality','drinks','presentation','freshness','cooking','portions','variety','consistency','temperature'],
  service:['friendly_staff','professionalism','attentiveness','communication','wait_time','coordination','order_accuracy'],
  atmosphere:['atmosphere','decor','comfort','cleanliness','location','noise'],
  price:['value','price_level','billing'],
}
function globalStrengths(ranked:PriorityTopic[]) {
  const positive=ranked.filter(t=>t.sentiment==='positive'),first=positive[0]
  if(!first) return []
  const headlineRank=(t:PriorityTopic)=>{
    const index=HEADLINES[t.axis].indexOf(t.key.split(':')[0])
    return index<0?Number.MAX_SAFE_INTEGER:index
  }
  const best=(topics:PriorityTopic[])=>[...topics].sort((a,b)=>headlineRank(a)-headlineRank(b) || ranked.indexOf(a)-ranked.indexOf(b))[0]
  // Compare the best headline of each other axis by its own mentions, never sums.
  const candidates=AXES.filter(axis=>axis!==first.axis).map(axis=>best(positive.filter(t=>t.axis===axis))).filter(Boolean)
    .sort((a,b)=>ranked.indexOf(a)-ranked.indexOf(b))
  const second=candidates[0] ?? best(positive.filter(t=>t!==first))
  return second?[first,second]:[first]
}
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
  return {threshold,axes,global_positive:globalStrengths(ranked),
    global_negative:ranked.filter(t=>t.sentiment==='negative' && t.mentions>=threshold).slice(0,2)}
}
export type NarrativePriorities=ReturnType<typeof narrativePriorities>
const labels=(topics:PriorityTopic[],language:'fr'|'vi')=>topics.map(t=>t.label).join(language==='fr'?' et ':' và ')

/** Closed thematic vocabulary: no free model prose can repeat the price balance.
 * The model selects a supported thematic wording; the server validates that exact
 * choice and falls back without NLP, another call, or changing any source counts.
 */
export function priceThematicOptions(axis:NarrativePriorities['axes'][Axis],language:'fr'|'vi') {
  const join=(topics:PriorityTopic[])=>topics.map((t,i)=>i?t.label.charAt(0).toLocaleLowerCase(language)+t.label.slice(1):t.label).join(language==='fr'?' et ':' và ')
  const negative=axis.recommendation_priorities.filter(t=>t.sentiment==='negative')
  const positive=axis.positive.slice(0,1)
  const concern=negative.length
    ? language==='fr'?`Les critiques récurrentes concernent principalement ${negative.length>1?'ces thèmes':'ce thème'} : ${join(negative).toLocaleLowerCase(language)}.`:`${join(negative)} là ${negative.length>1?'các phàn nàn lặp lại chính':'chủ đề phàn nàn lặp lại chính'}.`
    : language==='fr'?'Les critiques restent ponctuelles, sans thème négatif récurrent.':'Các phàn nàn còn riêng lẻ, chưa có chủ đề tiêu cực lặp lại.'
  const strength=positive.length?(language==='fr'?`Des retours positifs portent sur le thème « ${join(positive).toLocaleLowerCase(language)} ».`:`${join(positive)} nhận được phản hồi tích cực.`):''
  return strength?[concern,concern+' '+strength]:[concern]
}
export function priceSummary(axis:NarrativePriorities['axes'][Axis],thematic:unknown,language:'fr'|'vi') {
  const options=priceThematicOptions(axis,language)
  const safe=typeof thematic==='string' && options.includes(thematic)?thematic:options[0]
  const balance=language==='fr'?'Les critiques liées au prix dépassent les retours positifs.':'Phản hồi tiêu cực về giá nhiều hơn phản hồi tích cực.'
  return balance+' '+safe
}

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
