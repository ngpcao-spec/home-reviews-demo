import {it,expect,vi,afterEach,beforeEach} from 'vitest';
const m=vi.hoisted(()=>({prepare:vi.fn(),manifest:vi.fn()}));
vi.mock('./historical-report-worker.ts',()=>({prepareHistoricalSnapshot:m.prepare}));
vi.mock('./current-batch-report.ts',async original=>({...await original<typeof import('./current-batch-report.ts')>(),currentBatchManifest:m.manifest}));
import {processCurrentReportPreparation,currentReportProtocol} from './current-report-v2.ts';
import {syntheticCurrentBatchJob} from './current-batch-probe.ts';
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NO_NETWORK_ALLOWED');})));
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();vi.restoreAllMocks();vi.clearAllMocks();});
it('durably freezes the existing source then immediately wakes batch preparation without a provider or a minute timer',async()=>{
 m.prepare.mockResolvedValue({snapshot:{base:{},reviews:[]}});const rpc=vi.fn().mockResolvedValue({data:true,error:null});
 const run={id:'source',generation_id:'generation',engine:'jev_sol_v2',jev_transport:'batch_initial_v1',snapshot:{},cursor:0};
 expect(await processCurrentReportPreparation({rpc} as never,run as never,'worker')).toEqual({phase:'source_frozen',provider_calls:0});
 expect(rpc.mock.calls.map(c=>c[0])).toEqual(['checkpoint_historical_report_run','wake_current_jev_preparation']);
 expect(rpc.mock.calls[0][1].p_values).toMatchObject({locked_by:null,lease_until:null});expect(rpc.mock.calls[1][1]).toEqual({p_source:'source'});
});
it('does not change continuation of the retained individual transport',async()=>{
 m.prepare.mockResolvedValue({snapshot:{base:{},reviews:[]}});const rpc=vi.fn().mockResolvedValue({data:true,error:null});
 await processCurrentReportPreparation({rpc} as never,{id:'source',engine:'jev_sol_v2',jev_transport:'individual',snapshot:{}} as never,'worker');
 expect(rpc.mock.calls.map(c=>c[0])).toEqual(['checkpoint_historical_report_run']);
});
it('checkpoints the sealed certificate before any batch tokenization, releasing the fenced lease before wake',async()=>{
 const job=syntheticCurrentBatchJob(585),rpc=vi.fn(async name=>({data:name==='checkpoint_historical_report_run'?true:'sealed',error:null}));
 const admin={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})}),rpc};
 expect(await processCurrentReportPreparation(admin as never,job,'worker')).toEqual({phase:'protocol_certified',provider_calls:0});
 expect(m.manifest).not.toHaveBeenCalled();
 expect(rpc.mock.calls.map(c=>c[0])).toEqual(['prepare_current_v2_protocol','checkpoint_historical_report_run','wake_current_jev_preparation']);
 expect(rpc.mock.calls[1][1]).toMatchObject({p_run_id:job.id,p_worker_id:'worker',p_values:{attempt_count:0,locked_by:null,lease_until:null}});
});
it('resumes only the local manifest stage from the saved certificate and queues the existing batch transport once',async()=>{
 const job=syntheticCurrentBatchJob(3),protocol=await currentReportProtocol(job),manifest={body:{saved:'manifest'},sha256:'manifest-sha'};
 m.manifest.mockResolvedValue(manifest);const rpc=vi.fn().mockResolvedValue({data:'batch-run',error:null});
 const admin={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:protocol,error:null})})})}),rpc};
 expect(await processCurrentReportPreparation(admin as never,job,'worker')).toEqual({phase:'current_batches_queued',batch_run_id:'batch-run',provider_calls:0});
 expect(m.manifest).toHaveBeenCalledWith(protocol,expect.any(Function));
 expect(rpc.mock.calls).toEqual([['jev_batch_create_current',{p_source:job.id,p_manifest:manifest.body,p_sha:manifest.sha256}]]);
});
it('retains the successful certificate checkpoint for cron recovery if immediate continuation cannot be scheduled',async()=>{
 const job=syntheticCurrentBatchJob(3),warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
 const rpc=vi.fn(async name=>name==='wake_current_jev_preparation'?{data:null,error:{code:'SIMULATED_DISPATCH_FAILURE'}}:{data:name==='checkpoint_historical_report_run'?true:'sealed',error:null});
 const admin={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})}),rpc};
 expect(await processCurrentReportPreparation(admin as never,job,'worker')).toEqual({phase:'protocol_certified',provider_calls:0});
 expect(m.manifest).not.toHaveBeenCalled();expect(warning).toHaveBeenCalledWith('CURRENT_BATCH_PREPARATION_WAKE_FAILED_CRON_RECOVERY');
 expect(rpc.mock.calls.map(c=>c[0])).toEqual(['prepare_current_v2_protocol','checkpoint_historical_report_run','wake_current_jev_preparation']);
});
