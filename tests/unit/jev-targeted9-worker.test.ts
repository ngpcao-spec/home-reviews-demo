import {it,expect,vi,beforeAll,afterAll} from 'vitest';
import frozen from '../fixtures/jev-boundaries-targeted9.json';
import criteria from '../../docs/jev-boundaries-targeted9-criteria-20261018.json';
import {prepareTargetedJev,type TargetCriteria} from '../../supabase/functions/_shared/jev-boundaries-targeted-protocol';
import {processTargeted9,type Target9Port,type Target9Record} from '../../supabase/functions/_shared/jev-targeted9-worker';
import {hybridHash} from '../../supabase/functions/_shared/jev-hybrid-evidence';
import {negativeHash} from '../../supabase/functions/_shared/negative-validation-core';
import {THEME_KEYS} from '../../supabase/functions/_shared/jev-themes';
let blocked:ReturnType<typeof vi.spyOn>;
beforeAll(()=>{blocked=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('PROVIDER_FORBIDDEN'));});
afterAll(()=>{expect(blocked).not.toHaveBeenCalled();blocked.mockRestore();});
const raw=()=>({model:'jev-1.13.0',usage:{input_tokens:125,output_tokens:0},answers:Object.fromEntries(THEME_KEYS.map(k=>[k,{type:'choice',choice:'absent',probabilities:{absent:1,positive:0,negative:0,both:0}}]))});
async function fixture(){
 const p=await prepareTargetedJev(frozen.source,criteria as TargetCriteria,frozen.baseline),pid='3f6ab86c-7557-431b-9389-4fa85054a00e',id=crypto.randomUUID(),directive='Synthetic GO '+pid;
 const body={targeted_protocol_id:pid,protocol_sha256:p.sha256,request_manifest_sha256:p.body.request_manifest_sha256,
 configuration_sha256:p.body.configuration_sha256,consent_source:'user_directive_codex_delegation',scope:p.body.policy,
 directive,directive_sha256:await negativeHash(directive),expires_at:new Date(Date.now()+60000).toISOString()};
 const execution={id,kind:'jev_targeted9_execution_v1',body,sha256:await hybridHash(body)},records:Target9Record[]=[];
 const events:string[]=[];let calls=0,failReceipt=false;
 const port:Target9Port={
  load:async()=>({protocol:structuredClone(p),protocol_id:pid,execution:structuredClone(execution),records:structuredClone(records)}),
  reserve:async(_id,review,sha)=>{
   const r=p.body.reviews.find(x=>x.id===review)!;const n=String(r.position).padStart(2,'0'),kind='jev_targeted9_attempt_'+n;
   if(records.some(x=>x.kind===kind)||p.body.reviews.slice(0,r.position-1).some(x=>!records.some(y=>y.kind==='jev_targeted9_result_'+String(x.position).padStart(2,'0'))))return null;
   const b={review_id:review,request_sha256:sha},record={id:crypto.randomUUID(),kind,body:b,sha256:await hybridHash(b)};
   // Synchronous uniqueness after async hash, like INSERT ON CONFLICT after row lock.
   if(records.some(x=>x.kind===kind))return null;records.push(record);events.push('reserve');return record.id;
  },
  save:async(kind,body)=>{if(failReceipt&&kind.includes('receipt'))throw Error('SYNTHETIC_DATABASE_FAILURE');
   const sha=await hybridHash(body),existing=records.find(x=>x.kind===kind);if(existing){if(existing.sha256!==sha)throw Error('IMMUTABLE');return existing.id;}
   const r={id:crypto.randomUUID(),kind,body,sha256:sha};records.push(r);events.push(kind.includes('receipt')?'receipt':kind.includes('result')?'result':'summary');return r.id;},
  wake:async()=>{events.push('wake');}
 };
 const transport:typeof fetch=async(url,init)=>{calls++;events.push('dispatch');expect(url).toBe('https://api.typesafe.ai/v1/systemone');expect(init?.method).toBe('POST');
  const payload=JSON.parse(String(init!.body));expect(Object.keys(payload.state)).toEqual(['review_alias','analysis_text']);
  expect(Object.keys(payload.questions)).toHaveLength(25);expect(payload.model).toBe('jev-latest');return new Response(JSON.stringify(raw()));};
 return {p,id,port,execution,records,events,transport,calls:()=>calls,failReceipt:()=>{failReceipt=true;}};
}
it('executes exactly nine single-pass mocks, persists before parsing, then finishes without another call',async()=>{
 const f=await fixture();for(let i=0;i<9;i++)expect(await processTargeted9(f.port,f.id,'MOCK',f.transport)).toBe('completed_one');
 expect(f.calls()).toBe(9);expect(f.events.slice(0,5)).toEqual(['reserve','dispatch','receipt','result','wake']);
 expect(await processTargeted9(f.port,f.id,'MOCK',f.transport)).toBe('finished');
 expect(await processTargeted9(f.port,f.id,'MOCK',f.transport)).toBe('finished');expect(f.calls()).toBe(9);
 const result=f.records.filter(x=>x.kind.includes('_result_'));expect(result).toHaveLength(9);
 for(const r of result){const parsed=r.body.result as {native:{themes:object};theme_results:object};expect(Object.keys(parsed.native.themes)).toHaveLength(25);expect(Object.keys(parsed.theme_results)).toHaveLength(25);}
});
it('concurrent and repeated wakes never dispatch a second attempt for one review',async()=>{
 const f=await fixture();await Promise.all([processTargeted9(f.port,f.id,'MOCK',f.transport),processTargeted9(f.port,f.id,'MOCK',f.transport)]);
 expect(f.calls()).toBe(1);expect(f.records.filter(x=>x.kind.includes('_attempt_'))).toHaveLength(1);
});
it.each(['scope','expiry','hash','directive','protocol'])('rejects invalid %s before reservation',async kind=>{
 const f=await fixture();if(kind==='scope')f.execution.body.scope={...f.p.body.policy,max_jev_calls:10};
 if(kind==='expiry')f.execution.body.expires_at='2000-01-01';if(kind==='directive')f.execution.body.directive='changed';
 if(kind==='protocol')f.execution.body.protocol_sha256='0'.repeat(64);
 if(kind!=='hash')f.execution.sha256=await hybridHash(f.execution.body);else f.execution.sha256='0'.repeat(64);
 await expect(processTargeted9(f.port,f.id,'MOCK',f.transport)).rejects.toThrow();expect(f.calls()).toBe(0);expect(f.records).toHaveLength(0);
});
it.each(['429','500','network','invalid_json','missing_theme','missing_usage'])('preserves %s and does not repeat the consumed request',async kind=>{
 const f=await fixture();let calls=0;const mock:typeof fetch=async()=>{calls++;if(kind==='network')throw TypeError('lost');
 if(kind==='429'||kind==='500')return new Response('Synthetic vendor error',{status:Number(kind)});
 if(kind==='invalid_json')return new Response('bad json');const r=raw();if(kind==='missing_theme')delete (r.answers as Partial<typeof r.answers>).noise;
 if(kind==='missing_usage')delete (r as Partial<typeof r>).usage;return new Response(JSON.stringify(r));};
 expect(await processTargeted9(f.port,f.id,'MOCK',mock)).toBe('failed_one');expect(calls).toBe(1);
 const receipt=f.records.find(x=>x.kind.includes('_receipt_'))!,result=f.records.find(x=>x.kind.includes('_result_'))!;
 expect(result.body.status).toBe('failed_or_uncertain');if(kind!=='network')expect(receipt.body.raw_response_text).not.toBeNull();
 // Simulate interruption before result persistence: this attempt remains consumed.
 f.records.splice(f.records.indexOf(result),1);expect(await processTargeted9(f.port,f.id,'MOCK',mock)).toBe('consumed_no_retry');expect(calls).toBe(1);
});
it('receipt persistence failure leaves consumed reservation, never another supplier call',async()=>{
 const f=await fixture();f.failReceipt();await expect(processTargeted9(f.port,f.id,'MOCK',f.transport)).rejects.toThrow('TARGETED_RECEIPT_NOT_CONFIRMED');
 expect(await processTargeted9(f.port,f.id,'MOCK',f.transport)).toBe('consumed_no_retry');expect(f.calls()).toBe(1);
});
it('does not consume an attempt without a configured server key',async()=>{
 const f=await fixture();await expect(processTargeted9(f.port,f.id,'',f.transport)).rejects.toThrow('JEV_NOT_CONFIGURED');expect(f.records).toHaveLength(0);
});
