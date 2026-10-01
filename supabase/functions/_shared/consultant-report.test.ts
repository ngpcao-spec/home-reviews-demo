import { afterEach, describe, expect, it, vi } from 'vitest'
import { assembleConsultantReport, consultantBatches, consultantMetrics, extractConsultantBatch, ratingClassification, validateConsultantBatch, type Classification, type ConsultantFinding } from './consultant-report.ts'
import { reputationMetrics, type ReputationReview } from './reputation-metrics.ts'
import { AXES } from './consultant-contract.ts'

const review=(id:string,rating=5,text='Good food but slow service'):ReputationReview=>({id,rating,original_text:text,text:null,published_at:null,historical_import:true,has_negative_feedback:null,status:'new',review_context:null,review_detailed_rating:null})
const classified=(id:string,sentiment:'positive'|'negative'='positive'):Classification=>({review_id:id,sentiment,basis:'text',evidence:'Good food'})
const finding=(id:string,key='food_quality',sentiment:'positive'|'negative'='positive'):ConsultantFinding=>({review_id:id,theme_key:key,sentiment,evidence:sentiment==='positive'?'Good food':'slow service'})
afterEach(()=>vi.unstubAllGlobals())

describe('consultant V3 isolated analytics',()=>{
  it('classifies each review once using text first and rating only as a tie-breaker',()=>{
    const rows=[review('a',5),review('b',1),review('c',4,''),review('d',3,'')]
    const result=validateConsultantBatch({classifications:[{review_id:'a',sentiment:'negative',evidence:'slow service'},{review_id:'b',sentiment:'positive',evidence:'Good food'},{review_id:'c',sentiment:'insufficient',evidence:''},{review_id:'d',sentiment:'insufficient',evidence:''}],findings:[]},rows)
    expect(result.classifications.map(item=>item.sentiment)).toEqual(['negative','positive','positive','negative'])
    const metrics=consultantMetrics(rows,result.classifications,[])
    expect(metrics.positive+metrics.negative).toBe(4)
    expect(metrics.axes.map(axis=>axis.key)).toEqual([...AXES])
    expect(reputationMetrics(rows,9999).negative_reviews_count).toBe(2)
  })
  it('rejects missing, duplicate, unknown and ungrounded classifications rather than fabricate exact totals',()=>{
    const rows=[review('a')]
    expect(()=>validateConsultantBatch({classifications:[],findings:[]},rows)).toThrow('REPORT_CLASSIFICATION_INCOMPLETE')
    expect(()=>validateConsultantBatch({classifications:[classified('other')],findings:[]},rows)).toThrow('REPORT_INVALID_CLASSIFICATION')
    expect(()=>validateConsultantBatch({classifications:[classified('a'),classified('a')],findings:[]},rows)).toThrow('REPORT_INVALID_CLASSIFICATION')
    expect(()=>validateConsultantBatch({classifications:[{...classified('a'),evidence:'Not in the review'}],findings:[]},rows)).toThrow('REPORT_UNGROUNDED_CLASSIFICATION')
  })
  it('deduplicates per review/theme and per axis, with both sentiments independently counted',()=>{
    const rows=[review('a'),review('b')]
    const findings=[finding('a'),finding('a'),finding('a','freshness'),finding('a','wait_time','negative'),finding('a','friendly_staff'),finding('b','wait_time','negative')]
    const metrics=consultantMetrics(rows,rows.map(r=>classified(r.id)),findings)
    expect(metrics.themes.find(theme=>theme.theme_key==='food_quality')!.mentions).toBe(1)
    expect(metrics.axes.find(axis=>axis.key==='quality')).toMatchObject({positive:1,negative:0})
    expect(metrics.axes.find(axis=>axis.key==='service')).toMatchObject({positive:1,negative:2})
    expect(metrics.total).toBe(2)
  })
  it('rejects an individual ungrounded finding without losing the other findings or classification',()=>{
    const rows=[review('a')]
    const result=validateConsultantBatch({classifications:[classified('a')],findings:[finding('a'),finding('a'),{...finding('a','cooking'),evidence:'Burnt meal'}]},rows)
    expect(result.findings).toHaveLength(1)
    expect(result.rejectedCount).toBe(1)
    expect(result.classifications).toHaveLength(1)
  })
  it('covers 500 source reviews in resumable batches without truncation or per-review calls',()=>{
    const rows=Array.from({length:500},(_,i)=>review(String(i)))
    const batches=consultantBatches(rows)
    expect(batches).toHaveLength(25)
    expect(batches.flat()).toEqual(rows)
    expect(consultantBatches([review('empty',3,'')])).toEqual([])
    expect(ratingClassification(review('empty',3,''))).toMatchObject({sentiment:'negative',basis:'rating'})
  })
  it('accepts a genuine single-character review without forcing rating-based classification',()=>{
    const result=validateConsultantBatch({classifications:[{review_id:'a',sentiment:'positive',evidence:'好'}],findings:[]},[review('a',1,'好')])
    expect(result.classifications[0]).toMatchObject({sentiment:'positive',basis:'text'})
  })
  it.each(['fr','vi'] as const)('produces four grounded recommendations and insufficient-data fallback in %s',language=>{
    const metrics=consultantMetrics([review('a')],[classified('a')],[finding('a')])
    const data=assembleConsultantReport(metrics,{axes:AXES.map(key=>({key,summary:'Constat',recommendation:'Action',supporting_keys:key==='quality'?['food_quality:positive']:[]})),explanations:[{key:'food_quality:positive',text:'Perception'}],conclusion:'Synthèse'},language)
    expect(data.axes).toHaveLength(4)
    expect(data.axes.find(axis=>axis.key==='price')!.recommendation).toContain(language==='fr'?'Données insuffisantes':'Chưa có đủ dữ liệu')
    expect(data.axes.find(axis=>axis.key==='quality')!.recommendation).toBe('Action')
  })
  it('rejects unsupported recommendations and narrative counts',()=>{
    const metrics=consultantMetrics([review('a')],[classified('a')],[finding('a')])
    const raw={axes:AXES.map(key=>({key,summary:'Constat',recommendation:'Action',supporting_keys:['noise:negative']})),explanations:[{key:'food_quality:positive',text:'Perception'}],conclusion:'Synthèse'}
    expect(()=>assembleConsultantReport(metrics,raw,'fr')).toThrow('REPORT_UNGROUNDED_RECOMMENDATION')
    raw.axes=raw.axes.map(axis=>({...axis,supporting_keys:['food_quality:positive'],summary:'42 clients'}))
    expect(()=>assembleConsultantReport(metrics,raw,'fr')).toThrow('REPORT_INVALID_NARRATIVE')
  })
  it('uses original multilingual texts, compact aliases and structured output without external data',async()=>{
    vi.stubGlobal('Deno',{env:{get:()=> 'mock-secret-not-real'}})
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify({output_text:JSON.stringify({classifications:[{review_id:'r0',sentiment:'negative',evidence:'slow service'}],findings:[{...finding('r0','wait_time','negative')}] }),usage:{input_tokens:10,output_tokens:20}})))
    vi.stubGlobal('fetch',fetchMock)
    const usage=vi.fn()
    const result=await extractConsultantBatch([review('uuid-real',5)],usage)
    expect(result.classifications[0]).toMatchObject({review_id:'uuid-real',sentiment:'negative'})
    const body=JSON.parse(fetchMock.mock.calls[0][1]!.body as string)
    expect(body.store).toBe(false)
    expect(body.text.format.strict).toBe(true)
    expect(body.input[1].content).not.toContain('uuid-real')
    expect(body.input[1].content).toContain('Good food but slow service')
    expect(usage).toHaveBeenCalledWith({input_tokens:10,output_tokens:20})
  })
})
