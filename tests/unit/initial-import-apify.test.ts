// @vitest-environment node
import {it,expect,vi} from 'vitest'
import {advanceInitialApify,type InitialApifyPort} from '../../supabase/functions/_shared/initial-import-apify'
import {getApifyRun,startApifyRun,type ApifyRunState} from '../../supabase/functions/_shared/apify'
const running:ApifyRunState={runId:'run',datasetId:'dataset',status:'RUNNING'},done={...running,status:'SUCCEEDED',finishedAt:'2026-10-25T11:00:00Z'}
function port(){
 const p={acquire:vi.fn(async()=>true),release:vi.fn(async()=>{}),reserveStart:vi.fn(async()=>true),start:vi.fn(async(reserve:()=>Promise<void>)=>{await reserve();return running}),saveRun:vi.fn(async()=>{}),get:vi.fn(async():Promise<ApifyRunState>=>done),finished:vi.fn(async()=>{}),retrieve:vi.fn(async()=>({status:'completed'})),defer:vi.fn(async seconds=>({deferred:seconds}))} satisfies InitialApifyPort<{status:string}>
 return p
}
it('reserves before the single POST, saves identity before polling, and retrieves immediately on completion',async()=>{
 const p=port(),r=await advanceInitialApify({provider_run_id:null,provider_dataset_id:null},p)
 expect(r).toEqual({status:'completed'});expect(p.start).toHaveBeenCalledTimes(1);expect(p.reserveStart).toHaveBeenCalledTimes(1)
 expect(p.saveRun.mock.invocationCallOrder[0]).toBeLessThan(p.get.mock.invocationCallOrder[0]);expect(p.get).toHaveBeenCalledWith('run',20)
 expect(p.finished).toHaveBeenCalledWith(done);expect(p.defer).not.toHaveBeenCalled();expect(p.release).toHaveBeenCalledTimes(1)
})
it('continues a saved run without another start, even when a previous poll failed',async()=>{
 const p=port();p.get.mockRejectedValueOnce(Error('HTTP result unknown'))
 const job={provider_run_id:'run',provider_dataset_id:'dataset'}
 await expect(advanceInitialApify(job,p)).rejects.toThrow('unknown');await advanceInitialApify(job,p)
 expect(p.start).not.toHaveBeenCalled();expect(p.reserveStart).not.toHaveBeenCalled();expect(p.retrieve).toHaveBeenCalledTimes(1)
})
it('bounds waiting to two long polls then uses a short continuation, never a new run',async()=>{
 const p=port();p.get.mockResolvedValue(running)
 await expect(advanceInitialApify({provider_run_id:'run',provider_dataset_id:'dataset'},p)).resolves.toEqual({deferred:5})
 expect(p.get).toHaveBeenCalledTimes(2);expect(p.start).not.toHaveBeenCalled();expect(p.retrieve).not.toHaveBeenCalled()
})
it('does not start anything after an unknown POST, a partial identity or a lost start reservation',async()=>{
 for(const job of [{provider_run_id:null,provider_dataset_id:null,provider_start_attempted_at:'saved'},{provider_run_id:null,provider_dataset_id:'saved'}]){const p=port();await expect(advanceInitialApify(job,p)).rejects.toThrow();expect(p.start).not.toHaveBeenCalled()}
 const p=port();p.reserveStart.mockResolvedValue(false);await expect(advanceInitialApify({provider_run_id:null,provider_dataset_id:null},p)).rejects.toThrow('RESERVED');expect(p.saveRun).not.toHaveBeenCalled();expect(p.release).toHaveBeenCalledTimes(1)
})
it('stops after a received run cannot be saved, then refuses a fresh POST with the durable reservation',async()=>{
 const p=port();p.saveRun.mockRejectedValueOnce(Error('checkpoint unavailable'))
 await expect(advanceInitialApify({provider_run_id:null,provider_dataset_id:null},p)).rejects.toThrow('checkpoint unavailable')
 expect(p.start).toHaveBeenCalledTimes(1);expect(p.retrieve).not.toHaveBeenCalled()
 const next=port();await expect(advanceInitialApify({provider_run_id:null,provider_dataset_id:null,provider_start_attempted_at:'durable'},next)).rejects.toThrow('OUTCOME_UNKNOWN');expect(next.start).not.toHaveBeenCalled()
})
it('does not retrieve or silently restart a different or failed provider run',async()=>{
 for(const run of [{...done,runId:'other'},{...done,datasetId:'other'},{...done,status:'FAILED'}]){const p=port();p.get.mockResolvedValue(run);await expect(advanceInitialApify({provider_run_id:'run',provider_dataset_id:'dataset'},p)).rejects.toThrow();expect(p.retrieve).not.toHaveBeenCalled();expect(p.start).not.toHaveBeenCalled()}
})
it('does not start under provider-slot pressure and preserves a known run after persistence failure',async()=>{
 const p=port();p.acquire.mockResolvedValue(false);await advanceInitialApify({provider_run_id:null,provider_dataset_id:null},p);expect(p.defer).toHaveBeenCalledWith(5);expect(p.start).not.toHaveBeenCalled()
 const q=port();q.retrieve.mockRejectedValueOnce(Error('database interrupted'));await expect(advanceInitialApify({provider_run_id:'run',provider_dataset_id:'dataset'},q)).rejects.toThrow('interrupted');await advanceInitialApify({provider_run_id:'run',provider_dataset_id:'dataset'},q);expect(q.start).not.toHaveBeenCalled()
})
it('uses the bounded provider GET option and native timestamps with a fully mocked HTTP response',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({data:{id:'run',defaultDatasetId:'dataset',status:'SUCCEEDED',startedAt:'2026-10-25T10:00:00Z',finishedAt:'2026-10-25T10:00:11Z'}}),{status:200}))
 try{const r=await getApifyRun('synthetic-key','run',999);expect(fetch.mock.calls[0][0]).toBe('https://api.apify.com/v2/actor-runs/run?waitForFinish=20');expect(r.finishedAt).toBe('2026-10-25T10:00:11Z')}finally{fetch.mockRestore()}
})
it('never sends the POST when the durable reservation fails, after URL preparation',async()=>{
 vi.stubGlobal('Deno',{env:{get:()=>undefined}});const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN'))
 try{await expect(startApifyRun('synthetic-key',{placeUrl:'https://www.google.com/maps?cid=123',language:'vi',sort:'newest',limit:150},undefined,async()=>{throw Error('LEASE_LOST')})).rejects.toThrow('LEASE_LOST');expect(fetch).not.toHaveBeenCalled()}finally{fetch.mockRestore();vi.unstubAllGlobals()}
})
