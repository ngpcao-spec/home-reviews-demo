import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { AnalyticsSessionCache } from './analytics-cache'
import { HistoricalGeneration, type GenerationReply, type HistoricalRun } from './historical-generation'
import { mapHistoricalReport, type HistoricalReportRow } from './historical-report'
import { readUiState, saveUiState } from './navigation-state'
import { supabase } from './supabase'

export function useHistoricalGeneration(cache: AnalyticsSessionCache, userId: string, establishmentId: string, language: string | null, enabled: boolean) {
  const controller = useMemo(() => {
    const key = `historical:${establishmentId}:${language}`
    const storageKey = `historical-run-recent-text-100-6m-v1:${establishmentId}:${language}`
    return cache.generation(key, () => new HistoricalGeneration<HistoricalReportRow>({
      establishmentId, language: language ?? '',
      visible: () => document.visibilityState === 'visible' && navigator.onLine,
      persist: run => saveUiState(userId, storageKey, run),
      intent:{read:()=>readUiState<string>(userId,storageKey+':intent')??null,write:id=>saveUiState(userId,storageKey+':intent',id)},
      readStatus: async () => {
        if (!supabase) throw new Error('SUPABASE_UNAVAILABLE')
        const { data, error } = await supabase.functions.invoke<{ run: HistoricalRun | null }>('get-historical-report-status', {
          body: { establishment_id: establishmentId, preferred_language: language }, signal: AbortSignal.timeout(20_000),
        })
        if (error || !data || !Object.hasOwn(data, 'run')) throw new Error('REPORT_STATUS_UNAVAILABLE')
        return data.run
      },
      enqueue: async body => {
        if (!supabase) throw new Error('SUPABASE_UNAVAILABLE')
        const { data, error } = await supabase.functions.invoke<GenerationReply<HistoricalReportRow>>('generate-historical-report', {
          body, signal: AbortSignal.timeout(20_000),
        })
        if (error || !data) throw new Error('REPORT_STEP_INTERRUPTED')
        return data
      },
      abandon: async requestId => {
        if(!supabase)throw new Error('SUPABASE_UNAVAILABLE')
        const {data,error}=await supabase.functions.invoke<{abandoned:boolean;request_id:string}>('generate-historical-report',{
          body:{action:'abandon_failed',establishment_id:establishmentId,preferred_language:language,request_id:requestId,confirmed:true},signal:AbortSignal.timeout(20_000),
        })
        if(error||data?.abandoned!==true||data.request_id!==requestId)throw new Error('REPORT_ABANDON_FAILED')
      },
      saveReport: row => cache.put(key, mapHistoricalReport(row)),
      readReport: async () => {
        if (!supabase) throw new Error('SUPABASE_UNAVAILABLE')
        const { data, error } = await supabase.from('historical_establishment_reports').select('*')
          .eq('establishment_id', establishmentId).eq('preferred_language', language).maybeSingle()
        if (error) throw new Error('REPORT_READ_UNAVAILABLE')
        // V2 publishes separately; CurrentReports reads it through the same
        // protected server projection. A first V2 report has no legacy row.
        if(data)cache.put(key, mapHistoricalReport(data as HistoricalReportRow), data.updated_at ?? data.generated_at ?? '')
      },
    }, readUiState<HistoricalRun>(userId, storageKey)))
  }, [cache, userId, establishmentId, language])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  useEffect(() => {
    if (!enabled || !establishmentId || !language) return
    const detach = controller.attach()
    const refresh = () => { void controller.wake() }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      detach()
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [controller, enabled, establishmentId, language])
  return { ...state, start: controller.start, abandon:controller.abandon }
}
