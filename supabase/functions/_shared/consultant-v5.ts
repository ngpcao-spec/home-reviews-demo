import { AXES, type ConsultantReportData, type DiagnosticTopic } from './consultant-contract.ts'
import { buildAxisDiagnostics, diagnosticConclusion, globalDecisionSummary, type CountedTopic, type DiagnosticSource } from './consultant-diagnostics.ts'
import { structuredCall, type Usage } from './reputation-themes.ts'

export interface V5Input {total:number;positive:number;negative:number;topics:CountedTopic[];source:DiagnosticSource}
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties})
const string={type:'string'}
export function v5Context(input:V5Input,language:'fr'|'vi') {
  const axes=buildAxisDiagnostics(input.total,input.topics,input.source,language)
  const decision=globalDecisionSummary(axes,language)
  const recommendations=Object.fromEntries(AXES.map(key=>[key,axes[key].recurring_negative.length?axes[key].recurring_negative:axes[key].top_positive.slice(0,2)]))
  return {axes,decision,recommendations}
}
export function assembleV5(input:V5Input,language:'fr'|'vi',raw:Record<string,unknown>):ConsultantReportData {
  const {axes,decision,recommendations}=v5Context(input,language)
  const prose=(v:unknown)=>typeof v==='string' && v.trim() && v.length<=1500 && !/\p{N}|https?:\/\//u.test(v)?v.trim():null
  const records=(v:unknown):Record<string,unknown>[]=>Array.isArray(v)?v.filter((x):x is Record<string,unknown>=>!!x && typeof x==='object'):[]
  const fr=language==='fr'
  const fallback=(topics:DiagnosticTopic[],improve:boolean)=>topics.length
    ?`${fr?(improve?'Porter l’attention sur':'Préserver les points appréciés concernant'):(improve?'Tập trung theo dõi':'Duy trì những điểm được đánh giá cao về')} : ${topics.map(t=>t.label).join(fr?' et ':' và ')}.`
    :(fr?'Recueillir davantage de retours avant de conclure.':'Theo dõi thêm phản hồi trước khi đưa ra kết luận.')
  const aspects=input.topics.map(t=>{
    const explanation=records(raw.explanations).find(r=>r.key===t.key)
    return {theme_key:t.key.split(':')[0],axis:t.axis,sentiment:t.sentiment,label:t.label,mentions:t.mentions,
      explanation:prose(explanation?.text)??t.label}
  })
  return {version:5,language,total:input.total,positive:input.positive,negative:input.negative,
    sample_average_rating:input.source.sample_average_rating??null,axis_diagnostics:axes,decision_summary:decision,
    axes:AXES.map(key=>{
      const item=records(raw.axes).find(r=>r.key===key)
      const allowed=recommendations[key].map(t=>t.key)
      const keys=item?.supporting_keys
      const valid=Array.isArray(keys) && keys.length>0 && keys.length<=2 && new Set(keys).size===keys.length && keys.includes(allowed[0]) && keys.every(k=>allowed.includes(String(k)))
      const count=(sentiment:string)=>new Set(input.topics.filter(t=>t.axis===key && t.sentiment===sentiment).flatMap(t=>t.review_ids)).size
      // Low coverage never inherits a confident free-form recommendation.
      return {key,positive:count('positive'),negative:count('negative'),summary:axes[key].summary,
        recommendation:axes[key].status==='limited_data'?fallback([],false):valid?prose(item?.recommendation)??fallback(recommendations[key],!!axes[key].recurring_negative.length):fallback(recommendations[key],!!axes[key].recurring_negative.length)}
    }),positive_aspects:aspects.filter(t=>t.sentiment==='positive'),negative_aspects:aspects.filter(t=>t.sentiment==='negative'),
    conclusion:diagnosticConclusion(decision,input.positive,input.negative,language)}
}
export async function consultantNarrativeV5(input:V5Input,language:'fr'|'vi',recordUsage?: (usage:Usage)=>Promise<void>,model?:string) {
  const context=v5Context(input,language)
  const result=await structuredCall([
    `Write all prose in ${language==='fr'?'French':'Vietnamese'}. Use only these anonymous server-validated topics.`,
    'The server computes coverage, diagnostic status, recurring and strong thresholds, strengths and priorities. Never override them or interpret thematic mentions as satisfied customers. Never add theme counts to estimate customers.',
    'Return one short recommendation per axis, using at most two supplied recommendation keys including the first. With limited_data, request more feedback, not a confident conclusion. Without recurring negatives, preserve supported strengths, never promote isolated criticism into a problem.',
    'Give a short explanation for each supplied topic; topics below the supplied recurrence threshold are isolated, not recurrent. Keep excellent Google subratings visible in your interpretation even where a recurring concern exists.',
    'Never invent causes, busy periods, hours, staffing, training, controls, procedures, investments, guarantees or actions already taken. Recommend only general directions grounded in the supplied themes. No names, external facts, numeric counts or percentages in prose.',
    'The server writes concise diagnostic summaries and the three-sentence conclusion from the same authoritative context. Do not output a second diagnosis or choose different priorities.',
  ].join(' '),{total:input.total,positive:input.positive,negative:input.negative,
    topics:input.topics.map(({review_ids:_,...topic})=>topic),axis_diagnostics:context.axes,decision_summary:context.decision,recommendations:context.recommendations},object({
    axes:{type:'array',items:object({key:{type:'string',enum:[...AXES]},recommendation:string,supporting_keys:{type:'array',items:string}})},
    explanations:{type:'array',items:object({key:string,text:string})},
  }),5500,recordUsage,model)
  return {report:assembleV5(input,language,result.data),usage:result.usage}
}
