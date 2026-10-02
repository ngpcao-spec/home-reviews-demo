export type ResolutionStage = 'authentication' | 'validation' | 'membership' | 'language'
  | 'provider' | 'link_resolution' | 'run_start' | 'run_wait' | 'dataset_fetch' | 'normalization' | 'duplicate_check'
export type ResolutionObserver = (stage: ResolutionStage) => void

const safeCodes = new Set([
  'UNAUTHORIZED', 'FORBIDDEN', 'RATE_LIMITED', 'INVALID_JSON', 'INVALID_GOOGLE_MAPS_LINK',
  'ESTABLISHMENT_ALREADY_ADDED', 'ESTABLISHMENT_NOT_FOUND', 'GOOGLE_MAPS_LINK_RESOLUTION_FAILED',
  'APIFY_TOKEN_MISSING', 'APIFY_AUTH_ERROR', 'APIFY_BILLING_REQUIRED', 'APIFY_RATE_LIMIT',
  'APIFY_INVALID_RESPONSE', 'APIFY_INVALID_RUN', 'APIFY_INVALID_DATASET', 'APIFY_TIMEOUT', 'APIFY_UNAVAILABLE',
  'APIFY_RUN_FAILED', 'APIFY_RUN_TIMED-OUT', 'APIFY_RUN_ABORTED',
  'OUTSCRAPER_UNAVAILABLE', 'OUTSCRAPER_TIMEOUT', 'OUTSCRAPER_AUTH_ERROR', 'OUTSCRAPER_INVALID_QUERY',
])

export function safeResolutionError(error: unknown): string {
  if (error instanceof SyntaxError) return 'INVALID_JSON'
  const candidate = error instanceof Error ? error.message : ''
  if (safeCodes.has(candidate) || /^APIFY_(?:DATASET_)?HTTP_[45]\d{2}$/.test(candidate)) return candidate
  return 'INTERNAL_ERROR'
}

export function createResolutionDiagnostics() {
  const diagnosticId = crypto.randomUUID()
  const startedAt = Date.now()
  let stage: ResolutionStage = 'authentication'
  const emit = (event: string, errorCode?: string) => {
    // Explicit fields only: never serialize requests, errors, stacks or provider payloads.
    console.info(JSON.stringify({ event, diagnostic_id: diagnosticId, stage,
      elapsed_ms: Date.now() - startedAt, ...(errorCode ? { error_code: errorCode } : {}) }))
  }
  return {
    step: (next: ResolutionStage) => { stage = next; emit('resolve_establishment_step') },
    failed: (error: unknown) => emit('resolve_establishment_failed', safeResolutionError(error)),
    completed: () => emit('resolve_establishment_completed'),
  }
}
