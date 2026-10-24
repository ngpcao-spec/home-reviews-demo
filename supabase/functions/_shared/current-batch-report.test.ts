import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {currentBatchManifest} from './current-batch-report.ts';
import {currentReportProtocol,processCurrentReportPreparation} from './current-report-v2.ts';
import {processBatchExperiment,batchJevAccounting} from './jev-batch-experiment.ts';
import {BatchMemory,syntheticCurrentBatchManifest,syntheticCurrentBatchJob,mockBatchJevResponse,mockBatchSolResponse,rehearseCurrentBatches} from './current-batch-probe.ts';
import {directHash} from './jev-direct-categories.ts';
import {experimentalNegativeReviews} from '../../../src/lib/experimental-negative-reviews.ts';
import type {ExperimentalRow} from '../../../src/lib/experimental-report-presentation.ts';
const keys={jev:'EXPLICIT_MOCK_JEV',sol:'EXPLICIT_MOCK_SOL'};
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NO_NETWORK_ALLOWED');})));
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});
async function fixture(n=51){
 const f=await syntheticCurrentBatchManifest(n),m=new BatchMemory(f.manifest);let jev=0,sol=0;
 const http=vi.fn<typeof fetch>(async(url,options)=>{
  if(String(url).includes('typesafe.ai')){jev++;return new Response(JSON.stringify(mockBatchJevResponse(JSON.parse(String(options?.body)))));}
  if(String(url).includes('openai.com')){sol++;return new Response(JSON.stringify({model:'gpt-6.1-sol',status:'completed',usage:{input_tokens:303,output_tokens:404},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(mockBatchSolResponse(m.run.envelope!))}]}]}));}
  throw Error('UNKNOWN_MOCK_ENDPOINT');
 });
 const step=()=>processBatchExperiment(m.port,m.run.id,keys,http),finish=async()=>{for(let i=0;i<30&&m.run.armed;i++)await step();};
 return {...f,m,http,step,finish,calls:()=>({jev,sol})};
}
describe('current batch transport — source and execution contract',()=>{
 it('completes a general current request through two real multi-review payloads and one simulated compact Sol response',async()=>{
  const f=await fixture();await f.finish();expect(f.calls()).toEqual({jev:2,sol:1});expect(f.m.run.status).toBe('completed');
  expect(f.m.tasks.map(t=>t.reviews)).toEqual([50,1]);expect(f.m.tasks.every(t=>t.request_count===1&&t.receipt&&t.projection)).toBe(true);
  expect(f.m.events).toEqual(['reserved:1','receipt:1','project:1','reserved:2','receipt:2','project:2']);
  expect(f.m.published).toMatchObject({state:'completed',current_source_run_id:f.job.id,controls:{batch_experiment:false,new_jev_calls:2},usage:{jev:{historical:false,new_provider_attempts:2,new_usage:{input_tokens:202,output_tokens:404,usage_complete:true}},sol:{usage:{input_tokens:303,output_tokens:404}}}});
  const row=f.m.published as unknown as ExperimentalRow;
  const service=experimentalNegativeReviews(row,'service'),quality=experimentalNegativeReviews(row,'quality');
  expect(service.available).toBe(true);expect(service.reviews).toHaveLength(51);expect(service.reviews.every(r=>r.classification==='mixed')).toBe(true);
  expect(quality.reviews).toHaveLength(51);expect(quality.countMismatch).toBe(false);expect(quality.reviews.every(r=>r.classification==='negative')).toBe(true);
 });
 it('retains a saved raw response across interruption and validates it without dispatching it again',async()=>{
  const f=await fixture();await f.step();expect(f.m.tasks[0].status).toBe('received');const raw=structuredClone(f.m.tasks[0].receipt);
  await f.step();expect(f.calls().jev).toBe(1);expect(f.m.tasks[0].status).toBe('completed');expect(f.m.tasks[0].receipt).toEqual(raw);
  await f.finish();expect(f.calls()).toEqual({jev:2,sol:1});expect(f.m.run.status).toBe('completed');
 });
 it('bounds concurrent reservations and repeated completion without duplicate provider sends or publication',async()=>{
  const f=await fixture(3);await Promise.all(Array.from({length:8},f.step));await f.finish();
  const published=structuredClone(f.m.published);await Promise.all(Array.from({length:8},f.step));
  expect(f.calls()).toEqual({jev:1,sol:1});expect(f.m.published).toEqual(published);expect(f.m.run.sol_request_count).toBe(1);
 });
 it('preserves an unknown consumed attempt after a crash, continues only unstarted batches, and blocks Sol',async()=>{
  const f=await fixture();const receive=f.m.port.receive;f.m.port.receive=async()=>{throw Error('SIMULATED_STORAGE_OUTAGE');};
  await expect(f.step()).rejects.toThrow('SIMULATED_STORAGE_OUTAGE');f.m.port.receive=receive;
  expect(f.m.tasks[0]).toMatchObject({status:'reserved',request_count:1,receipt:null});f.m.expireReserved();await f.finish();
  expect(f.calls()).toEqual({jev:2,sol:0});expect(f.m.tasks.map(t=>t.status)).toEqual(['unknown','completed']);expect(f.m.run.status).toBe('blocked');
  const u=batchJevAccounting(f.m.tasks);expect(u.new_usage).toMatchObject({provider_attempts:2,unknown_usage_batches:1,usage_complete:false});
  await f.step();expect(f.calls().jev).toBe(2);
 });
 it('saves a transport timeout as unknown, never replaces it with individual requests',async()=>{
  const f=await fixture();let sent=0;const http:typeof fetch=async()=>{sent++;throw Error('SIMULATED_TIMEOUT');};
  await processBatchExperiment(f.m.port,f.m.run.id,keys,http);expect(f.m.tasks[0]).toMatchObject({status:'unknown',request_count:1});
  await f.finish();expect(sent).toBe(1);expect(f.calls()).toEqual({jev:1,sol:0});expect(f.m.run.status).toBe('blocked');
 });
 it('keeps incomplete batch receipts and their usage, counts no fabricated classifications and makes no Sol request',async()=>{
  const f=await fixture(3);const http:typeof fetch=async(_url,o)=>{
   const native=mockBatchJevResponse(JSON.parse(String(o?.body)));delete native.answers[Object.keys(native.answers)[0]];return new Response(JSON.stringify(native));
  };
  await processBatchExperiment(f.m.port,f.m.run.id,keys,http);await f.finish();
  expect(f.m.tasks[0]).toMatchObject({status:'invalid_output',request_count:1});expect(f.m.tasks[0].receipt?.raw_response_text).toBeTruthy();
  expect(f.m.tasks[0].projection).toBeUndefined();expect(f.calls().sol).toBe(0);expect(batchJevAccounting(f.m.tasks).new_usage).toMatchObject({input_tokens:101,output_tokens:202});
 });
 it('keeps an unknown Sol attempt consumed, and repeated steps make no second request',async()=>{
  const f=await fixture(3);while(f.m.run.stage!=='sol')await f.step();
  let sol=0;const http:typeof fetch=async()=>{sol++;throw Error('SIMULATED_SOL_TIMEOUT');};
  await processBatchExperiment(f.m.port,f.m.run.id,keys,http);await f.step();await f.step();
  expect(sol).toBe(1);expect(f.m.run.status).toBe('billing_uncertain');expect(f.m.run.sol_request_count).toBe(1);expect(f.m.run.armed).toBe(false);
 });
 it('makes identical receipt saves idempotent and rejects overwrite',async()=>{
  const f=await fixture(3);await f.step();const t=f.m.tasks[0];
  expect(await f.m.port.receive(t.id,'irrelevant',t.receipt,t.receipt_sha256!)).toBe(true);
  expect(await f.m.port.receive(t.id,'irrelevant',{},await directHash({}))).toBe(false);expect(t.receipt?.raw_response_text).toBeTruthy();
 });
 it('rejects duplicate accounting inputs and does not distribute batch tokens to reviews',async()=>{
  const f=await fixture(3);await f.finish();expect(()=>batchJevAccounting([f.m.tasks[0],f.m.tasks[0]])).toThrow('BATCH_ACCOUNTING_DUPLICATE_TASK');
  expect(f.m.tasks[0].projection!.rows.every(r=>r.result.usage===null)).toBe(true);
 });
 it('keeps the prompt/model/selector frozen and adapts the number of batches to a different restaurant',async()=>{
  const f=await syntheticCurrentBatchManifest(101);expect(f.manifest.body.plans.map(b=>b.reviews)).toEqual([50,50,1]);
  expect(f.manifest.body.configuration).toMatchObject({jev:{model:'jev-1.13.0',common_instructions_sha256:'3a82a9c032217a0d10ba8a9ceccdafb71bc702366145d5837a324af580c20d22'},selector:{version:'jls-direct4-negative-mixed-coverage-v1'},sol_wire:'jls-direct4-compact-sol-v1'});
  const job=syntheticCurrentBatchJob(2),p=await currentReportProtocol(job);Reflect.deleteProperty(p.body.configuration,'sol_wire_version');p.body.configuration_sha256=await directHash(p.body.configuration);
  // Re-hash does not authorize changing the frozen downstream contract.
  await expect(currentBatchManifest({body:p.body,sha256:await directHash(p.body)},s=>s.length)).rejects.toThrow();
 });
 it('uses the captured per-request transport during preparation, without reading a later global switch',async()=>{
  const job=syntheticCurrentBatchJob(3),calls:string[]=[];
  const admin={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})}),rpc:async(name:string)=>{calls.push(name);return {data:'saved',error:null};}};
  const result=await processCurrentReportPreparation(admin as never,job,'worker');expect(result).toMatchObject({phase:'current_batches_queued',provider_calls:0});
  expect(calls).toEqual(['prepare_current_v2_protocol','jev_batch_create_current']);
 });
 it('exposes an explicit fixed simulation with zero network calls',async()=>{
  expect(await rehearseCurrentBatches()).toMatchObject({explicit_technical_mock:true,provider_calls:0,new_runs:0,status:'completed',simulated_jev:2,simulated_sol:1,reviews:51,native_classifications:204});
 });
});
