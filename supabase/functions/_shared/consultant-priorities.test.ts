import { afterEach,describe,expect,it,vi } from 'vitest'
import { narrativePriorities, priorityRecommendation, sentenceCount, validPriorityKeys, type PriorityTopic } from './consultant-priorities.ts'
import { assembleConsultantReport, CATALOG, consultantNarrative, type consultantMetrics } from './consultant-report.ts'
import { AXES } from './consultant-contract.ts'
const topic=(key:string,mentions:number,sentiment:'positive'|'negative'='negative'):PriorityTopic=>({key:`${key}:${sentiment}`,axis:CATALOG[key][0],label:CATALOG[key][1],mentions,sentiment})
afterEach(()=>vi.unstubAllGlobals())
describe('server narrative V4 priorities',()=>{
  it.each([[100,3],[500,5],[505,6],[101,3]])('uses sample %i, recurrence %i', (total,threshold)=>expect(narrativePriorities(total,[]).threshold).toBe(threshold))
  it('chooses a dominant problem, never an isolated one; preserves every detailed topic',()=>{
    const p=narrativePriorities(100,[topic('cleanliness',1),topic('noise',9)])
    expect(p.axes.atmosphere.negative).toHaveLength(2)
    expect(p.axes.atmosphere.recommendation_priorities.map(t=>t.key)).toEqual(['noise:negative'])
    expect(validPriorityKeys(['cleanliness:negative'],p.axes.atmosphere)).toBe(false)
    expect(validPriorityKeys(['noise:negative','food_quality:negative'],p.axes.atmosphere)).toBe(false)
  })
  it('uses the verified Artisan Sol volumes (505 reviews), with deterministic ties and two priorities',()=>{
    const topics=[['communication',8],['wait_time',8],['order_accuracy',7],['professionalism',7],['food_quality',34],['drinks',8],['variety',8],['cooking',7],['price_level',34],['value',14],['billing',8]].map(([key,n])=>topic(String(key),Number(n)))
    const p=narrativePriorities(505,topics)
    expect(p.axes.service.recommendation_priorities.map(t=>t.key)).toEqual(['communication:negative','wait_time:negative'])
    expect(p.axes.quality.recommendation_priorities.map(t=>t.key)).toEqual(['food_quality:negative','drinks:negative'])
    expect(p.axes.price.recommendation_priorities.map(t=>t.key)).toEqual(['price_level:negative','value:negative'])
    expect(p.global_negative.map(t=>t.key)).toEqual(['food_quality:negative','price_level:negative'])
    expect(narrativePriorities(505,[...topics].reverse())).toEqual(p)
    expect(validPriorityKeys(['order_accuracy:negative'],p.axes.service)).toBe(false)
    expect(validPriorityKeys(['wait_time:negative'],p.axes.service)).toBe(false)
    expect(validPriorityKeys(['communication:negative','wait_time:negative'],p.axes.service)).toBe(true)
  })
  it('keeps noise first for the verified K.HOUSE Sol sample (101 reviews)',()=>{
    const p=narrativePriorities(101,[topic('noise',9),topic('comfort',3),topic('cleanliness',1)])
    expect(p.axes.atmosphere.recommendation_priorities.map(t=>t.key)).toEqual(['noise:negative','comfort:negative'])
  })
  it.each(['fr','vi'] as const)('maintains a positive axis with only isolated negatives in %s',language=>{
    const axis=narrativePriorities(500,[topic('atmosphere',327,'positive'),topic('cleanliness',1)]).axes.atmosphere
    expect(axis.mode).toBe('maintain')
    expect(axis.recommendation_priorities[0].sentiment).toBe('positive')
    expect(priorityRecommendation(axis,language)).toContain(language==='fr'?'Maintenir':'Duy trì')
    expect(validPriorityKeys(['cleanliness:negative'],axis)).toBe(false)
  })
})
function fixture() {
  const topics=[topic('food_quality',34),topic('price_level',34),topic('value',14),topic('communication',8),topic('wait_time',8),topic('order_accuracy',7),topic('noise',1),topic('atmosphere',327,'positive'),topic('food_quality',347,'positive')]
  const metrics={total:505,positive:460,negative:45,classifications:[],classificationFallbackCount:0,
    axes:AXES.map(key=>({key,positive:key==='price'?30:327,negative:key==='price'?45:17})),
    themes:topics.map(t=>({theme_key:t.key.split(':')[0],axis:t.axis,sentiment:t.sentiment,mentions:t.mentions,review_ids:[]}))} as ReturnType<typeof consultantMetrics>
  const raw={axes:AXES.map(key=>({key,summary:'Constat issu des avis.',recommendation:'Action proposée.',supporting_keys:key==='service'?['order_accuracy:negative']:['noise:negative']})),
    explanations:topics.map(t=>({key:t.key,text:'Perception exprimée dans les avis.'})),conclusion:'Phrase. Phrase. Phrase. Phrase.',conclusion_supporting_keys:['noise:negative']}
  return {metrics,raw}
}
describe('V4 narrative assembly and model boundary',()=>{
  it.each(['fr','vi'] as const)('repairs marginal supporting keys without retries, preserves counts and four recommendations in %s',language=>{
    const {metrics,raw}=fixture(),report=assembleConsultantReport(metrics,raw,language,4)
    expect(report.version).toBe(4)
    expect(report.axes).toHaveLength(4)
    expect(report.axes.map(a=>[a.positive,a.negative])).toEqual(metrics.axes.map(a=>[a.positive,a.negative]))
    expect(report.axes.find(a=>a.key==='service')!.recommendation).toContain(CATALOG.communication[language==='fr'?1:2])
    expect(report.axes.find(a=>a.key==='service')!.recommendation).not.toContain(CATALOG.order_accuracy[language==='fr'?1:2])
    expect(report.axes.find(a=>a.key==='price')!.summary).toContain(language==='fr'?'dépassent les retours positifs':'nhiều hơn phản hồi tích cực')
    expect(report.axes.find(a=>a.key==='atmosphere')!.recommendation).toContain(language==='fr'?'Maintenir':'Duy trì')
    expect(sentenceCount(report.conclusion)).toBeLessThanOrEqual(3)
    expect(report.conclusion).not.toMatch(/\p{N}/u)
    expect(report.conclusion).not.toContain(CATALOG.noise[language==='fr'?1:2])
    expect(report.negative_aspects).toHaveLength(metrics.themes.filter(t=>t.sentiment==='negative').length)
  })
  it('preserves legacy V3 validation and rejects invented prose counts',()=>{
    const {metrics,raw}=fixture()
    expect(()=>assembleConsultantReport(metrics,raw,'fr',3)).toThrow('REPORT_UNGROUNDED_RECOMMENDATION')
    raw.axes[0].summary='42 clients satisfaits'
    expect(()=>assembleConsultantReport(metrics,raw,'fr',4)).toThrow('REPORT_INVALID_NARRATIVE')
  })
  it('sends authoritative priorities only to final narrative, with unchanged model/effort and one call',async()=>{
    const {metrics,raw}=fixture()
    vi.stubGlobal('Deno',{env:{get:()=> 'mock-secret'}})
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify({output_text:JSON.stringify(raw),usage:{input_tokens:100,output_tokens:200}})))
    vi.stubGlobal('fetch',fetchMock)
    await consultantNarrative(metrics,'fr',undefined,'gpt-6.1-sol',4)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body=JSON.parse(fetchMock.mock.calls[0][1]!.body as string)
    expect(body.model).toBe('gpt-6.1-sol')
    expect(body.reasoning).toEqual({effort:'low'})
    const input=JSON.parse(body.input[1].content)
    expect(input.priority_context.axes.service.recommendation_priorities.map((t:PriorityTopic)=>t.key)).toEqual(['communication:negative','wait_time:negative'])
    expect(body.input[0].content).toContain('never invent frequency')
    expect(body.input[0].content).toContain('if negative exceeds positive')
  })
})
