import {it,expect,vi,beforeAll,afterAll} from 'vitest';
import {DIRECT_CONFIG,DIRECT_CATEGORY_KEYS,DIRECT_NATIVE_CHOICES,DIRECT_ROUNDING_PARSER_VERSION,
 directHash,directCanonical,directCategoryPayload,directCategoryCounts,parseDirectCategories,parseDirectCategoriesRounded} from '../../supabase/functions/_shared/jev-direct-categories';
import {replayDirectSavedArchive,type DirectReplaySource} from '../../supabase/functions/_shared/jev-direct-categories-replay';
import {analysisTextSha256} from '../../supabase/functions/_shared/analysis-text';
import {directMockRaw} from '../fixtures/jev-direct-categories';
import realSix from '../fixtures/jev-direct-rounding-real6.json';
import frozenConfig from '../../docs/jev-direct-categories4-config-v1.json';
let net:ReturnType<typeof vi.spyOn>;
beforeAll(()=>{net=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('ALL_PROVIDER_NETWORK_FORBIDDEN'));});
afterAll(()=>{expect(net).not.toHaveBeenCalled();net.mockRestore();});
function rawWithSum(sum:number){const raw=directMockRaw({service:'mixed'});
 raw.answers.service.probabilities=Object.fromEntries(DIRECT_NATIVE_CHOICES.map(c=>[c,c==='positive'?sum/2:c==='negative'?sum/2:0]));return raw;}

