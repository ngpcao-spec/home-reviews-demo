import {it,expect,vi,beforeAll,afterAll} from 'vitest';
import {syntheticChill80,syntheticJev} from '../fixtures/chill80-synthetic';
import {prepareChill80,verifyChill80,parseChill80,aggregateChill80,chill80Counts,Chill80CompatibilityError,type Chill80Analysis} from '../../supabase/functions/_shared/jev-chill-reanalysis80';
import {hybridHash} from '../../supabase/functions/_shared/jev-hybrid-evidence';
import {economicThemeResults} from '../../supabase/functions/_shared/jev-economy-cache';
import {processChill80,type Chill80Port} from '../../supabase/functions/_shared/jev-chill80-worker';
import type {Target9Record} from '../../supabase/functions/_shared/jev-targeted9-worker';
import {negativeHash} from '../../supabase/functions/_shared/negative-validation-core';
let blocked:ReturnType<typeof vi.spyOn>;beforeAll(()=>{blocked=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('PROVIDER_FORBIDDEN'));});
afterAll(()=>{expect(blocked).not.toHaveBeenCalled();blocked.mockRestore();});
it('freezes 100 sources, 9 strictly compatible reuses, 71 requests and no consent or run',async()=>{
 const i=await syntheticChill80(),p=await prepareChill80(i);expect(await verifyChill80(p)).toBe(true);
 expect(p.body.reused).toHaveLength(9);expect(p.body.pending).toHaveLength(71);expect(p.body.reviews).toHaveLength(100);
 expect(p.body.baseline.every(b=>b.purpose==='comparison_only_never_reused')).toBe(true);
 expect(p.body.policy).toMatchObject({max_jev_calls:71,client_max_attempts:1,no_model_probe_call:true,max_luna_calls:0,max_sol_calls:0,max_apify_calls:0});
 expect(p.body.spending_authorization).toBeNull();expect(p.body.run_id).toBeNull();expect(p.body.supplier_calls).toBe(0);
 expect(new Set(p.body.pending.map(r=>r.request_state.review_alias)).size).toBe(71);
 expect(p.body.pending.every(r=>!p.body.reused.some(x=>x.review_id===r.review_id))).toBe(true);
});
it.each(['model','threshold','configuration','text','receipt','probabilities'])('blocks incompatible %s without expanding the 71-call scope',async kind=>{
 const i=await syntheticChill80();
 if(kind==='threshold')i.benchmark_protocol.body.threshold_sha256='0'.repeat(64);
 if(kind==='configuration')i.benchmark_protocol.body.configuration_id='v12_economy_1pass_v1';
 if(kind==='text')i.source.body.snapshot.source.reviews[0].analysis_text+='changed';
 if(kind==='receipt')i.benchmark_records=i.benchmark_records.filter(r=>r.kind!=='jev_targeted9_receipt_01');
 if(kind==='model'||kind==='probabilities'){
  const r=i.benchmark_records.find(r=>r.kind==='jev_targeted9_result_01')!;
  const x=r.body.result as {served_model:string;native:{themes:{cooking:{probabilities:{negative:number}}}}};
  if(kind==='model')x.served_model='different';else x.native.themes.cooking.probabilities.negative=.8;r.sha256=await hybridHash(r.body);
 }
 try{await prepareChill80(i);throw Error('UNEXPECTED_ACCEPT');}catch(e){expect(String(e)).not.toContain('UNEXPECTED_ACCEPT');
  if(kind==='receipt'||kind==='model'||kind==='probabilities'){expect(e).toBeInstanceOf(Chill80CompatibilityError);expect((e as Chill80CompatibilityError).compatible_reviews).toBe(8);expect(String(e)).toContain('NEEDED_72');}}
});
it('keeps native choices and thresholded decisions separate, and rejects served-model drift',async()=>{
 const p=await prepareChill80(await syntheticChill80()),raw=syntheticJev();
 raw.answers.portions={type:'choice',choice:'negative',probabilities:{absent:.1,positive:.2,negative:.4,both:.3}};
 const a=await parseChill80(p,p.body.pending[0].review_id,raw);expect(Object.keys(a.native.themes)).toHaveLength(25);expect(Object.keys(a.theme_results)).toHaveLength(25);
 expect(a.native.themes.portions.choice).toBe('negative');expect(a.theme_results.portions).not.toHaveProperty('probabilities');
 raw.model='jev-new';await expect(parseChill80(p,p.body.pending[0].review_id,raw)).rejects.toThrow('CHILL80_MODEL_DRIFT');
 await expect(parseChill80(p,p.body.reviews.find(r=>!r.analysis_text)!.id,raw)).rejects.toThrow('OUT_OF_SCOPE');
});
it('counts both polarities by distinct review, without assigning any theme to the 20 textless reviews',async()=>{
 const i=await syntheticChill80(),p=await prepareChill80(i),fresh:Chill80Analysis[]=[];
 for(const r of p.body.pending){const parsed=await parseChill80(p,r.review_id,syntheticJev());fresh.push({...parsed,duration_ms:1,provenance:{kind:'new_execution',result_id:r.review_id,receipt_id:'receipt',result_sha256:'mock',receipt_sha256:'mock'}});}
 fresh[0].native.themes.portions={choice:'both',probabilities:{absent:0,positive:0,negative:0,both:1}};fresh[0].theme_results=economicThemeResults(fresh[0].native);
 const a=await aggregateChill80(p,[...p.body.reused,...fresh],i.baseline);
 expect(a.denominators).toEqual({all_reviews:100,with_text:80,analysed:80,without_text:20});expect(a.differences).toHaveLength(2000);
 expect(a.analyses).toHaveLength(80);expect(a.textless_review_ids).toHaveLength(20);
 expect(a.counts.thresholded.portions).toMatchObject({positive_review_count:1,negative_review_count:1,polarity_mentions:2,distinct_mentioned_review_count:1});
 expect(a.usage.new_calls.reviews).toBe(71);expect(a.usage.reused_historical.reviews).toBe(9);
 await expect(aggregateChill80(p,p.body.reused,i.baseline)).rejects.toThrow('COMPLETE_80');
 expect(()=>chill80Counts([fresh[0],fresh[0]],'native')).toThrow('DUPLICATE_RESULT');
});
async function workerFixture(){
 const input=await syntheticChill80(),protocol=await prepareChill80(input),id='synthetic-execution',pid='synthetic-protocol',directive='SYNTHETIC GO NOT PERSISTED';
 const body={full_protocol_id:pid,protocol_sha256:protocol.sha256,pending_sha256:protocol.body.pending_sha256,reuses_sha256:protocol.body.reuses_sha256,
  configuration_sha256:protocol.body.configuration_sha256,consent_source:'user_directive_codex_delegation',scope:protocol.body.policy,
  directive,directive_sha256:await negativeHash(directive),expires_at:new Date(Date.now()+60000).toISOString()};
 const execution={id,kind:'jev_chill80_execution_v1',body,sha256:await hybridHash(body)},records:Target9Record[]=[];let calls=0;
 const port:Chill80Port={load:async()=>({protocol,protocol_id:pid,execution,records:structuredClone(records)}),baseline:async()=>input.baseline,
  reserve:async(_id,review)=>{const pos=protocol.body.pending.find(r=>r.review_id===review)!.position,kind='jev_chill80_attempt_'+String(pos).padStart(2,'0');
   if(records.some(r=>r.kind===kind))return null;const r={id:crypto.randomUUID(),kind,body:{review_id:review},sha256:await hybridHash({review_id:review})};
   if(records.some(r=>r.kind===kind))return null;records.push(r);return r.id;},
  save:async(kind,body)=>{const r={id:crypto.randomUUID(),kind,body,sha256:await hybridHash(body)};records.push(r);return r.id;},wake:async()=>{}};
 const fetcher:typeof fetch=async()=>{calls++;return new Response(JSON.stringify(syntheticJev()));};
 return {id,port,records,execution,protocol,fetcher,calls:()=>calls};
}
it.each(['missing_go','expired','changed_scope'])('never reserves or dispatches after %s',async kind=>{
 const f=await workerFixture();if(kind==='missing_go')f.execution.body.directive='';if(kind==='expired')f.execution.body.expires_at='2000-01-01';
 if(kind==='changed_scope')f.execution.body.scope={...f.protocol.body.policy,max_jev_calls:80};f.execution.sha256=await hybridHash(f.execution.body);
 await expect(processChill80(f.port,f.id,'MOCK',f.fetcher)).rejects.toThrow();expect(f.calls()).toBe(0);expect(f.records).toHaveLength(0);
});
it('concurrent wakes dispatch a single attempt and preserve an interruption as consumed',async()=>{
 const f=await workerFixture();await Promise.all([processChill80(f.port,f.id,'MOCK',f.fetcher),processChill80(f.port,f.id,'MOCK',f.fetcher)]);expect(f.calls()).toBe(1);
 const result=f.records.find(r=>r.kind==='jev_chill80_result_01')!;f.records.splice(f.records.indexOf(result),1);
 expect(await processChill80(f.port,f.id,'MOCK',f.fetcher)).toBe('consumed_no_retry');expect(f.calls()).toBe(1);
});
it.each(['network','http_429','invalid','model'])('saves %s and stops without retry or fallback',async kind=>{
 const f=await workerFixture();let calls=0;const fetcher:typeof fetch=async()=>{calls++;if(kind==='network')throw TypeError('lost');
  if(kind==='http_429')return new Response('error',{status:429});if(kind==='invalid')return new Response('bad json');
  return new Response(JSON.stringify({...syntheticJev(),model:'different'}));};
 expect(await processChill80(f.port,f.id,'MOCK',fetcher)).toBe('stopped_no_retry');expect(calls).toBe(1);
 expect(await processChill80(f.port,f.id,'MOCK',fetcher)).toBe('stopped_no_retry');expect(calls).toBe(1);
 expect(f.records.some(r=>r.kind==='jev_chill80_receipt_01')).toBe(true);
});
