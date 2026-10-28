import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { HistoricalGeneration,type GenerationReply,type HistoricalRun } from './historical-generation'
import { historicalGenerationKeys } from './historical-generation-keys'
const running=(patch:Partial<HistoricalRun>={}):HistoricalRun=>({establishment_id:'khouse',preferred_language:'vi',generation_id:'existing-generation',status:'running',progress:3,total_steps:6,resumable:false,error_code:null,...patch})
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
it('a committed reload isolates retired report intents; a cold-boot retry within the new corpus keeps its own intent',async()=>{
 const previous=historicalGenerationKeys('khouse','vi'),fresh=historicalGenerationKeys('khouse','vi','2026-10-28T12:00:00Z')
 const store=new Map<string,string|null>([[previous.storageKey+':intent','retired-request']])
 expect(fresh.reportKey).toBe(previous.reportKey);expect(fresh.controllerKey).not.toBe(previous.controllerKey)
 const f=setup();f.controller.dispose();f.deps.enqueue.mockRejectedValue(Error('lost response'))
 const intent={read:()=>store.get(fresh.storageKey+':intent')??null,write:(id:string|null)=>{store.set(fresh.storageKey+':intent',id)}}
 const first=new HistoricalGeneration({...f.deps,intent});first.attach();await flush()
 expect(f.deps.enqueue).not.toHaveBeenCalled();await first.start()
 const newId=store.get(fresh.storageKey+':intent');expect(newId).toMatch(/^[0-9a-f-]{36}$/)
 expect(newId).not.toBe('retired-request');expect(store.get(previous.storageKey+':intent')).toBe('retired-request')
 first.dispose();f.deps.enqueue.mockClear()
 const next=new HistoricalGeneration({...f.deps,intent});next.attach();await flush();expect(f.deps.enqueue).not.toHaveBeenCalled()
 await next.start();expect(f.deps.enqueue).toHaveBeenCalledWith(expect.objectContaining({request_id:newId}))
 next.dispose()
})
it('explicit abandonment clears the stale intent and requires another click before a fresh full generation',async()=>{
 const f=setup(),abandon=vi.fn().mockResolvedValue(undefined);let stored:string|null='old-request';
 const intent={read:()=>stored,write:(id:string|null)=>{stored=id}}
 f.controller.dispose();const c=new HistoricalGeneration({...f.deps,abandon,intent})
 const failed=running({status:'failed',request_id:'old-request',can_abandon:true,unknown_batches:1})
 f.deps.readStatus.mockResolvedValue(failed);c.attach();await flush()
 expect(await c.abandon()).toBe(true);expect(abandon).toHaveBeenCalledWith('old-request');expect(stored).toBeNull()
 expect(c.getSnapshot()).toMatchObject({phase:'idle',run:null,feedback:'abandoned'});expect(f.deps.enqueue).not.toHaveBeenCalled()
 f.deps.readStatus.mockResolvedValue({...failed,abandoned:true,can_abandon:false})
 await c.wake(true);expect(f.deps.enqueue).not.toHaveBeenCalled()
 await c.start();expect(f.deps.enqueue).toHaveBeenCalledOnce()
 expect(f.deps.enqueue).toHaveBeenCalledWith(expect.objectContaining({request_id:expect.not.stringContaining('old-request')}));c.dispose()
})
it('a lost abandonment acknowledgment is reconciled without scheduling or retrying a generation',async()=>{
 const f=setup(),abandon=vi.fn().mockRejectedValue(Error('ACK_LOST'));f.controller.dispose()
 const c=new HistoricalGeneration({...f.deps,abandon}),failed=running({status:'failed',request_id:'old',can_abandon:true})
 f.deps.readStatus.mockResolvedValue(failed);c.attach();await flush()
 f.deps.readStatus.mockResolvedValue({...failed,abandoned:true})
 expect(await c.abandon()).toBe(true);expect(abandon).toHaveBeenCalledOnce();expect(f.deps.enqueue).not.toHaveBeenCalled()
 expect(c.getSnapshot().phase).toBe('idle');c.dispose()
})
function setup(saved?:HistoricalRun){
  const deps={establishmentId:'khouse',language:'vi',visible:vi.fn(()=>true),
    readStatus:vi.fn<()=>Promise<HistoricalRun|null>>().mockResolvedValue(null),
    enqueue:vi.fn<()=>Promise<GenerationReply<string>>>().mockResolvedValue({run:running({status:'queued'})}),
    readReport:vi.fn().mockResolvedValue(undefined),saveReport:vi.fn(),persist:vi.fn()}
  return {deps,controller:new HistoricalGeneration(deps,saved)}
}
describe('server-owned historical generation observer',()=>{
  beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers())
  it('a saved 0/24 spinner stops when the same native batch request is completed, even if the legacy report refresh fails',async()=>{
    const {deps,controller}=setup(running({progress:0,total_steps:24,request_id:'request'}));
    deps.readStatus.mockResolvedValue(running({status:'completed',progress:9,total_steps:9,request_id:'request',progress_unit:'jev_batches'}));
    deps.readReport.mockRejectedValue(Error('LEGACY_REPORT_READ_UNAVAILABLE'));
    controller.attach();await flush();
    expect(controller.getSnapshot()).toMatchObject({phase:'idle',run:{status:'completed',progress:9,total_steps:9}});
    await vi.advanceTimersByTimeAsync(30000);expect(deps.enqueue).not.toHaveBeenCalled();expect(deps.readStatus).toHaveBeenCalledTimes(1);controller.dispose();
  })
  it('only enqueues on explicit click, once, never sends a generation step',async()=>{
    const {deps,controller}=setup();controller.attach();await flush()
    expect(deps.enqueue).not.toHaveBeenCalled()
    await Promise.all([controller.start(),controller.start()])
    expect(deps.enqueue).toHaveBeenCalledExactlyOnceWith({establishment_id:'khouse',preferred_language:'vi',force:true})
    deps.readStatus.mockResolvedValue(running({progress:4}))
    await vi.advanceTimersByTimeAsync(5000)
    expect(controller.getSnapshot().run?.progress).toBe(4)
    expect(deps.enqueue).toHaveBeenCalledTimes(1);controller.dispose()
  })
  it.each(['queued','running','retry'] as const)('observes existing %s run even on manual click',async(status)=>{
    const {deps,controller}=setup(running());deps.readStatus.mockResolvedValue(running({status}))
    controller.attach();await flush();await controller.start()
    expect(deps.enqueue).not.toHaveBeenCalled()
    expect(controller.getSnapshot().phase).toBe('generating');controller.dispose()
  })
  it('unmount stops polling; server can complete while no client exists',async()=>{
    const {deps,controller}=setup();deps.readStatus.mockResolvedValue(running())
    const detach=controller.attach();await flush();detach()
    const reads=deps.readStatus.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(deps.readStatus).toHaveBeenCalledTimes(reads)
    deps.readStatus.mockResolvedValue(running({status:'completed',progress:6}))
    controller.attach();await flush()
    expect(deps.readReport).toHaveBeenCalledTimes(1)
    expect(deps.enqueue).not.toHaveBeenCalled();controller.dispose()
  })
  it('hidden suspends polling; duplicate foreground events read once and never start AI',async()=>{
    const {deps,controller}=setup();deps.readStatus.mockResolvedValue(running())
    controller.attach();await flush()
    deps.visible.mockReturnValue(false);await controller.wake()
    const reads=deps.readStatus.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(deps.readStatus).toHaveBeenCalledTimes(reads)
    deps.visible.mockReturnValue(true)
    await Promise.all([controller.wake(),controller.wake(),controller.wake()])
    expect(deps.readStatus).toHaveBeenCalledTimes(reads+1)
    expect(deps.enqueue).not.toHaveBeenCalled();controller.dispose()
  })
  it('lost enqueue response reconciles running server state without red error',async()=>{
    const {deps,controller}=setup();controller.attach();await flush()
    deps.readStatus.mockResolvedValueOnce(null).mockResolvedValue(running())
    deps.enqueue.mockRejectedValue(new Error('AbortError'))
    await controller.start()
    expect(controller.getSnapshot().phase).toBe('generating')
    expect(deps.enqueue).toHaveBeenCalledTimes(1);controller.dispose()
  })
  it('only confirmed failed status displays failure; no automatic retry',async()=>{
    const {deps,controller}=setup();deps.readStatus.mockResolvedValue(running({status:'failed',error_code:'REPORT_FAILED'}))
    controller.attach();await flush();await vi.advanceTimersByTimeAsync(30_000)
    expect(controller.getSnapshot().phase).toBe('failed')
    expect(deps.enqueue).not.toHaveBeenCalled();controller.dispose()
  })
  it('offline remains neutral and retains progress',async()=>{
    const {deps,controller}=setup(running());deps.readStatus.mockRejectedValue(new Error('offline'))
    controller.attach();await flush()
    expect(controller.getSnapshot().phase).toBe('paused')
    expect(controller.getSnapshot().run?.progress).toBe(3)
    expect(deps.enqueue).not.toHaveBeenCalled();controller.dispose()
  })
  it('logout ignores late enqueue responses',async()=>{
    const {deps,controller}=setup();controller.attach();await flush()
    let resolve!:(reply:GenerationReply<string>)=>void
    deps.enqueue.mockReturnValue(new Promise(done=>{resolve=done}))
    const pending=controller.start();await flush();controller.dispose();deps.persist.mockClear()
    resolve({report:'old account report'});await pending
    expect(deps.saveReport).not.toHaveBeenCalled();expect(deps.persist).not.toHaveBeenCalled()
  })
  it('regeneration preserves existing report until server completion',async()=>{
    const {deps,controller}=setup();deps.readStatus.mockResolvedValue(running({status:'completed'}))
    controller.attach();await flush();await controller.start()
    expect(deps.enqueue).toHaveBeenCalledTimes(1)
    expect(deps.saveReport).not.toHaveBeenCalled()
    expect(controller.getSnapshot().run?.status).toBe('queued');controller.dispose()
  })
  it('persists a lost-response intent across cold boot, never resends on wake, and reuses it only on a new click',async()=>{
    let stored:string|null=null
    const first=setup();const intent={read:()=>stored,write:(id:string|null)=>{stored=id}}
    first.controller.dispose();const a=new HistoricalGeneration({...first.deps,intent});first.deps.enqueue.mockRejectedValue(Error('lost response'))
    a.attach();await flush();await a.start();const original=stored
    expect(original).toMatch(/^[a-f0-9-]{36}$/);a.dispose()
    const next=setup();next.controller.dispose();const b=new HistoricalGeneration({...next.deps,intent})
    b.attach();await flush();await vi.advanceTimersByTimeAsync(15_000)
    expect(next.deps.enqueue).not.toHaveBeenCalled()
    next.deps.enqueue.mockResolvedValue({run:running({request_id:original!,status:'completed'})})
    await b.start();expect(next.deps.enqueue).toHaveBeenCalledWith(expect.objectContaining({request_id:original}));expect(stored).toBeNull();b.dispose()
  })
})