it.each([1,.99,1.01])('accepts sum %s unchanged, with an explicit rounding diagnostic only when appropriate',sum=>{
 const raw=rawWithSum(sum),before=structuredClone(raw),r=parseDirectCategoriesRounded(raw);
 expect(raw).toEqual(before);expect(r.raw_response).toEqual(before);expect(r.categories.service.native_choice).toBe('mixed');
 expect(r.categories.service.probabilities).toEqual(raw.answers.service.probabilities);
 expect(r.version).toBe(DIRECT_ROUNDING_PARSER_VERSION);
 expect(r.probability_diagnostics).toHaveLength(sum===1?0:1);
 if(sum!==1)expect(r.probability_diagnostics![0]).toMatchObject({category:'service',code:'PROBABILITY_SUM_ROUNDING',
  received_sum:sum,absolute_tolerance:.01,normalized:false});
});
it.each([.989999999,1.010000001,.98,1.02,0,2])('rejects sum %s outside tolerance with a diagnostic, without normalization',sum=>{
 const raw=rawWithSum(sum),before=structuredClone(raw);
 try{parseDirectCategoriesRounded(raw);throw Error('EXPECTED_REJECTION');}catch(e){
  expect(e).toMatchObject({message:'JEV_DIRECT_DISTRIBUTION_OUTSIDE_TOLERANCE',diagnostic:{
   category:'service',code:'PROBABILITY_SUM_OUTSIDE_TOLERANCE',absolute_tolerance:.01,normalized:false}});}
 expect(raw).toEqual(before);
});
it.each([NaN,Infinity,-Infinity,-.001,1.001,'0.5',null])('still rejects invalid probability %s',value=>{
 const raw=rawWithSum(1);Object.assign(raw.answers.service.probabilities!,{positive:value});
 expect(()=>parseDirectCategoriesRounded(raw)).toThrow('INVALID_PROBABILITY');
});
it.each(['missing_category','extra_category','bad_choice','missing_probability','extra_probability','unreadable','wrong_type'] as const)('keeps essential structural check %s',kind=>{
 const raw=rawWithSum(1);
 if(kind==='missing_category')delete raw.answers.quality;if(kind==='extra_category')raw.answers.other=raw.answers.service;
 if(kind==='bad_choice')raw.answers.service.choice='both';if(kind==='missing_probability')delete raw.answers.service.probabilities!.uncertain;
 if(kind==='extra_probability')raw.answers.service.probabilities!.other=0;if(kind==='wrong_type')raw.answers.service.type='predicate';
 expect(()=>parseDirectCategoriesRounded(kind==='unreadable'?'not json':raw)).toThrow();
});
it('preserves the frozen supplier config and historical strict parser instead of reinterpreting saved V1 results',async()=>{
 expect(DIRECT_CONFIG).toEqual(frozenConfig);expect(await directHash(DIRECT_CONFIG)).toBe('e5995c6e4b3a8f5949cbcde2531180ad3af503e50ee38b1b7674fceed561fe69');
 expect(()=>parseDirectCategories(rawWithSum(.99))).toThrow('INVALID_DISTRIBUTION');
 expect(parseDirectCategories(rawWithSum(1))).not.toHaveProperty('probability_diagnostics');
 const old=parseDirectCategories(rawWithSum(1)),rounded=parseDirectCategoriesRounded(rawWithSum(.99));
 expect(directCategoryCounts(['old','rounded'],[{review_id:'old',result:old},{review_id:'rounded',result:rounded}]).received_results).toBe(2);
 rounded.probability_diagnostics=[];expect(()=>directCategoryCounts(['r'],[{review_id:'r',result:rounded}])).toThrow('RESULT_CHANGED');
});
it.each(realSix.cases)('recovers real saved response $review_id without changing any native choice, probability or raw bytes',async c=>{
 expect(await analysisTextSha256(c.raw_response_text)).toBe(c.response_raw_sha256);
 const raw=JSON.parse(c.raw_response_text);expect(()=>parseDirectCategories(raw)).toThrow('INVALID_DISTRIBUTION');
 const r=parseDirectCategoriesRounded(raw);expect(r.probability_diagnostics).toHaveLength(1);
 expect(r.probability_diagnostics![0].received_sum).toBeCloseTo(.99,14);expect(r.raw_response).toEqual(raw);
 for(const category of DIRECT_CATEGORY_KEYS){expect(r.categories[category].native_choice).toBe(raw.answers[category].choice);
  expect(r.categories[category].probabilities).toEqual(raw.answers[category].probabilities);}
});
it('deduplicates mixed counters within each category and rejects repeated IDs or modified native choices',()=>{
 const rows=realSix.cases.map(c=>({review_id:c.review_id,result:parseDirectCategoriesRounded(JSON.parse(c.raw_response_text))}));
 const mixed={review_id:'synthetic_mixed',result:parseDirectCategoriesRounded(rawWithSum(.99))};rows.push(mixed);
 const ids=rows.map(r=>r.review_id),counts=directCategoryCounts(ids,rows);
 expect(counts.total_reviews).toBe(7);
 for(const k of DIRECT_CATEGORY_KEYS){const c=counts.categories[k];expect(Object.values(c.exclusive).reduce((a,b)=>a+b,0)).toBe(7);
  expect(c.positive_review_ids.length).toBe(new Set(c.positive_review_ids).size);expect(c.negative_review_ids.length).toBe(new Set(c.negative_review_ids).size);}
 expect(counts.categories.service.positive_review_ids).toContain('synthetic_mixed');expect(counts.categories.service.negative_review_ids).toContain('synthetic_mixed');
 expect(()=>directCategoryCounts(ids,[...rows,rows[0]])).toThrow('DUPLICATE');
 mixed.result.categories.service.native_choice='positive';expect(()=>directCategoryCounts(ids,rows)).toThrow('RESULT_CHANGED');
});

