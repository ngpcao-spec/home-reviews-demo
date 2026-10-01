import { describe, expect, it } from 'vitest'
import { normalizedSubratings, relevantContext, reputationMetrics, reviewBatches, type ReputationReview } from './reputation-metrics.ts'
import { mergeThemes, representativeIds, validatedFindings, type Finding } from './reputation-themes.ts'

const review = (id: string, rating: number, patch: Partial<ReputationReview> = {}): ReputationReview => ({
  id, rating, original_text: 'Good food but slow service', text: null, published_at: '2026-09-01T00:00:00Z',
  historical_import: true, has_negative_feedback: null, status: 'new', review_context: null,
  review_detailed_rating: null, ...patch,
})

describe('reputation metrics', () => {
  it('normalizes Vietnamese, French and English without counting aliases twice', () => {
    expect(normalizedSubratings({'Đồ ăn':5,'Dịch vụ':4,'Bầu không khí':3,Food:1})).toEqual({food:5,service:4,atmosphere:3})
    expect(normalizedSubratings({Cuisine:'4,5/5',Service:5,Atmosphere:4})).toEqual({food:4.5,service:5,atmosphere:4})
    expect(normalizedSubratings({Food:0,Service:6,Ambiance:'unknown'})).toEqual({})
  })
  it('uses all five ratings and keeps negative rates distinct from attention', () => {
    const rows = [1,2,3,4,5].map((rating)=>review(String(rating),rating))
    rows.push(review('flagged',4,{historical_import:false,has_negative_feedback:true,ready:true}))
    rows.push(review('historical-four',4,{has_negative_feedback:true}))
    const result=reputationMetrics(rows,100)
    expect(result.sample_reviews_count).toBe(7)
    expect(result.sample_average_rating).toBe(23/7)
    expect(result.positive_rate).toBe(4/7*100)
    expect(result.negative_reviews_count).toBe(3)
    expect(result.attention_reviews_count).toBe(4)
    expect(result.ready_replies_count).toBe(1)
    expect(result.remaining_replies_count).toBe(3)
    expect(result.data_complete).toBe(false)
  })
  it('reports exact subrating coverage independently of sample size', () => {
    const result=reputationMetrics([review('a',5,{review_detailed_rating:{Food:5,Service:4}}),review('b',4,{review_detailed_rating:{Cuisine:3}}),review('c',3)],3)
    expect(result.food_average).toBe(4)
    expect(result.food_review_count).toBe(2)
    expect(result.service_review_count).toBe(1)
    expect(result.atmosphere_average).toBeNull()
    expect(result.atmosphere_review_count).toBe(0)
    expect(result.data_complete).toBe(true)
  })
  it('does not invent averages for missing data', () => {
    expect(reputationMetrics([],null)).toMatchObject({sample_reviews_count:0,sample_average_rating:null,positive_rate:0,food_average:null,data_complete:false})
  })
  it('counts processed independently and does not call a prepared reply missing', () => {
    expect(reputationMetrics([review('a',1,{status:'processed'}),review('b',2,{ready:true}),review('c',3)],3)).toMatchObject({processed_reviews_count:1,ready_replies_count:1,remaining_replies_count:1})
  })
  it('selects only relevant context and retains literal source evidence', () => {
    expect(relevantContext({'Độ ồn':'Yên tĩnh','Thời gian chờ':'45 phút','Giá mỗi người':'100'})).toEqual({noise_level:'Yên tĩnh',wait_time:'45 phút'})
  })
  it('batches 500 reviews rather than making 500 individual calls', () => {
    const batches=reviewBatches(Array.from({length:500},(_,i)=>review(String(i),5)))
    expect(batches).toHaveLength(9)
    expect(batches.flat()).toHaveLength(500)
    expect(Math.max(...batches.map(b=>b.length))).toBeLessThanOrEqual(60)
    expect(reviewBatches([review('empty',5,{original_text:''})])).toEqual([])
  })
})

