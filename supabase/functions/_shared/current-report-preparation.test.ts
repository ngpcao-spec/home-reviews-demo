import {it,expect,vi,afterEach} from 'vitest';
const m=vi.hoisted(()=>({prepare:vi.fn()}));
vi.mock('./historical-report-worker.ts',()=>({prepareHistoricalSnapshot:m.prepare}));
import {processCurrentReportPreparation} from './current-report-v2.ts';
afterEach(()=>vi.clearAllMocks());
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
