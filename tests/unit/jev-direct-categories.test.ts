import {it,expect,vi,beforeAll,afterAll} from 'vitest';
import {DIRECT_CONFIG,DIRECT_RULES,DIRECT_DEFINITIONS,DIRECT_CATEGORY_KEYS,DIRECT_NATIVE_CHOICES,DIRECT_LABELS,
 directCategoryPayload,parseDirectCategories,directCategoryCounts,directHash,type DirectCountRow} from '../../supabase/functions/_shared/jev-direct-categories';
import {prepareDirectCategories,verifyDirectCategoriesProtocol} from '../../supabase/functions/_shared/jev-direct-categories-preparation';
import {evaluateDirectCategoriesOnce,type DirectOncePort} from '../../supabase/functions/_shared/jev-direct-categories-once';
import {directMockRaw,directSyntheticSource,directRuleCases} from '../fixtures/jev-direct-categories';
import configDocument from '../../docs/jev-direct-categories4-config-v1.json';
let net:ReturnType<typeof vi.spyOn>;
beforeAll(()=>{net=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('ALL_PROVIDER_NETWORK_FORBIDDEN'));});
afterAll(()=>{expect(net).not.toHaveBeenCalled();net.mockRestore();});
const code='a'.repeat(40);
it('uses exactly four independent choice questions and five classes plus a distinct native abstention, without quotes or metadata',()=>{
 const q=directCategoryPayload('review_1','Good service.');
 expect(Object.keys(q.state)).toEqual(['review_alias','analysis_text']);expect(Object.keys(q.questions)).toEqual([...DIRECT_CATEGORY_KEYS]);
 for(const raw of Object.values(q.questions)){const question=raw as {type:string;instructions:string;criteria:object};expect(question.type).toBe('choice');
  expect(Object.keys(question.criteria)).toEqual([...DIRECT_NATIVE_CHOICES]);expect(question.instructions).toContain('independently');
  expect(Object.keys(question)).toEqual(['type','instructions','criteria']);}
 expect(DIRECT_LABELS).toHaveLength(5);expect(DIRECT_CONFIG.confidence_threshold).toBeNull();expect(DIRECT_CONFIG.paid_enabled).toBe(false);
 expect(configDocument).toEqual(DIRECT_CONFIG);
 expect(DIRECT_DEFINITIONS.quality.scope_fr).toContain('boissons');expect(DIRECT_DEFINITIONS.ambiance.scope_fr).toContain('propreté des lieux');
 expect(()=>directCategoryPayload('r',' ')).toThrow('TEXT_REQUIRED');expect(()=>directCategoryPayload('','Food.')).toThrow();
});
it('freezes explicit boundaries for service/drinks, price facts, neutrality, uncertainty, geography, context and causality',()=>{
 for(const rule of ['Good service alone','Good beverages with slow delivery','A monetary amount alone','neither good nor bad','Not extraordinary alone',
  'not_mentioned as a substitute for ambiguity','Geographic location','later resolution','medical cause','ordering too many dishes'])expect(DIRECT_RULES).toContain(rule);
 expect(Object.isFrozen(DIRECT_CONFIG.questions)).toBe(true);
});
it.each(directRuleCases)('synthetic response contract only: $name',({expected})=>{
 const r=parseDirectCategories(directMockRaw(expected));
 for(const k of DIRECT_CATEGORY_KEYS){expect(r.categories[k].native_choice).toBe(expected[k]??'not_mentioned');
  expect(r.categories[k].classification).toBe(expected[k]==='uncertain'?null:expected[k]??'not_mentioned');}
 // These test fixtures exercise the contract and plumbing, never real model accuracy.
});
it('preserves native choice, low confidence and probabilities without an invented threshold or argmax override',()=>{
 const raw=directMockRaw({service:'positive'});raw.answers.service.confidence=.01;
 raw.answers.service.probabilities={positive:.1,negative:.7,mixed:.05,neutral:.05,not_mentioned:.05,uncertain:.05};
 const a=parseDirectCategories(raw).categories.service;expect(a.classification).toBe('positive');expect(a.native_confidence).toBe(.01);
 expect(a.probabilities).toEqual(raw.answers.service.probabilities);expect(a.raw_answer).toEqual(raw.answers.service);
});
it('keeps unavailable telemetry null and refusal/uncertainty separate from absence',()=>{
 const raw=directMockRaw({quality:'uncertain'});delete raw.usage;delete raw.answers.price.probabilities;delete raw.answers.price.confidence;
 raw.answers.service={type:'refusal'};const r=parseDirectCategories(raw);
 expect(r.usage).toBeNull();expect(r.telemetry_warnings).toEqual(['USAGE_MISSING_OR_INVALID']);
 expect(r.categories.price.probabilities).toBeNull();expect(r.categories.price.native_confidence).toBeNull();
 expect(r.categories.quality).toMatchObject({native_choice:'uncertain',classification:null,status:'uncertain'});
 expect(r.categories.service).toMatchObject({native_choice:null,classification:null,status:'refused'});
 expect(r.categories.ambiance.classification).toBe('not_mentioned');
});
it.each(['missing','extra','old_choice','probability','distribution','incomplete_distribution','confidence','wrong_type','old_themes'] as const)('rejects invalid %s without reclassifying it as absence',kind=>{
 const raw=directMockRaw();if(kind==='missing')delete raw.answers.service;if(kind==='extra')raw.answers.extra=raw.answers.service;
 if(kind==='old_choice')raw.answers.service.choice='both';if(kind==='probability')raw.answers.service.probabilities!.positive=-1;
 if(kind==='distribution')raw.answers.service.probabilities!.positive=.5;if(kind==='incomplete_distribution')delete raw.answers.service.probabilities!.uncertain;
 if(kind==='confidence')raw.answers.service.confidence=2;if(kind==='wrong_type')raw.answers.service.type='noul';
 if(kind==='old_themes'){delete raw.answers.quality;raw.answers.food_quality=raw.answers.service;}
 expect(()=>parseDirectCategories(raw)).toThrow();
});
it('counts mixed once distinctly, in both polarities, and never sums categories to invent a review denominator',()=>{
 const rows:DirectCountRow[]=[{review_id:'r1',result:parseDirectCategories(directMockRaw({service:'mixed',quality:'positive',price:'negative',ambiance:'neutral'}))},
  {review_id:'r2',result:parseDirectCategories(directMockRaw({service:'positive',quality:'uncertain'}))},{review_id:'r3',result:null}];
 const c=directCategoryCounts(['r1','r2','r3','r4'],rows);expect(c.total_reviews).toBe(4);expect(c.received_results).toBe(2);expect(c.any_category_mentioned_reviews).toBe(2);
 expect(c.categories.service).toMatchObject({positive_including_mixed:2,negative_including_mixed:1,distinct_mentioned_reviews:2,denominator_reviews:4,
  exclusive:{positive:1,mixed:1,negative:0,unavailable:2,not_mentioned:0}});
 expect(c.categories.quality.exclusive).toMatchObject({positive:1,uncertain:1,not_mentioned:0,unavailable:2});
 expect(c.categories.ambiance.exclusive).toMatchObject({neutral:1,not_mentioned:1});
 expect(()=>directCategoryCounts(['r1','r1'],rows)).toThrow();expect(()=>directCategoryCounts(['r1'],[rows[0],rows[0]])).toThrow();
 expect(()=>directCategoryCounts(['other'],[rows[0]])).toThrow();
 rows[0].result!.categories.service.classification='not_mentioned';expect(()=>directCategoryCounts(['r1','r2','r3'],rows)).toThrow('RESULT_CHANGED');
});
it('keeps all five exclusive labels, native uncertainty and refusal separately countable',()=>{
 const rows=DIRECT_NATIVE_CHOICES.map((choice,i)=>({review_id:'r'+i,result:parseDirectCategories(directMockRaw({service:choice}))}));
 const raw=directMockRaw();raw.answers.service={type:'refusal'};rows.push({review_id:'refusal',result:parseDirectCategories(raw)});
 const c=directCategoryCounts(rows.map(r=>r.review_id),rows).categories.service;
 expect(c.exclusive).toEqual({positive:1,negative:1,mixed:1,neutral:1,not_mentioned:1,uncertain:1,refused:1,unavailable:0});
 expect(c.positive_including_mixed).toBe(2);expect(c.negative_including_mixed).toBe(2);expect(c.distinct_mentioned_reviews).toBe(4);
});
it('freezes 80 unchanged English texts, 320 questions, and 20 textless IDs without old labels, consent, run or supplier dispatch',async()=>{
 const source=await directSyntheticSource(),before=await directHash(source),p=await prepareDirectCategories(source,code);
 expect(await verifyDirectCategoriesProtocol(p)).toBe(true);expect(p.body.reviews).toHaveLength(80);expect(p.body.textless_review_ids).toHaveLength(20);
 expect(p.body.policy).toMatchObject({max_jev_calls:80,max_questions:320,max_attempts_per_review:1,repeat_count:1,automatic_retry:false,model_probe_calls:0});
 expect(p.body.reference_annotations).toBeNull();expect(p.body.previous_25_theme_classifications_reused).toBe(false);
 expect(p.body.results).toBeNull();expect(p.body.spending_authorization).toBeNull();expect(p.body.run_id).toBeNull();expect(p.body.provider_calls).toBe(0);
 expect(await directHash(source)).toBe(before);expect(await prepareDirectCategories(source,code)).toEqual(p);
 for(const r of p.body.reviews){expect(r.analysis_text).toBe(source.reviews.find(s=>s.id===r.review_id)!.analysis_text);expect(r).not.toHaveProperty('rating');}
});
it.each(['source_hash','text','tenant','duplicate','missing','language','textless'] as const)('refuses changed source %s',async kind=>{
 const s=await directSyntheticSource();if(kind==='source_hash')s.record_sha256='0'.repeat(64);if(kind==='text')s.reviews[0].analysis_text+='changed';
 if(kind==='tenant')s.reviews[0].organization_id='foreign';if(kind==='duplicate')s.reviews[1]=s.reviews[0];if(kind==='missing')s.reviews.pop();
 if(kind==='language')s.reviews[0].analysis_language='ru';if(kind==='textless')s.reviews[80].analysis_text='new text';
 await expect(prepareDirectCategories(s,code)).rejects.toThrow();
});
it.each(['request','configuration','policy','reference','consent','result'] as const)('refuses changed prepared %s even if the outer hash is recomputed',async kind=>{
 const p=await prepareDirectCategories(await directSyntheticSource(),code);
 if(kind==='request')p.body.reviews[0].review_alias='changed';if(kind==='configuration')p.body.configuration={...p.body.configuration,requested_model:'other'} as typeof p.body.configuration;
 if(kind==='policy')p.body.policy={...p.body.policy,max_questions:999} as typeof p.body.policy;
 if(kind==='reference')Object.assign(p.body,{reference_annotations:{service:'positive'}});if(kind==='consent')Object.assign(p.body,{spending_authorization:'not-authorized'});
 if(kind==='result')Object.assign(p.body,{results:[directMockRaw()]});p.sha256=await directHash(p.body);await expect(verifyDirectCategoriesProtocol(p)).rejects.toThrow();
});
async function onceFixture(){
 const p=await prepareDirectCategories(await directSyntheticSource(),code),consumed=new Set<string>(),events:string[]=[],receipts:Record<string,unknown>[]=[],results:Record<string,unknown>[]=[];let allowed=true,calls=0;
 const port:DirectOncePort={assertAuthorized:async()=>{if(!allowed)throw Error('EXPLICIT_MOCK_GO_MISSING');},reserve:async(id,request_sha256,configuration_sha256)=>{
  if(consumed.has(id))return null;consumed.add(id);events.push('reserve');return {id:'EXPLICIT_MOCK_RESERVATION',review_id:id,request_sha256,configuration_sha256,request_count:1};},
  saveReceipt:async body=>{receipts.push(body);events.push('receipt');return 'EXPLICIT_MOCK_RECEIPT';},saveResult:async body=>{results.push(body);events.push('result');return 'EXPLICIT_MOCK_RESULT';}};
 const transport:typeof fetch=async(url,init)=>{calls++;events.push('dispatch');expect(url).toBe('https://api.typesafe.ai/v1/systemone');expect(init?.method).toBe('POST');expect(init?.redirect).toBe('error');
  expect(Object.keys(JSON.parse(String(init?.body)).questions)).toHaveLength(4);return new Response(JSON.stringify(directMockRaw({service:'mixed'})));};
 return {p,port,transport,receipts,results,events,calls:()=>calls,deny:()=>{allowed=false;}};
}
it('reuses the native JEV adapter, reserves first, preserves raw before parsing and never dispatches twice',async()=>{
 const f=await onceFixture(),id=f.p.body.reviews[0].review_id;
 await Promise.all([evaluateDirectCategoriesOnce(f.p,id,f.port,'EXPLICIT_MOCK_KEY',f.transport),evaluateDirectCategoriesOnce(f.p,id,f.port,'EXPLICIT_MOCK_KEY',f.transport)]);
 expect(f.calls()).toBe(1);expect(f.events).toEqual(['reserve','dispatch','receipt','result']);expect(f.receipts[0].raw_response_text).toBe(JSON.stringify(directMockRaw({service:'mixed'})));
 expect(await evaluateDirectCategoriesOnce(f.p,id,f.port,'EXPLICIT_MOCK_KEY',f.transport)).toMatchObject({provider_calls:0});expect(f.calls()).toBe(1);
});
it.each(['network','timeout','429','500','invalid_json','invalid_answer','missing_usage','lost_receipt'] as const)('never retries after %s and retains available response data',async kind=>{
 const f=await onceFixture(),id=f.p.body.reviews[0].review_id;let calls=0;
 const transport:typeof fetch=async()=>{calls++;if(kind==='network'||kind==='timeout')throw TypeError('EXPLICIT_MOCK_LOSS');
  if(kind==='429'||kind==='500')return new Response('EXPLICIT_MOCK_HTTP_ERROR',{status:Number(kind)});if(kind==='invalid_json')return new Response('not JSON');
  const raw=directMockRaw();if(kind==='invalid_answer')delete raw.answers.quality;if(kind==='missing_usage')delete raw.usage;return new Response(JSON.stringify(raw));};
 if(kind==='lost_receipt')f.port.saveReceipt=async()=>{throw Error('EXPLICIT_MOCK_DB_LOSS');};
 try{await evaluateDirectCategoriesOnce(f.p,id,f.port,'EXPLICIT_MOCK_KEY',transport);}catch(e){expect(kind).toBe('lost_receipt');expect(String(e)).toContain('RECEIPT_NOT_CONFIRMED');}
 expect(calls).toBe(1);expect(await evaluateDirectCategoriesOnce(f.p,id,f.port,'EXPLICIT_MOCK_KEY',transport)).toMatchObject({provider_calls:0});expect(calls).toBe(1);
 if(!['network','timeout','lost_receipt'].includes(kind))expect(f.receipts[0].raw_response_text).not.toBeNull();
 if(kind!=='lost_receipt')expect(f.results[0].status).toBe('failed_or_uncertain');
});
it('requires future authorization and refuses textless/out-of-scope reviews before any reservation',async()=>{
 const f=await onceFixture();f.deny();await expect(evaluateDirectCategoriesOnce(f.p,f.p.body.reviews[0].review_id,f.port,'EXPLICIT_MOCK_KEY',f.transport)).rejects.toThrow('GO_MISSING');
 await expect(evaluateDirectCategoriesOnce(f.p,f.p.body.textless_review_ids[0],f.port,'EXPLICIT_MOCK_KEY',f.transport)).rejects.toThrow('OUT_OF_SCOPE');expect(f.calls()).toBe(0);expect(f.events).toEqual([]);
});
