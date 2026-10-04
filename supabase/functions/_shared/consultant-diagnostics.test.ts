import {describe,it,expect} from 'vitest'
import {axisStatus,buildAxisDiagnostics,coverageLevel,globalDecisionSummary,recurringThreshold,strongSignalThreshold,uniqueAxisCoverage,type CountedTopic} from './consultant-diagnostics'
import {shabuTopics,shabuSource} from '../../../tests/fixtures/consultant-v5'
const negative=(mentions:number,key='noise',axis:CountedTopic['axis']='atmosphere'):CountedTopic=>({key:`${key}:negative`,axis,sentiment:'negative',mentions,label:key,review_ids:Array.from({length:mentions},(_,i)=>String(i))})
describe('V5 deterministic diagnostics',()=>{
  it.each([[100,3,false,false],[100,5,true,false],[100,10,true,true],[500,20,false,false],[500,25,true,false],[1000,50,true,false]])('threshold %i / %i',(total,count,recurring,strong)=>{
    expect(count>=recurringThreshold(total)).toBe(recurring)
    expect(count>=strongSignalThreshold(total)).toBe(strong)
  })
  it.each([[0,'limited'],[0.199,'limited'],[0.2,'medium'],[0.499,'medium'],[0.5,'strong'],[1,'strong']] as const)('coverage %s', (rate,level)=>expect(coverageLevel(rate)).toBe(level))
  it('gives signals precedence over a high rating, but keeps low coverage cautious',()=>{
    expect(axisStatus(4.9,.93,[],100)).toBe('major_strength')
    expect(axisStatus(4.9,.93,[negative(6)],100)).toBe('watch')
    expect(axisStatus(4.9,.93,[negative(10)],100)).toBe('priority')
    expect(axisStatus(null,.13,[negative(3)],100)).toBe('limited_data')
    expect(axisStatus(null,.35,[negative(10)],100)).toBe('priority')
    expect(axisStatus(4.9,.01,[],100)).toBe('limited_data')
    expect(axisStatus(4.6,.9,[],100)).toBe('strength')
  })
  it.each(['fr','vi'] as const)('Shabu: high ratings, isolated quality, watch noise, limited price (%s)',language=>{
    const topics=shabuTopics(language),before=JSON.stringify(topics),d=buildAxisDiagnostics(100,topics,shabuSource,language)
    expect(d.service.status).toBe('major_strength');expect(d.quality.status).toBe('major_strength')
    expect(d.quality.recurring_negative).toEqual([]);expect(d.quality.isolated_negative[0].mentions).toBe(3)
    expect(d.atmosphere).toMatchObject({status:'watch',subrating_average:4.902173,subrating_count:92})
    expect(d.atmosphere.recurring_negative.map(t=>t.key)).toEqual(['noise:negative'])
    expect(d.price).toMatchObject({status:'limited_data',subrating_average:null,subrating_count:0,textual_review_count:13,coverage_rate:.13})
    const decision=globalDecisionSummary(d,language)
    expect(decision.strengths.map(t=>t.axis)).toEqual(['quality','service','atmosphere'])
    expect(decision.manager_priorities.map(t=>t.key)).toEqual(['noise:negative'])
    expect(decision.limited_axes).toEqual(['price']);expect(JSON.stringify(topics)).toBe(before)
  })
  it('uses unique review IDs across themes AND sentiments, never summed mentions',()=>{
    const topics=shabuTopics('fr'),price=topics.filter(t=>t.axis==='price')
    expect(price.reduce((sum,t)=>sum+t.mentions,0)).toBe(14)
    expect(uniqueAxisCoverage([...topics,...price],'price')).toBe(13)
  })
  it('Artisan: only food quality and price level qualify out of these complaints',()=>{
    const d=buildAxisDiagnostics(500,[negative(34,'food_quality','quality'),negative(32,'price_level','price'),negative(10,'communication','service')],{},'fr')
    expect(globalDecisionSummary(d,'fr').manager_priorities.map(t=>t.key)).toEqual(['food_quality:negative','price_level:negative'])
    expect(d.service.recurring_negative).toEqual([])
  })
  it('K.HOUSE: noise remains watch while small themes stay secondary',()=>{
    const d=buildAxisDiagnostics(100,[negative(9),negative(3,'cleanliness')],shabuSource,'vi')
    expect(d.atmosphere.status).toBe('watch')
    expect(d.atmosphere.recurring_negative.map(t=>t.key)).toEqual(['noise:negative'])
  })
  it('handles no data without fabricated averages, coverage or strengths',()=>{
    const d=buildAxisDiagnostics(0,[],{},'fr')
    expect(Object.values(d).every(a=>a.coverage_rate===0 && a.subrating_average===null && a.status==='limited_data')).toBe(true)
    expect(globalDecisionSummary(d,'fr').strengths).toEqual([])
  })
  it('caps per-axis topics and manager priorities, without losing isolated data',()=>{
    const topics=[negative(20,'noise'),negative(15,'cleanliness'),negative(10,'decor'),negative(1,'comfort')]
    const d=buildAxisDiagnostics(100,topics,shabuSource,'fr')
    expect(d.atmosphere.recurring_negative).toHaveLength(2)
    expect(d.atmosphere.isolated_negative).toHaveLength(1)
    expect(globalDecisionSummary(d,'fr').manager_priorities).toHaveLength(2)
  })
  it('preserves the representative atmosphere headline over a slightly larger noise topic',()=>{
    const topics=shabuTopics('fr')
    topics.push({...negative(35,'noise'),sentiment:'positive',key:'noise:positive'})
    const d=buildAxisDiagnostics(100,topics,shabuSource,'fr')
    expect(globalDecisionSummary(d,'fr').strengths.find(t=>t.axis==='atmosphere')?.key).toBe('atmosphere:positive')
    expect(d.atmosphere.recurring_negative[0].key).toBe('noise:negative')
  })
})