async function syntheticArchive():Promise<DirectReplaySource>{
 const reviews=await Promise.all(Array.from({length:80},async(_,i)=>{
  const analysis_text='EXPLICIT SYNTHETIC TEXT '+i,review_alias='review_'+i,request=directCategoryPayload(review_alias,analysis_text),
   raw=i<6?JSON.parse(realSix.cases[i].raw_response_text):directMockRaw(),raw_response_text=JSON.stringify(raw);
  return {review_id:'synthetic_'+i,organization_id:'synthetic_org',establishment_id:'synthetic_establishment',analysis_text,analysis_language:'en',review_alias,
   analysis_text_sha256:await analysisTextSha256(analysis_text),request_sha256:await directHash(request),request_raw_sha256:await analysisTextSha256(JSON.stringify(request)),
   raw_response_text,response_raw_sha256:await analysisTextSha256(raw_response_text),result_id:'synthetic_result_'+i,result_sha256:'0'.repeat(64),
   status:i<6?'failed_or_uncertain':'completed',error:i<6?'JEV_DIRECT_INVALID_DISTRIBUTION':null,result:i<6?null:parseDirectCategories(raw)};
 }));
 const body={version:'jev-direct-categories4-full80-dataset-v1',configuration_id:DIRECT_CONFIG.id,configuration_sha256:await directHash(DIRECT_CONFIG),
  denominators:{source_reviews:100,analytical_reviews:80,textless_statistics_only:20},reviews,usage:{explicit_synthetic_usage:true}};
 return {id:'synthetic_archive',organization_id:'synthetic_org',protocol_id:'synthetic_protocol',sha256:await directHash(body),body};
}
it('replays 80 receipts deterministically, keeps source immutable, separates provenance and reports technical usability only',async()=>{
 const s=await syntheticArchive(),before=directCanonical(s),r=await replayDirectSavedArchive(s,'a'.repeat(40));
 expect(directCanonical(s)).toBe(before);expect(await replayDirectSavedArchive(s,'a'.repeat(40))).toEqual(r);
 expect(await directHash(r.body)).toBe(r.sha256);expect(r.body.source_archive.id).toBe(s.id);
 expect(r.body.counts.received_results).toBe(80);expect(r.body.recovered_review_ids).toHaveLength(6);expect(r.body.probability_diagnostics).toHaveLength(6);
 expect(r.body.remaining_anomalies).toEqual([]);expect(r.body).toMatchObject({new_provider_calls:0,run_id:null,spending_authorization:null,semantic_correctness_validated:false});
 for(const row of r.body.reviews){const original=s.body.reviews.find(x=>x.review_id===row.review_id)!;
  expect(row.analysis_text).toBe(original.analysis_text);expect(row.raw_response_text).toBe(original.raw_response_text);
  expect(row.source_result.sha256).toBe(original.result_sha256);expect(row.result_sha256).toBe(await directHash(row.result));}
});
it('reports an out-of-tolerance response as unusable instead of silently accepting it',async()=>{
 const s=await syntheticArchive(),row=s.body.reviews[0];row.raw_response_text=JSON.stringify(rawWithSum(.98));
 row.response_raw_sha256=await analysisTextSha256(row.raw_response_text);s.sha256=await directHash(s.body);
 const r=await replayDirectSavedArchive(s,'a'.repeat(40));expect(r.body.counts.received_results).toBe(79);
 expect(r.body.remaining_anomalies).toMatchObject([{review_id:row.review_id,error:'JEV_DIRECT_DISTRIBUTION_OUTSIDE_TOLERANCE',
  diagnostic:{code:'PROBABILITY_SUM_OUTSIDE_TOLERANCE'}}]);
});
it.each(['source_hash','config','text','raw','request','tenant','duplicate'] as const)('refuses changed %s before archiving',async kind=>{
 const s=await syntheticArchive();
 if(kind==='source_hash')s.sha256='0'.repeat(64);if(kind==='config')s.body.configuration_sha256='0'.repeat(64);
 if(kind==='text')s.body.reviews[0].analysis_text+='modified';if(kind==='raw')s.body.reviews[0].raw_response_text+=' ';
 if(kind==='request')s.body.reviews[0].request_sha256='0'.repeat(64);if(kind==='tenant')s.body.reviews[0].organization_id='other';
 if(kind==='duplicate')s.body.reviews[1]=s.body.reviews[0];if(kind!=='source_hash')s.sha256=await directHash(s.body);
 await expect(replayDirectSavedArchive(s,'a'.repeat(40))).rejects.toThrow();
});
