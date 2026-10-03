// Read only when enqueueing a NEW generation. Workers must use the persisted model.
export const LEGACY_HISTORICAL_MODEL = 'gpt-5.6-terra'
export const DEFAULT_HISTORICAL_MODEL = 'gpt-6.1-sol'
export const HISTORICAL_REASONING_EFFORT = 'low'
export function newHistoricalModel() {
  return Deno.env.get('HISTORICAL_REPORT_MODEL')?.trim() || DEFAULT_HISTORICAL_MODEL
}
