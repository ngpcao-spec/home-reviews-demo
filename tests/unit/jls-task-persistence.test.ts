import {it,expect,vi,beforeAll,afterAll} from 'vitest';
import {readFileSync} from 'node:fs';
import {processRestaurant,type RestaurantState,type RestaurantPort,type RestaurantExecutionContract} from '../../supabase/functions/_shared/jls-restaurant-worker';
import {taskReceiptWire,databasePersistenceRetry,type RestaurantOutcome} from '../../supabase/functions/_shared/jls-task-persistence';
import {hybridHash} from '../../supabase/functions/_shared/jev-hybrid-evidence';
import {negativeHash} from '../../supabase/functions/_shared/negative-validation-core';
let network:ReturnType<typeof vi.spyOn>;
beforeAll(()=>{network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('PROVIDER_NETWORK_FORBIDDEN'));});
afterAll(()=>{expect(network).not.toHaveBeenCalled();network.mockRestore();});
async function fixture(){
 const run='mock_run',org='mock_org',request={model:'jev-latest',state:{analysis_text:'EXPLICIT SYNTHETIC REVIEW'},questions:[]};
 const sha=await hybridHash(request),identity={expected_served_model:'jev-1.13.0'};
 const pending=Array.from({length:8},(_,i)=>({review_id:'review_'+i,request_sha256:sha,identity}));
 const state={protocol:{id:'mock_protocol',sha256:'mock_sha',body:{organization_id:org,pending}},run:{id:run,stage:'jev',status:'queued'},artifacts:[],
  tasks:pending.map((p,i)=>({id:'task_'+i,run_id:run,organization_id:org,phase:'jev',review_id:p.review_id,request,request_sha256:sha,identity,
   status:'pending',request_count:0,worker:'',cache_id:null}))} as unknown as RestaurantState;
 const receipts=new Map<string,RestaurantOutcome>();let lease=false,calls=0,finalizing=0,maxFinalizing=0;
 const port:RestaurantPort={load:async()=>state,cache:async()=>[],tick:async()=>{if(lease||!['queued','running'].includes(state.run.status))return false;lease=true;state.run.status='running';return true;},
  claim:async(_r,w)=>{const t=state.tasks.find(t=>t.status==='pending'&&t.request_count===0);if(!t)return null;t.status='running';t.request_count=1;t.worker=w;return structuredClone(t);},
  artifact:async()=>true,stage:async()=>true,release:async(_r,_w,error)=>{lease=false;if(error)state.run.status='blocked';},finish:async()=>{throw Error('LEGACY_FINISH_NOT_EXPECTED');},
  retainReceipt:async(_s,t,o)=>{const old=receipts.get(t.id);if(old)return old.sha256===o.sha256;receipts.set(t.id,structuredClone(o));return true;},
  finishReceipt:async id=>{finalizing++;maxFinalizing=Math.max(maxFinalizing,finalizing);await Promise.resolve();finalizing--;
   const o=receipts.get(id);if(!o)return false;const t=state.tasks.find(t=>t.id===id)!;
   const old=state.artifacts.find(a=>a.kind==='task:'+id);if(old)return old.sha256===o.sha256;
   state.artifacts.push({kind:'task:'+id,body:o.body,sha256:o.sha256});t.status=o.status;return true;}};
 const contract:RestaurantExecutionContract={verify:async()=>{},frozenAnalysisSource:true,parseJev:async()=>({categories:{service:'positive'}}),completed:async()=>{}};
 const http:typeof fetch=async()=>{calls++;await Promise.resolve();return new Response(JSON.stringify({id:'EXPLICIT_MOCK',model:'jev-1.13.0',usage:{input_tokens:10,output_tokens:1,total_tokens:11},answers:{}}));};
 return {state,port,receipts,contract,http,calls:()=>calls,maxFinalizing:()=>maxFinalizing};
}
it('keeps eight provider outcomes before draining finalization sequentially',async()=>{
 const f=await fixture(),finish=f.port.finishReceipt!;f.port.finishReceipt=async id=>{expect(f.receipts.size).toBe(8);return finish(id);};
 await processRestaurant(f.port,f.state.run.id,{jev:'mock',openai:''},f.http,f.contract);
 expect(f.calls()).toBe(8);expect(f.receipts.size).toBe(8);expect(f.state.artifacts).toHaveLength(8);expect(f.maxFinalizing()).toBe(1);
 expect(f.state.tasks.every(t=>t.request_count===1&&t.status==='completed')).toBe(true);
});
it('lost database acknowledgement retries identical retention, never provider work',async()=>{
 const f=await fixture(),retain=f.port.retainReceipt!,seen=new Set<string>();
 f.port.retainReceipt=async(s,t,o)=>{const ok=await retain(s,t,o);if(!seen.has(t.id)){seen.add(t.id);throw Error('MOCK_57014_ACK_LOST_AFTER_COMMIT');}return ok;};
 await processRestaurant(f.port,f.state.run.id,{jev:'mock',openai:''},f.http,f.contract);
 expect(f.calls()).toBe(8);expect(f.state.artifacts).toHaveLength(8);expect(f.receipts.size).toBe(8);
});
it('a finalization timeout leaves receipts resumable without another provider attempt',async()=>{
 const f=await fixture(),finish=f.port.finishReceipt!;f.port.finishReceipt=async()=>{throw Error('MOCK_57014');};
 await processRestaurant(f.port,f.state.run.id,{jev:'mock',openai:''},f.http,f.contract);
 expect(f.receipts.size).toBe(8);expect(f.state.artifacts).toHaveLength(0);expect(f.state.run.status).toBe('blocked');
 // Database-only persistence; this is not reopening a real historical run.
 for(const id of f.receipts.keys())expect(await finish(id)).toBe(true);
 for(const id of f.receipts.keys())expect(await finish(id)).toBe(true);
 await processRestaurant(f.port,f.state.run.id,{jev:'mock',openai:''},f.http,f.contract);
 expect(f.calls()).toBe(8);expect(f.state.artifacts).toHaveLength(8);
});
it('concurrent/repeated wakeups consume each attempt at most once',async()=>{
 const f=await fixture();await Promise.all(Array.from({length:8},()=>processRestaurant(f.port,f.state.run.id,{jev:'mock',openai:''},f.http,f.contract)));
 await processRestaurant(f.port,f.state.run.id,{jev:'mock',openai:''},f.http,f.contract);
 expect(f.calls()).toBe(8);expect(f.state.artifacts).toHaveLength(8);
});
it('an unknown reserved attempt with no receipt is never claimed again',async()=>{
 const f=await fixture();f.state.tasks.forEach(t=>{t.status='running';t.request_count=1;});
 await processRestaurant(f.port,f.state.run.id,{jev:'mock',openai:''},f.http,f.contract);
 expect(f.calls()).toBe(0);expect(f.receipts.size).toBe(0);expect(await f.port.finishReceipt!('task_0')).toBe(false);
});
it('a sixth reservation failure sends none of the five already reserved tasks',async()=>{
 const f=await fixture(),claim=f.port.claim;let n=0;
 f.port.claim=async(r,w)=>{if(++n===6)throw Error('JLS_DATABASE_FAILED');return claim(r,w);};
 await processRestaurant(f.port,f.state.run.id,{jev:'mock',openai:''},f.http,f.contract);
 expect(f.state.tasks.filter(t=>t.request_count===1)).toHaveLength(5);
 expect(f.calls()).toBe(0);expect(f.receipts.size).toBe(0);expect(f.state.run.status).toBe('blocked');
});
it('records a dispatch intent before transport and fails closed on a lost acknowledgement',async()=>{
 const f=await fixture(),seen=new Set<string>();
 f.port.beginProvider=async t=>{seen.add(t.id);throw Error('JLS_DISPATCH_INTENT_ACK_LOST');};
 await processRestaurant(f.port,f.state.run.id,{jev:'mock',openai:''},f.http,f.contract);
 expect(seen.size).toBe(8);expect(f.calls()).toBe(0);
 expect([...f.receipts.values()].every(o=>o.body.provider_fetch_invoked===false)).toBe(true);
 await processRestaurant(f.port,f.state.run.id,{jev:'mock',openai:''},f.http,f.contract);
 expect(f.calls()).toBe(0);
});
it('keeps reservation, transport invocation and received response distinct',async()=>{
 const f=await fixture(),intent=new Set<string>(),http=f.http;
 f.port.beginProvider=async t=>{expect(t.request_count).toBe(1);intent.add(t.id);return true;};
 f.http=async(...a)=>{expect(intent.size).toBeGreaterThan(0);return http(...a);};
 await processRestaurant(f.port,f.state.run.id,{jev:'mock',openai:''},f.http,f.contract);
 expect(f.calls()).toBe(8);expect(intent.size).toBe(8);
 expect([...f.receipts.values()].every(o=>o.body.provider_fetch_invoked===true&&o.body.provider_response_received===true)).toBe(true);
});
it('does not dispatch a technical SQL fixture through an ordinary supplier contract',async()=>{
 const f=await fixture();f.state.run.consent={consent_source:'technical_qualification_no_spending'};
 await processRestaurant(f.port,f.state.run.id,{jev:'mock',openai:''},f.http,f.contract);
 expect(f.calls()).toBe(0);
 expect([...f.receipts.values()].every(o=>o.body.error_code==='JLS_MOCK_TRANSPORT_REQUIRED')).toBe(true);
});
it('invalid provider output keeps its original raw bytes and one attempt only',async()=>{
 const f=await fixture();let calls=0;const http:typeof fetch=async()=>{calls++;return new Response('INVALID_EXPLICIT_MOCK');};
 await processRestaurant(f.port,f.state.run.id,{jev:'mock',openai:''},http,f.contract);
 expect(calls).toBe(8);expect([...f.receipts.values()].every(o=>o.body.raw_response_text==='INVALID_EXPLICIT_MOCK'&&o.status==='billing_uncertain')).toBe(true);
 expect(f.state.tasks.every(t=>t.request_count===1)).toBe(true);
});
it('receipt binds unchanged request, protocol, worker and complete native output',async()=>{
 const f=await fixture(),t=f.state.tasks[0],body={phase:'jev',request_sha256:t.request_sha256,raw_response_text:'EXPLICIT_MOCK',probabilities:[.99,.01]};
 const o={status:'completed',body,sha256:await hybridHash(body)},r=await taskReceiptWire(f.state,t,o);
 expect(await negativeHash(r.wire)).toBe(r.sha256);expect(JSON.parse(r.wire)).toMatchObject({task_id:t.id,worker:t.worker,protocol_sha256:f.state.protocol.sha256,...o});
 expect((await taskReceiptWire(f.state,t,o)).wire).toBe(r.wire);
 expect((await taskReceiptWire(f.state,t,{...o,body:{...body,probabilities:[1,0]}})).sha256).not.toBe(r.sha256);
});
it('bounded retry applies only to a database callback and stops after three failures',async()=>{
 const write=vi.fn().mockRejectedValue(Error('MOCK_DATABASE_TIMEOUT')),pause=vi.fn().mockResolvedValue(undefined);
 await expect(databasePersistenceRetry(write,pause)).rejects.toThrow('MOCK_DATABASE_TIMEOUT');expect(write).toHaveBeenCalledTimes(3);expect(pause.mock.calls).toEqual([[100],[200]]);
});
it('schema keeps receipts off the hot run FK and free routes exit before provider secrets',()=>{
 const sql=readFileSync('supabase/migrations/20261020004835_jls_durable_task_receipts.sql','utf8');
 expect(sql).toContain('task_id uuid primary key references public.analysis_jls_restaurant_tasks(id)');
 expect(sql).not.toMatch(/references public.analysis_jls_restaurant_runs/);expect(sql).not.toContain('statement_timeout');
 expect(sql).toContain('for share');expect(sql).toContain('revoke all on function');expect(sql).toContain('historical_status_preserved');
 const server=readFileSync('supabase/functions/process-jls-restaurant/index.ts','utf8');
 expect(server.indexOf("mode==='restaurant_persistence_only'")).toBeLessThan(server.indexOf('Deno.env.get("OPENAI_API_KEY")'));
 const probe=readFileSync('supabase/functions/_shared/jls-task-persistence-server.ts','utf8');
 expect(probe).not.toContain('fetch(');expect(probe).not.toContain('claim_jls_restaurant_task');
});
