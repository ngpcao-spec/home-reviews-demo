// @vitest-environment node
import {describe,it,expect} from 'vitest'
import {analysisTextSha256} from '../../supabase/functions/_shared/analysis-text.ts'
import {chosenAnalysisText,chosenAnalysisStats} from '../../supabase/functions/_shared/chosen-analysis-text.ts'
import {customerRatingStats,customerRatings} from '../../supabase/functions/_shared/customer-ratings.ts'
import {apifyActorInput} from '../../supabase/functions/_shared/apify.ts'
describe('native chosen analysis language',()=>{
 it.each(['fr','vi'] as const)('sends one %s collection and selects matching Google input or original',async target=>{
  expect(apifyActorInput({placeUrl:'https://maps.google.com/?cid=123',language:target,sort:'newest',limit:150})).toMatchObject({language:target,maxReviews:150})
  for(const source of ['fr','vi','en','ru',null]){
   const original='Original '+source,hash=await analysisTextSha256(original),translated=target==='fr'?'Traduction française':'Bản dịch Việt'
   const input={original_text:original,original_language:source,review_translations:[{id:'native',language:target,translated_text:translated,source_text_sha256:hash},{language:'en',translated_text:'English intermediate',source_text_sha256:hash}]}
   const result=await chosenAnalysisText(input,target)
   expect(result.analysis_text).toBe(source===target?original:translated)
   expect(result.analysis_target_language).toBe(target);expect(result.analysis_text_sha256).toBe(await analysisTextSha256(result.analysis_text))
   expect(result.analysis_translation_provenance.provider_translation_id).toBe(source===target?null:'native')
  }
 })
 it('rejects incompatible, stale and unbound translations without translating',async()=>{
  for(const entry of [{language:'en',translated_text:'Wrong'},{language:'fr',translated_text:'Stale',source_text_sha256:'bad'},{language:'fr',translated_text:'Unbound'}]){
   const result=await chosenAnalysisText({original_text:'Tiếng Việt gốc',original_language:'vi',review_translations:[entry]},'fr')
   expect(result.analysis_text).toBe('Tiếng Việt gốc');expect(result.analysis_translation_provenance.translation_missing).toBe(true)
  }
 })
 it('skips textless reviews and counts missing native versions separately',async()=>{
  const rows=await Promise.all([chosenAnalysisText({original_text:'   ',original_language:'en'},'vi'),chosenAnalysisText({original_text:'English',original_language:'en'},'vi'),chosenAnalysisText({original_text:'Bản gốc',original_language:'vi'},'vi')])
  expect(rows[0].analysis_text).toBe('');expect(chosenAnalysisStats(rows,'vi')).toMatchObject({total_reviews:3,reviews_with_text:2,textless_reviews:1,original_target_count:1,missing_target_translation_count:1})
 })
})
describe('actual customer ratings, independently of detected sentiment',()=>{
 it('normalizes FR/VI labels without inferring category scores from the overall score',()=>{
  expect(customerRatings({'Nourriture':'4/5','Dịch vụ':3,'Không gian':'4,5','Prix par personne':'200000 VND'})).toEqual({food:4,service:3,atmosphere:4.5,price:null})
  expect(customerRatings({'Cuisine':3,food:5})).toMatchObject({food:null})
  const stats=customerRatingStats([{id:'a',rating:5,review_detailed_rating:{'Đồ ăn':4}},{id:'b',rating:2,review_detailed_rating:{Service:0}},{id:'b',rating:2,review_detailed_rating:{Service:0}}])
  expect(stats.total_reviews).toBe(2);expect(stats.overall).toEqual({count:2,average:3.5});expect(stats.categories.food).toEqual({count:1,average:4});expect(stats.categories.service).toEqual({count:0,average:null})
 })
})
