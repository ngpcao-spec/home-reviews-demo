/** Client observer/step runner. The server owns checkpoints and terminal states. */
export interface HistoricalRun {
  establishment_id: string
  preferred_language: string
  generation_id: string
  status: 'running' | 'completed' | 'failed'
  progress: number
  total_steps: number | null
  resumable: boolean
  error_code: string | null
}
export interface GenerationReply<T> {
  report?: T; error?: string; pending?: boolean; generation_id?: string; progress?: number; total_steps?: number
}
export interface GenerationState {
  phase: 'idle' | 'generating' | 'paused' | 'failed'
  run: HistoricalRun | null
  feedback: 'success' | 'empty' | null
}
interface Dependencies<T> {
  establishmentId: string
  language: string
  readStatus: () => Promise<HistoricalRun | null>
  step: (body: { establishment_id: string; preferred_language: string; generation_id?: string; force?: true }) => Promise<GenerationReply<T>>
  readReport: () => Promise<void>
  saveReport: (report: T) => void
  persist: (run: HistoricalRun | null) => void
  visible: () => boolean
}

export class HistoricalGeneration<T> {
  private state: GenerationState
  private listeners = new Set<() => void>()
  private observers = 0
  private retired = false
  private busy = false
  private lastWake = 0
  private timer?: ReturnType<typeof setTimeout>
  constructor(private deps: Dependencies<T>, saved?: HistoricalRun) {
    const run = saved?.establishment_id === deps.establishmentId && saved.preferred_language === deps.language ? saved : null
    // Local storage is a hint, never evidence of server failure or authority to generate.
    this.state = { phase: run?.status === 'running' ? 'paused' : 'idle', run, feedback: null }
  }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit(state: GenerationState) {
    if (this.retired) return
    this.state = state
    this.deps.persist(state.run)
    this.listeners.forEach(fn => fn())
  }
  private canRun() { return !this.retired && this.observers > 0 && this.deps.visible() }
  private clearTimer() { clearTimeout(this.timer); this.timer = undefined }
  private later(delay = 5000) {
    this.clearTimer()
    if (this.canRun()) this.timer = setTimeout(() => { void this.wake(true) }, delay)
  }
  attach() {
    this.observers++
    void this.wake(true)
    return () => { this.observers--; if (!this.observers) this.pause() }
  }
  pause() {
    this.clearTimer()
    if (this.state.phase === 'generating') this.emit({ ...this.state, phase: 'paused' })
  }
  dispose() { this.pause(); this.retired = true; this.listeners.clear() }
  wake = (forceRead = false) => {
    if (!this.canRun()) { this.pause(); return Promise.resolve() }
    if (!forceRead && this.state.phase !== 'paused' && Date.now() - this.lastWake < 1000) return Promise.resolve()
    return this.execute(false)
  }
  start = () => this.execute(true)
  private async observe(run: HistoricalRun | null) {
    if (this.retired) return
    this.emit({ run, phase: run?.status === 'failed' ? 'failed' : run?.status === 'running'
      ? this.canRun() ? 'generating' : 'paused' : 'idle', feedback: null })
    if (run?.status === 'completed') await this.deps.readReport()
  }
  private async execute(manual: boolean) {
    if (this.busy || !this.canRun()) return
    this.busy = true
    this.lastWake = Date.now()
    this.clearTimer()
    if (manual) this.emit({ ...this.state, phase: 'generating', feedback: null })
    try {
      // Always reconcile first, including after cold boot, remount, or a lost response.
      const run = await this.deps.readStatus()
      if (this.retired) return
      await this.observe(run)
      if (!this.canRun()) return
      if (run?.status !== 'running' && !manual) return
      if (run?.status === 'running' && !run.resumable) { this.later(); return }
      this.emit({ ...this.state, phase: 'generating', feedback: null })
      const result = await this.deps.step({ establishment_id: this.deps.establishmentId, preferred_language: this.deps.language,
        ...(run?.status === 'running' ? { generation_id: run.generation_id } : { force: true as const }) })
      if (this.retired) return
      if (result.report) {
        this.deps.saveReport(result.report)
        this.emit({ phase: 'idle', run: this.state.run ? { ...this.state.run, status: 'completed', resumable: false } : null, feedback: 'success' })
      } else if (result.error === 'NO_REVIEWS_AVAILABLE') {
        this.emit({ phase: 'idle', run: null, feedback: 'empty' })
      } else if (result.pending && result.generation_id) {
        this.emit({ phase: this.canRun() ? 'generating' : 'paused', feedback: null,
          run: { establishment_id: this.deps.establishmentId, preferred_language: this.deps.language,
            generation_id: result.generation_id, status: 'running', progress: result.progress ?? 0,
            total_steps: result.total_steps ?? run?.total_steps ?? null, resumable: false, error_code: null } })
        this.later(1500)
      } else {
        // Includes concurrent generation, 409, malformed/lost response: verify, never infer failure.
        throw new Error('REPORT_RESPONSE_REQUIRES_RECONCILIATION')
      }
    } catch {
      if (this.retired) return
      console.info('Historical report client interrupted; checking server status')
      try {
        const run = await this.deps.readStatus()
        if (this.retired) return
        if (run) await this.observe(run)
        else this.emit({ ...this.state, phase: 'paused', feedback: null })
      } catch {
        if (this.retired) return
        this.emit({ ...this.state, phase: 'paused', feedback: null })
      }
      if (this.state.phase !== 'failed' && this.state.run?.status !== 'completed') this.later()
    } finally { this.busy = false }
  }
}
