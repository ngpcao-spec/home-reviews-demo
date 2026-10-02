import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HistoricalGeneration, type GenerationReply, type HistoricalRun } from './historical-generation'

const running = (patch: Partial<HistoricalRun> = {}): HistoricalRun => ({
  establishment_id: 'khouse', preferred_language: 'vi', generation_id: 'existing-generation', status: 'running',
  progress: 3, total_steps: 6, resumable: true, error_code: null, ...patch,
})
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function setup(saved?: HistoricalRun) {
  const deps = { establishmentId: 'khouse', language: 'vi', visible: vi.fn(() => true),
    readStatus: vi.fn<() => Promise<HistoricalRun | null>>().mockResolvedValue(null),
    step: vi.fn<() => Promise<GenerationReply<string>>>().mockResolvedValue({ pending: true, generation_id: 'existing-generation', progress: 4, total_steps: 6 }),
    readReport: vi.fn().mockResolvedValue(undefined), saveReport: vi.fn(), persist: vi.fn(),
  }
  return { deps, controller: new HistoricalGeneration(deps, saved) }
}

describe('historical report lifecycle (no autonomous worker)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('only reads on ordinary entry with no run; explicit generation alone uses force', async () => {
    const { deps, controller } = setup()
    controller.attach(); await flush()
    expect(deps.step).not.toHaveBeenCalled()
    await controller.start()
    expect(deps.step).toHaveBeenCalledWith({ establishment_id: 'khouse', preferred_language: 'vi', force: true })
    controller.dispose()
  })
  it('restores cursor 3 with its existing ID and resumes without force', async () => {
    const { deps, controller } = setup(running())
    deps.readStatus.mockResolvedValue(running())
    controller.attach(); await flush()
    expect(deps.step).toHaveBeenCalledExactlyOnceWith({ establishment_id: 'khouse', preferred_language: 'vi', generation_id: 'existing-generation' })
    expect(controller.getSnapshot().run?.progress).toBe(4)
    expect(deps.persist).toHaveBeenCalledWith(expect.objectContaining({ generation_id: 'existing-generation', progress: 4 }))
    controller.dispose()
  })
  it('stops after the already-started response on unmount, resumes after remount', async () => {
    const { deps, controller } = setup()
    deps.readStatus.mockResolvedValue(running())
    let resolve!: (value: GenerationReply<string>) => void
    deps.step.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const detach = controller.attach(); await flush(); detach()
    resolve({ pending: true, generation_id: 'existing-generation', progress: 4 })
    await flush(); await vi.advanceTimersByTimeAsync(60_000)
    expect(deps.step).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().phase).toBe('paused')
    deps.readStatus.mockResolvedValue(running({ progress: 4 }))
    controller.attach(); await flush()
    expect(deps.step).toHaveBeenCalledTimes(2)
    controller.dispose()
  })
  it('backgrounding stops steps and double focus/visibility resumes only once', async () => {
    const { deps, controller } = setup()
    deps.readStatus.mockResolvedValue(running())
    controller.attach(); await flush()
    deps.visible.mockReturnValue(false); await controller.wake()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(deps.step).toHaveBeenCalledTimes(1)
    deps.visible.mockReturnValue(true)
    await Promise.all([controller.wake(), controller.wake(), controller.wake()])
    expect(deps.step).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot().phase).toBe('generating')
    controller.dispose()
  })
  it('lost HTTP response with running backend is not a failure and respects the lease', async () => {
    const { deps, controller } = setup()
    deps.readStatus.mockResolvedValueOnce(running()).mockResolvedValue(running({ resumable: false }))
    deps.step.mockRejectedValue(new Error('AbortError'))
    controller.attach(); await flush()
    expect(controller.getSnapshot().phase).toBe('generating')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(deps.step).toHaveBeenCalledTimes(1)
    controller.dispose()
  })
  it('a very quick hidden/visible transition cannot lose the scheduled continuation', async () => {
    const { deps, controller } = setup()
    deps.readStatus.mockResolvedValue(running())
    controller.attach(); await flush()
    deps.visible.mockReturnValue(false); await controller.wake()
    deps.visible.mockReturnValue(true); await controller.wake()
    expect(deps.step).toHaveBeenCalledTimes(2)
    controller.dispose()
  })
  it('only a confirmed backend failed status displays failure; no automatic retry', async () => {
    const { deps, controller } = setup()
    deps.readStatus.mockResolvedValueOnce(running()).mockResolvedValue(running({ status: 'failed', error_code: 'REPORT_FAILED' }))
    deps.step.mockRejectedValue(new Error('HTTP 500'))
    controller.attach(); await flush()
    expect(controller.getSnapshot().phase).toBe('failed')
    await vi.advanceTimersByTimeAsync(30_000)
    await controller.wake(true)
    expect(deps.step).toHaveBeenCalledTimes(1)
    controller.dispose()
  })
  it('completed while absent loads the report without another calculation', async () => {
    const { deps, controller } = setup(running())
    deps.readStatus.mockResolvedValue(running({ status: 'completed', resumable: false }))
    controller.attach(); await flush()
    expect(deps.readReport).toHaveBeenCalledTimes(1)
    expect(deps.step).not.toHaveBeenCalled()
    expect(controller.getSnapshot().phase).toBe('idle')
    controller.dispose()
  })
  it('offline/status unavailable stays neutral, never uses the cached ID as authority', async () => {
    const { deps, controller } = setup(running())
    deps.readStatus.mockRejectedValue(new Error('offline'))
    controller.attach(); await flush()
    expect(controller.getSnapshot().phase).toBe('paused')
    expect(deps.step).not.toHaveBeenCalled()
    controller.dispose()
  })
  it('logout ignores late responses and never writes another account cache', async () => {
    const { deps, controller } = setup()
    let resolve!: (value: GenerationReply<string>) => void
    deps.readStatus.mockResolvedValue(running())
    deps.step.mockReturnValue(new Promise(done => { resolve = done }))
    controller.attach(); await flush(); controller.dispose()
    deps.persist.mockClear()
    resolve({ report: 'old account report' }); await flush()
    expect(deps.saveReport).not.toHaveBeenCalled()
    expect(deps.persist).not.toHaveBeenCalled()
  })
  it('an existing active run wins even when manual start was clicked', async () => {
    const { deps, controller } = setup()
    controller.attach(); await flush()
    deps.readStatus.mockResolvedValue(running())
    await Promise.all([controller.start(), controller.start()])
    expect(deps.step).toHaveBeenCalledTimes(1)
    expect(deps.step).toHaveBeenCalledWith(expect.objectContaining({ generation_id: 'existing-generation' }))
    controller.dispose()
  })
})
