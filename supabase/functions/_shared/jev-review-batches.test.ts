import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {SHORT_RULES} from './direct4-short-comparison.ts';
import {DIRECT_CATEGORY_KEYS,DIRECT_NATIVE_CHOICES,directCategoryCounts} from './jev-direct-categories.ts';
import {INITIAL_BATCH_CONTRACT,INITIAL_BATCH_CONTEXT,initialBatchPayload,initialBatchContext,planInitialBatches,
  initialBatchIdentity,parseBatchJson,parseInitialBatchResponse,type InitialBatch} from './jev-review-batches.ts';

const corpus=(n:number,text='Texte conservé, sans aucune troncature.')=>Array.from({length:n},(_,i)=>({
  review_id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,text}));
const proxy=(s:string)=>Math.ceil(s.length/4);
function response(batch:InitialBatch){
  return {model:'jev-1.13.0',usage:{input_tokens:1000,output_tokens:100},
    answers:Object.fromEntries(Object.keys(batch.mapping).map((k,i)=>{
      const choice=DIRECT_NATIVE_CHOICES[i%DIRECT_NATIVE_CHOICES.length];
      return [k,{type:'choice',choice,confidence:0.1,
        probabilities:Object.fromEntries(DIRECT_NATIVE_CHOICES.map(c=>[c,c===choice?0.7:0.06]))}];
    }))};
}
beforeEach(()=>{vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NO_NETWORK_IN_OFFLINE_TEST');}));});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});
describe('initial multi-review integration preparation',()=>{
  it('pools only the unchanged initial rules and the same six native choices',()=>{
    const b=initialBatchPayload(corpus(50));
    expect(b.payload.model).toBe('jev-1.13.0');
    expect(b.payload.state.consignes_communes.regles_metier).toBe(SHORT_RULES);
    expect(Object.keys(b.mapping)).toHaveLength(200);
    expect(b.mapping.r050_ambiance).toEqual({review_id:corpus(50)[49].review_id,category:'ambiance'});
    for(const q of Object.values(b.payload.questions))expect(q.criteria).toEqual(Object.fromEntries(DIRECT_NATIVE_CHOICES.map(k=>[k,null])));
    expect(INITIAL_BATCH_CONTRACT).toMatchObject({production_enabled:false,automatic_retry:false,max_attempts_per_batch:1,confidence_threshold:null});
  });
  it('uses the corpus size, not a restaurant-specific number of eleven batches',()=>{
    expect(planInitialBatches(corpus(527),proxy).map(b=>b.review_ids.length)).toEqual([...Array(10).fill(50),27]);
    expect(planInitialBatches(corpus(101),proxy).map(b=>b.review_ids.length)).toEqual([50,50,1]);
    expect(planInitialBatches([],proxy)).toEqual([]);
    expect(()=>planInitialBatches(corpus(1),proxy,{targetReviews:51})).toThrow('BATCH_INVALID_TARGET');
  });
  it('splits on context/body guard without changing any text or input order',()=>{
    const rows=corpus(51,'Tiếng Việt — '.repeat(200));
    const batches=planInitialBatches(rows,proxy,{context:{...INITIAL_BATCH_CONTEXT,body_bytes:22000}});
    expect(batches.length).toBeGreaterThan(2);
    expect(batches.flatMap(b=>b.review_ids)).toEqual(rows.map(r=>r.review_id));
    expect(batches.every(b=>b.preflight.passed&&b.preflight.truncated_reviews===0)).toBe(true);
    expect(batches.flatMap(b=>Object.values(b.payload.state.avis))).toEqual(rows.map(r=>r.text));
    expect(batches.some(b=>b.local_size_reductions.length>0)).toBe(true);
  });
  it('reports an unfit single review as a local estimate and never truncates',()=>{
    expect(()=>planInitialBatches(corpus(1,'x'.repeat(10000)),proxy,{context:{...INITIAL_BATCH_CONTEXT,body_bytes:1000}}))
      .toThrow('BATCH_SINGLE_REVIEW_LOCAL_GUARD');
    const p=initialBatchContext(initialBatchPayload(corpus(1)).payload,proxy,{...INITIAL_BATCH_CONTEXT,total_tokens:1});
    expect(p).toMatchObject({passed:false,exact_tokenizer:false,truncated_reviews:0});
    expect(p.reasons).toContain('LOCAL_TOTAL_ESTIMATE');
    expect(()=>initialBatchContext(initialBatchPayload(corpus(1)).payload,()=>NaN)).toThrow('BATCH_INVALID_TOKEN_COUNT');
  });
  it('rejects duplicate identifiers and empty texts',()=>{
    expect(()=>initialBatchPayload([...corpus(1),...corpus(1)])).toThrow('BATCH_DUPLICATE_REVIEW');
    expect(()=>initialBatchPayload(corpus(1,'  '))).toThrow('BATCH_EMPTY_TEXT');
  });
  it('rejects duplicate JSON keys including escaped aliases before parsing',()=>{
    expect(()=>parseBatchJson('{"answers":{"x":1,"\\u0078":2}}')).toThrow('BATCH_DUPLICATE_JSON_KEY');
    expect(()=>parseBatchJson('{"a":1} trailing')).toThrow('BATCH_INVALID_JSON_TRAILING_DATA');
    expect(parseBatchJson('{"a":"quote \\" and slash \\\\"}')).toEqual({a:'quote " and slash \\'});
  });
  it('maps all native choices unchanged, with usage counted once on the batch',()=>{
    const b=initialBatchPayload(corpus(2)),native=response(b),parsed=parseInitialBatchResponse(JSON.stringify(native),b);
    expect(parsed.received_classifications).toBe(8);expect(parsed.usage).toEqual(native.usage);
    expect(parsed.rows.every(r=>r.result.usage===null)).toBe(true);
    for(const row of parsed.rows)for(const k of DIRECT_CATEGORY_KEYS){
      const key=row.question_keys.find(q=>b.mapping[q].category===k)!;
      expect(row.result.categories[k].raw_answer).toEqual(native.answers[key]);
      expect(row.result.categories[k].native_confidence).toBe(0.1);
    }
    expect(parsed.rows[1].result.categories.price).toMatchObject({native_choice:'uncertain',classification:null,status:'uncertain'});
    expect(parsed.rows[1].result.categories.service).toMatchObject({native_choice:'not_mentioned',classification:'not_mentioned',status:'classified'});
    const counts=directCategoryCounts(corpus(2).map(r=>r.review_id),parsed.rows);
    expect(counts.received_results).toBe(2);
    expect(counts.categories.quality.positive_including_mixed).toBe(2);
    expect(counts.categories.quality.negative_including_mixed).toBe(1);
  });
  it('rejects incomplete, foreign or invalid responses without guessing a mapping',()=>{
    const b=initialBatchPayload(corpus(2));let r:any=response(b);
    delete r.answers.r001_service;expect(()=>parseInitialBatchResponse(JSON.stringify(r),b)).toThrow('BATCH_ANSWER_KEYS_MISMATCH');
    r=response(b);r.answers.foreign=r.answers.r001_service;expect(()=>parseInitialBatchResponse(JSON.stringify(r),b)).toThrow('BATCH_ANSWER_KEYS_MISMATCH');
    r=response(b);r.model='jev-latest';expect(()=>parseInitialBatchResponse(JSON.stringify(r),b)).toThrow('BATCH_SERVED_MODEL_CHANGED');
    r=response(b);r.answers.r001_service.choice='other';expect(()=>parseInitialBatchResponse(JSON.stringify(r),b)).toThrow('JEV_DIRECT_INVALID_CHOICE');
    r=response(b);r.answers.r001_service.type='refusal';expect(()=>parseInitialBatchResponse(JSON.stringify(r),b)).toThrow('BATCH_INVALID_ANSWER_TYPE');
    r=response(b);r.answers.r001_service.probabilities.positive=0.9;expect(()=>parseInitialBatchResponse(JSON.stringify(r),b)).toThrow('JEV_DIRECT_DISTRIBUTION_OUTSIDE_TOLERANCE');
    const tampered=structuredClone(b);tampered.mapping.r001_service.review_id=corpus(2)[1].review_id;
    expect(()=>parseInitialBatchResponse(JSON.stringify(response(b)),tampered)).toThrow('BATCH_REQUEST_OR_MAPPING_CHANGED');
  });
  it('binds cache identity to the order and every text in the batch',async()=>{
    const rows=corpus(2),b=initialBatchPayload(rows),identity=await initialBatchIdentity(b);
    expect(identity.common_sha256).toBe('3a82a9c032217a0d10ba8a9ceccdafb71bc702366145d5837a324af580c20d22');
    expect(await initialBatchIdentity(initialBatchPayload(rows))).toEqual(identity);
    const changed=structuredClone(rows);changed[1].text+='!';
    expect((await initialBatchIdentity(initialBatchPayload(changed))).request_sha256).not.toBe(identity.request_sha256);
    expect((await initialBatchIdentity(initialBatchPayload([...rows].reverse()))).mapping_sha256).not.toBe(identity.mapping_sha256);
    const changedPrompt=structuredClone(b);changedPrompt.payload.state.consignes_communes.regles_metier='autres consignes';
    await expect(initialBatchIdentity(changedPrompt)).rejects.toThrow('BATCH_INITIAL_PROMPT_CHANGED');
  });
});