describe('grounded report themes', () => {
  const finding:Finding={review_id:'a',theme_key:'wait_time',sentiment:'negative',evidence:'slow service'}
  it('deduplicates repeated mentions from one review', () => {
    const {findings:validated,rejectedCount}=validatedFindings([finding,finding],[review('a',3)])
    expect(rejectedCount).toBe(0)
    expect(validated).toHaveLength(1)
    expect(mergeThemes([...validated,...validated,{...finding,review_id:'b'}])[0].mentions).toBe(2)
  })
  it('rejects invented review IDs and invented evidence', () => {
    expect(validatedFindings([finding],[review('b',3)])).toEqual({findings:[],rejectedCount:1})
    expect(validatedFindings([{...finding,evidence:'dirty kitchen'}],[review('a',3)])).toEqual({findings:[],rejectedCount:1})
  })
  it('accepts exact evidence and deterministic NFC/whitespace normalization only', () => {
    expect(validatedFindings([finding],[review('a',3)])).toEqual({findings:[finding],rejectedCount:0})
    const normalized={...finding,evidence:'Café très lent'}
    expect(validatedFindings([normalized],[review('a',3,{original_text:'Cafe\u0301\u00a0 très\n\n lent'})])).toEqual({findings:[normalized],rejectedCount:0})
    expect(validatedFindings([{...finding,evidence:'Slow service'}],[review('a',3)])).toEqual({findings:[],rejectedCount:1})
  })
  it('rejects a paraphrase without dropping grounded findings', () => {
    const result=validatedFindings([finding,{...finding,theme_key:'food_quality',evidence:'Delicious dishes'}],[review('a',3)])
    expect(result).toEqual({findings:[finding],rejectedCount:1})
    expect(mergeThemes(result.findings).map(t=>t.theme_key)).toEqual(['wait_time'])
  })
  it('keeps 19 of 20 findings when one is invalid', () => {
    const rows=Array.from({length:20},(_,i)=>review(String(i),3))
    const raw=rows.map(r=>({...finding,review_id:r.id,evidence:r.id==='7'?'invented text':'slow service'}))
    const result=validatedFindings(raw,rows)
    expect(result.findings).toHaveLength(19)
    expect(result.rejectedCount).toBe(1)
    expect(mergeThemes(result.findings)[0].mentions).toBe(19)
  })
  it('accepts empty batches but fails an invalid top-level structure', () => {
    expect(validatedFindings([],[])).toEqual({findings:[],rejectedCount:0})
    expect(validatedFindings([null,{}, {...finding,sentiment:'neutral'}, {...finding,theme_key:'invented'}, {...finding,evidence:'  '}],[review('a',3)])).toEqual({findings:[],rejectedCount:5})
    expect(()=>validatedFindings(null,[])).toThrow('REPORT_INVALID_FINDINGS')
    expect(()=>validatedFindings({},[])).toThrow('REPORT_INVALID_FINDINGS')
  })
  it('only allows evidence in original text or authorized context', () => {
    const rows=[review('a',3,{review_context:{'Độ ồn':'Très calme',Parking:'Parking absent'}})]
    expect(validatedFindings([{...finding,evidence:'Très calme'}],rows).findings).toHaveLength(1)
    expect(validatedFindings([{...finding,evidence:'Parking absent'}],rows).rejectedCount).toBe(1)
  })
  it('deduplicates before enforcing the three-findings limit per review', () => {
    const raw=[finding,finding,...(['food_quality','attentiveness','coordination'] as const).map(theme_key=>({...finding,theme_key}))]
    const result=validatedFindings(raw,[review('a',3)])
    expect(result.findings).toHaveLength(3)
    expect(result.rejectedCount).toBe(1)
  })
  it('selects representatives by theme coverage, not text length', () => {
    const rows=[review('a',5),review('b',5,{original_text:'x'.repeat(2000)}),review('c',3),review('d',4,{has_negative_feedback:true})]
    const themes=mergeThemes([{...finding,theme_key:'food_quality',sentiment:'positive'}, {...finding,review_id:'c'},{...finding,review_id:'d'}])
    expect(representativeIds(rows,themes,'positive')).toEqual(['a'])
    expect(representativeIds(rows,themes,'negative')).toEqual(['c'])
  })
})
