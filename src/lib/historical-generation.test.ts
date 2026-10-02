import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { HistoricalGeneration,type GenerationReply,type HistoricalRun } from './historical-generation'
const running=(patch:Partial<HistoricalRun>={}):HistoricalRun=>({establishment_id:'khouse',preferred_language:'vi',generation_id:'existing-generation',status:'running',progress:3,total_steps:6,resumable:false,error_code:null,...patch})
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
function setup(saved?:HistoricalRun){
  const deps={establishmentId:'khouse',language:'vi',visible:vi.fn(()=>true),
    readStatus:vi.fn<()=>Promise<HistoricalRun|null>>().mockResolvedValue(null),
    enqueue:vi.fn<()=>Promise<GenerationReply<string>>>().mockResolvedValue({run:running({status:'queued'})}),
    readReport:vi.fn().mockResolvedValue(undefined),saveReport:vi.fn(),persist:vi.fn()}
  return {deps,controller:new HistoricalGeneration(deps,saved)}
}
describe('server-owned historical generation observer',()=>{
  beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers())
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
})
