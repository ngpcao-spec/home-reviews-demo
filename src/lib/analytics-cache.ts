import type { HistoricalReport } from './historical-report'
import type { WeeklyReport } from './weekly-report'

export type AnalyticsMode = 'current' | 'completed' | 'historical'
export interface AnalyticsSelection { establishmentId: string; mode: AnalyticsMode }
type Report = HistoricalReport | WeeklyReport
interface Entry { report: Report | null; revision: string; checkedAt: number; loading: boolean; error: boolean; version: number }
interface Snapshot { selection?: AnalyticsSelection; entries: Record<string, Entry> }
const FRESH_MS = 30_000

export function resolveAnalyticsSelection(params: URLSearchParams, saved: AnalyticsSelection | undefined, accessibleIds: string[]): AnalyticsSelection {
  const explicit = params.has('establishment') || params.has('mode')
  const candidate = params.get('establishment') ?? (explicit ? '' : saved?.establishmentId ?? '')
  const mode = params.get('mode') ?? (explicit ? 'completed' : saved?.mode ?? 'completed')
  return { establishmentId: accessibleIds.includes(candidate) ? candidate : accessibleIds[0] ?? '',
    mode: mode === 'historical' || mode === 'current' ? mode : 'completed' }
}

export class AnalyticsSessionCache {
  private state: Snapshot = { entries: {} }
  private listeners = new Set<() => void>()
  private pending = new Map<string, Promise<void>>()
  private scroll = new Map<string, number>()
  private retired = false
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit(state: Snapshot) { if (!this.retired) { this.state=state; this.listeners.forEach(listener=>listener()) } }
  setSelection(selection: AnalyticsSelection) {
    if (this.state.selection?.establishmentId === selection.establishmentId && this.state.selection?.mode === selection.mode) return
    this.emit({...this.state,selection})
  }
  put(key: string, report: Report | null, revision = report?.generatedAt ?? '') {
    const previous=this.state.entries[key]
    this.emit({...this.state,entries:{...this.state.entries,[key]:{
      report: previous && previous.revision===revision && previous.report?.id===report?.id ? previous.report : report,
      revision,checkedAt:Date.now(),loading:false,error:false,version:(previous?.version ?? 0)+1,
    }}})
  }
  load(key: string, loader: () => Promise<{report: Report | null;revision:string}>, options: {force?:boolean;revalidate?:boolean} = {}) {
    const inflight=this.pending.get(key)
    if (inflight) return inflight
    const previous=this.state.entries[key]
    if (this.retired || !options.force && previous && (Date.now()-previous.checkedAt<FRESH_MS || previous.report && !options.revalidate)) return Promise.resolve()
    const version=previous?.version ?? 0
    this.emit({...this.state,entries:{...this.state.entries,[key]:{...(previous ?? {report:null,revision:'',checkedAt:0,version}),loading:true,error:false}}})
    const task=Promise.resolve().then(loader).then(({report,revision})=>{
      // A slow read must not overwrite a newer manual generation.
      if (this.state.entries[key]?.version===version) this.put(key,report,revision)
    }).catch(()=>{
      const current=this.state.entries[key]
      if(current?.version===version) this.emit({...this.state,entries:{...this.state.entries,[key]:{...current,loading:false,error:true,checkedAt:Date.now()}}})
    }).finally(()=>{this.pending.delete(key)})
    this.pending.set(key,task)
    return task
  }
  getScroll(key:string) { return this.scroll.get(key) ?? 0 }
  saveScroll(key:string,position:number) { if(!this.retired) this.scroll.set(key,Math.max(0,position)) }
  dispose() { this.retired=true;this.state={entries:{}};this.scroll.clear();this.listeners.forEach(listener=>listener()) }
}

const sessions=new Map<string,AnalyticsSessionCache>()
export function analyticsSession(userId:string) {
  let cache=sessions.get(userId)
  if(!cache) { cache=new AnalyticsSessionCache();sessions.set(userId,cache) }
  return cache
}
export function resetAnalyticsCache() { sessions.forEach(cache=>cache.dispose());sessions.clear() }
