import {describe,it,expect} from 'vitest'
import {compareHistoricalRuns,runSummary,type ComparisonRun} from './historical-comparison'
const source=(id:string):ComparisonRun=>({generation_id:id,model:'gpt-6.1-sol',input_tokens:100,output_tokens:50,token_usage_complete:true,started_at:'2026-10-06T00:00:00Z',completed_at:'2026-10-06T00:00:10Z',snapshot:{reviews:[{id:'a',original_text:'Private Russian original',original_language:'ru',analysis_text:'Friendly staff',analysis_language:'en',analysis_source:'google_translation_en'},{id:'b',original_text:'Good',original_language:'en',analysis_text:'Good',analysis_language:'en',analysis_source:'original_en'}]},classifications:[{review_id:'a',sentiment:'positive'},{review_id:'b',sentiment:'positive'}],findings:[{review_id:'a',theme_key:'friendly_staff',sentiment:'positive'}]})
describe('deterministic frozen V6/V7 comparison',()=>{
  it('compares keys, ignores wording of evidence, maps findings without axis, and never mutates runs',()=>{
    const a=source('v6'),b=source('v7'),before=JSON.stringify(a)
    b.classifications[0].sentiment='negative';b.findings.push({review_id:'a',theme_key:'attentiveness',sentiment:'positive'})
    const result=compareHistoricalRuns(a,b)
    expect(result.sentiment).toMatchObject({compared:2,agreement_percent:50,difference_count:1})
    expect(result.axes.service).toEqual({v6:1,v7:2,common:1,v6_only:0,v7_only:1})
    expect(result.service_themes.attentiveness.v7).toBe(1)
    expect(JSON.stringify(a)).toBe(before);expect(JSON.stringify(result)).not.toContain('Private Russian original')
  })
  it('restricts findings and sentiment to common reviews and reports dataset differences',()=>{
    const a=source('v6'),b=source('v7');b.snapshot.reviews=b.snapshot.reviews?.filter(r=>r.id==='b')
    const c=compareHistoricalRuns(a,b)
    expect(c.dataset).toEqual({v6:2,v7:1,common:1,v6_only:1,v7_only:0,identical:false})
    expect(c.sentiment.compared).toBe(1);expect(c.findings.common).toBe(0);expect(c.findings.v6_all).toBe(1)
  })
  it('estimates cost from persisted usage/configurable rates, calculates time and flags missing classifications',()=>{
    const a=source('v6'),b=source('v7');b.input_tokens=200;b.classifications=[]
    expect(runSummary(a,2,10)).toMatchObject({total_tokens:150,estimated_cost_usd:0.0007,elapsed_ms:10000,analysis_input_stats:{google_english_translation_count:1,english_analysis_coverage_percent:100}})
    const c=compareHistoricalRuns(a,b)
    expect(c.tokens_difference_percent).toBeCloseTo(66.6667);expect(c.sentiment.agreement_percent).toBeNull();expect(c.sentiment.missing_classification_count).toBe(2)
  })
})
