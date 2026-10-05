import {describe,it,expect,vi,afterEach} from 'vitest'
import {structuredContextStats,normalizeContextPrice} from './structured-review-context.ts'
import {formatNaturalList} from './natural-list.ts'
import {consultantBatches,validateConsultantBatch,extractConsultantBatch,consultantMetrics,assembleConsultantReport} from './consultant-report.ts'
import type {ReputationReview} from './reputation-metrics.ts'
import snapshot from '../../../tests/fixtures/shabu-context-snapshot.json'
const row=(text:string,context:Record<string,unknown>):ReputationReview=>({id:'r',rating:5,original_text:text,text:null,published_at:null,historical_import:true,has_negative_feedback:null,status:'new',review_detailed_rating:null,review_context:context})
afterEach(()=>vi.unstubAllGlobals())
describe('V6 text opinions and descriptive Google context',()=>{
  it.each([
    ['',{'Độ ồn':'Ồn ào ở mức vừa phải'},'noise','negative','Ồn ào ở mức vừa phải'],
    ['',{'Độ ồn':'Yên tĩnh, dễ trò chuyện'},'noise','positive','Yên tĩnh, dễ trò chuyện'],
    ['Excellent restaurant.',{'Giá mỗi người':'500–600 N ₫'},'price_level','positive','500–600 N ₫'],
    ['Everything was good.',{'Thời gian chờ':'10–30 phút'},'wait_time','negative','10–30 phút'],
  ] as const)('rejects context-only evidence %s', (text,context,theme_key,sentiment,evidence)=>{
    const reviews=[row(text,context)]
    const result=validateConsultantBatch({classifications:[],findings:[{review_id:'r',theme_key,sentiment,evidence}]},reviews,6)
    expect(result.findings).toEqual([]);expect(result.rejectedCount).toBe(1)
    const report=assembleConsultantReport(consultantMetrics(reviews,result.classifications,result.findings),{},'vi',6)
    expect(report.version).toBe(6)
    expect(report.axis_diagnostics?.price.textual_coverage_rate).toBe(0)
    expect(consultantBatches([row('',context)],6)).toEqual([])
  })
  it('keeps legacy context evidence for old runs, but explicit text noise for V6',()=>{
    const context={'Độ ồn':'Ồn ào ở mức vừa phải'}
    const finding={review_id:'r',theme_key:'noise',sentiment:'negative',evidence:context['Độ ồn']}
    expect(validateConsultantBatch({classifications:[],findings:[finding]},[row('',context)],5).findings).toHaveLength(1)
    const reviews=[row('Nhà hàng quá ồn, khó nói chuyện.',context)]
    expect(validateConsultantBatch({classifications:[],findings:[{...finding,evidence:'quá ồn, khó nói chuyện'}]},reviews,6).findings).toHaveLength(1)
    expect(structuredContextStats(reviews).noise.moderate).toBe(1)
  })
  it('sends no metadata to extraction, using one mocked call and unchanged model',async()=>{
    vi.stubGlobal('Deno',{env:{get:()=> 'test-key'}})
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({classifications:[],findings:[]})}]}],usage:{input_tokens:1,output_tokens:1}})))
    vi.stubGlobal('fetch',fetch)
    await extractConsultantBatch([row('Good food',{'Độ ồn':'SECRET_CONTEXT'})],undefined,'gpt-6.1-sol',6)
    expect(fetch).toHaveBeenCalledTimes(1)
    const payload=JSON.parse(fetch.mock.calls[0][1].body)
    expect(payload.model).toBe('gpt-6.1-sol')
    expect(JSON.stringify(payload)).not.toContain('SECRET_CONTEXT')
    expect(JSON.stringify(payload)).toContain('original_text ONLY')
  })
  it('aggregates the real 100-review Shabu snapshot bit-for-bit deterministically',()=>{
    expect(snapshot).toHaveLength(100)
    const a=structuredContextStats(snapshot),b=structuredContextStats(structuredClone(snapshot))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(structuredContextStats([...snapshot].reverse())).toEqual(a)
    expect(a.noise).toEqual({total:31,quiet:15,moderate:14,noisy_conversation_possible:2,unknown:0})
    expect(a.wait_time).toMatchObject({total:2,no_wait:1,under_10_min:1,unknown:0})
    expect(a.price_per_person.total).toBeGreaterThan(0)
    expect(JSON.stringify(a)).not.toMatch(/positive|negative|sentiment/)
  })
  it('counts unique reviews, preserves unknown values and uncertain prices',()=>{
    const r=row('',{'Độ ồn':'other','Thời gian chờ':'10–30 phút','Giá mỗi người':'500–600 N ₫'})
    const result=structuredContextStats([r,r])
    expect(result.noise).toMatchObject({total:1,unknown:1})
    expect(result.wait_time.from_10_to_30_min).toBe(1)
    expect(result.price_per_person.ranges).toEqual([{value:'500–600 k₫',count:1}])
    expect(normalizeContextPrice('900 N ₫ - 1 Tr ₫')).toBe('900 N ₫ - 1 Tr ₫')
    expect(structuredContextStats([{id:'a',review_context:null},{id:'b',review_context:[]}]).noise.total).toBe(0)
  })
  it.each([['Không phải chờ','no_wait'],['Dưới 10 phút','under_10_min'],['10–30 phút','from_10_to_30_min'],['30–60 phút','from_30_to_60_min'],['Hơn 60 phút','over_60_min'],['15–45 phút','unknown']] as const)('normalizes wait %s without sentiment', (value,bucket)=>{
    expect(structuredContextStats([row('',{'Thời gian chờ':value})]).wait_time[bucket]).toBe(1)
  })
  it('never falls back to translated text for V6 extraction or evidence',()=>{
    const review={...row('',{'Độ ồn':'Yên tĩnh, dễ trò chuyện'}),original_text:null,text:'Very quiet and relaxing'}
    expect(consultantBatches([review],6)).toEqual([])
    expect(validateConsultantBatch({classifications:[],findings:[{review_id:'r',theme_key:'noise',sentiment:'positive',evidence:'Very quiet'}]},[review],6).findings).toEqual([])
  })
  it.each(['fr','vi'] as const)('formats natural lists in %s',language=>{
    expect(formatNaturalList([],language)).toBe('')
    expect(formatNaturalList(['A'],language)).toBe('A')
    expect(formatNaturalList(['A','B'],language)).toBe(language==='fr'?'A et B':'A và B')
    expect(formatNaturalList(['A','B','C'],language)).toBe(language==='fr'?'A, B et C':'A, B và C')
  })
})
