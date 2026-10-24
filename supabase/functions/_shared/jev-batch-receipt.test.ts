import {it,expect,vi} from 'vitest';
import {saveBatchReceipt} from './jev-batch-receipt.ts';
it('acknowledges the saved receipt even when the separate continuation transaction times out',async()=>{
 const rpc=vi.fn(async name=>{if(name==='jev_batch_continue_received')throw Error('SIMULATED_STATEMENT_TIMEOUT');return true;});
 const warn=vi.fn();expect(await saveBatchReceipt(rpc,'task','worker',{raw_response_text:'saved'},'sha',warn)).toBe(true);
 expect(rpc.mock.calls.map(c=>c[0])).toEqual(['jev_batch_receive','jev_batch_continue_received']);
 expect(warn).toHaveBeenCalledWith('BATCH_RECEIPT_SAVED_CONTINUATION_FAILED_CRON_RECOVERY');
});
it('does not retry an unknown receipt transaction or schedule its continuation',async()=>{
 const rpc=vi.fn().mockRejectedValue(Error('SIMULATED_RECEIPT_ACK_LOST'));
 await expect(saveBatchReceipt(rpc,'task','worker',{},'sha')).rejects.toThrow('SIMULATED_RECEIPT_ACK_LOST');
 expect(rpc).toHaveBeenCalledOnce();expect(rpc.mock.calls[0][0]).toBe('jev_batch_receive');
});
it('does not continue a rejected receipt and retains the original worker and receipt binding',async()=>{
 const rpc=vi.fn().mockResolvedValue(false),receipt={raw_response_text:'native'};
 expect(await saveBatchReceipt(rpc,'task','worker',receipt,'sha')).toBe(false);
 expect(rpc.mock.calls).toEqual([['jev_batch_receive',{p_task:'task',p_worker:'worker',p_receipt:receipt,p_sha:'sha'}]]);
});
