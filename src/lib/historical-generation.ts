/** Client observer only. The server owns scheduling, steps, retries and completion. */
export interface HistoricalRun {
  shared_jev?:boolean
  request_id?:string;engine?:'sol_legacy'|'jev_sol_v2';comparison_id?:string|null;stage?:string
  source_run_id?:string;jev_transport?:'individual'|'batch_initial_v1';created_at?:string;completed_at?:string|null
  progress_unit?:'jev_batches'|'steps';completed_reviews?:number;total_reviews?:number;batch_run_id?:string;unknown_batches?:number;sol_attempts?:number;can_resume?:boolean
  abandoned?:boolean;can_abandon?:boolean
  establishment_id: string
  preferred_language: string
  generation_id: string
  status: 'queued' | 'running' | 'retry' | 'completed' | 'failed'
  progress: number
  total_steps: number | null
  resumable: boolean
  error_code: string | null
}
export interface GenerationReply<T> {
  report?: T; run?: HistoricalRun; error?: string; pending?: boolean; generation_id?: string; progress?: number; total_steps?: number
}
export const activeHistoricalRun = (run: HistoricalRun | null) => !!run && ['queued','running','retry'].includes(run.status)
export interface GenerationState {
  phase: 'idle' | 'generating' | 'paused' | 'failed'
  run: HistoricalRun | null
  feedback: 'success' | 'empty' | 'abandoned' | null
}
interface Dependencies<T> {
  establishmentId: string
  language: string
  readStatus: () => Promise<HistoricalRun | null>
  enqueue: (body: { establishment_id: string; preferred_language: string; force: true;request_id?:string }) => Promise<GenerationReply<T>>
  abandon?: (requestId:string) => Promise<void>
  intent?:{read:()=>string|null;write:(id:string|null)=>void}
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
  private intent:string|null=null
  constructor(private deps: Dependencies<T>, saved?: HistoricalRun) {
    this.intent=deps.intent?.read()??null
    const run = saved?.establishment_id === deps.establishmentId && saved.preferred_language === deps.language ? saved : null
    // Local storage is a hint, never evidence of server failure or authority to generate.
    this.state = { phase: activeHistoricalRun(run) ? 'paused' : 'idle', run, feedback: null }
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
  abandon = async () => {
    const run=this.state.run
    if(this.busy||!this.canRun()||run?.status!=='failed'||!run.request_id||!run.can_abandon||!this.deps.abandon)return false
    this.busy=true;this.clearTimer()
    try{
      await this.deps.abandon(run.request_id)
      if(this.retired)return false
      this.intent=null;this.deps.intent?.write(null)
      this.emit({phase:'idle',run:null,feedback:'abandoned'})
      return true
    }catch{
      // A lost acknowledgment is reconciled by read only, never a new report.
      try{const latest=await this.deps.readStatus();if(latest?.abandoned){await this.observe(latest);return true}}catch{/* Retain the failed request for an explicit later action. */}
      return false
    }finally{this.busy=false}
  }
  private async observe(run: HistoricalRun | null) {
    if (this.retired) return
    if(run?.abandoned){this.intent=null;this.deps.intent?.write(null);this.emit({phase:'idle',run:null,feedback:'abandoned'});return}
    if(run?.request_id&&run.request_id===this.intent){this.intent=null;this.deps.intent?.write(null)}
    this.emit({ run, phase: run?.status === 'failed' ? 'failed' : activeHistoricalRun(run)
      ? this.canRun() ? 'generating' : 'paused' : 'idle', feedback: run?.status==='failed' && run.error_code==='NO_REVIEWS_AVAILABLE'?'empty':null })
    if (run?.status === 'completed') {
      // A report refresh failure cannot turn a confirmed finished request back
      // into a loading indicator. The report panel reconciles independently.
      try { await this.deps.readReport() } catch { console.info('Completed report refresh unavailable; generation remains completed') }
    }
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
      if (activeHistoricalRun(run)) { this.later(); return }
      if (!manual) return
      this.emit({ ...this.state, phase: 'generating', feedback: null })
      // The ONLY mutating client request: an explicit user's click, never a timer/foreground return.
      if(this.deps.intent&&!this.intent){this.intent=crypto.randomUUID();this.deps.intent.write(this.intent)}
      const result = await this.deps.enqueue({ establishment_id: this.deps.establishmentId, preferred_language: this.deps.language, force: true,...(this.intent?{request_id:this.intent}:{}) })
      if (this.retired) return
      if (result.report) {
        this.deps.saveReport(result.report)
        this.emit({ phase: 'idle', run: this.state.run ? { ...this.state.run, status: 'completed', resumable: false } : null, feedback: 'success' })
      } else if (result.error === 'NO_REVIEWS_AVAILABLE') {
        this.emit({ phase: 'idle', run: null, feedback: 'empty' })
      } else if (result.run) {
        await this.observe(result.run)
        if(activeHistoricalRun(result.run)) this.later()
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
