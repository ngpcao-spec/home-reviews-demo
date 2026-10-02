export const HISTORICAL_REPORT_CONCURRENCY = 2
export const HISTORICAL_REPORT_LEASE_SECONDS = 240
export const HISTORICAL_REPORT_MAX_ATTEMPTS = 5
export const HISTORICAL_REPORT_BACKOFF_SECONDS = [60,180,600,1800] as const
export function historicalRetry(error: unknown, attempt: number) {
  const message = error instanceof Error ? error.message : ''
  const code = /^[A-Z0-9_]+$/.test(message) ? message
    : error instanceof Error && ['AbortError','TimeoutError'].includes(error.name) ? 'REPORT_PROVIDER_TIMEOUT' : 'REPORT_NETWORK_ERROR'
  const transient = /^(OPENAI_HTTP_(429|5\d\d)|REPORT_(NETWORK_ERROR|PROVIDER_TIMEOUT|PROGRESS_SAVE_FAILED|RUN_READ_FAILED|SAVE_FAILED|REVIEWS_READ_FAILED|ESTABLISHMENT_READ_FAILED))$/.test(code)
  return { code, status: transient && attempt < HISTORICAL_REPORT_MAX_ATTEMPTS ? 'retry' : 'failed',
    delay: HISTORICAL_REPORT_BACKOFF_SECONDS[Math.min(Math.max(attempt-1,0),3)] }
}
