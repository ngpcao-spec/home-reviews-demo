import { OutscraperError, type NormalizedReview } from './outscraper.ts'
import { ApifyError } from './apify.ts'

export function configuredInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback
}

export function pageBeforeCheckpoint(
  reviews: NormalizedReview[],
  checkpointReviewId: string | null,
) {
  if (!checkpointReviewId) {
    return { reviews, caughtUp: true }
  }
  const checkpointIndex = reviews.findIndex(
    (review) => review.externalReviewId === checkpointReviewId,
  )
  return {
    reviews: checkpointIndex >= 0 ? reviews.slice(0, checkpointIndex) : reviews,
    caughtUp: checkpointIndex >= 0,
  }
}

export function retryPolicy(error: unknown, attempts: number, baseSeconds: number) {
  const code = error instanceof Error ? error.message.slice(0, 200) : 'SYNC_FAILED'
  const terminal = new Set([
    'INVALID_INPUT',
    'OUTSCRAPER_AUTH_ERROR',
    'OUTSCRAPER_BILLING_REQUIRED',
    'OUTSCRAPER_INVALID_QUERY',
    'OUTSCRAPER_KEY_MISSING',
    'ESTABLISHMENT_NOT_FOUND',
    'ESTABLISHMENT_ALREADY_ADDED',
    'ESTABLISHMENT_MISMATCH',
    'APIFY_AUTH_ERROR',
    'APIFY_BILLING_REQUIRED',
    'APIFY_TOKEN_MISSING',
  ])
  const retryable = error instanceof OutscraperError || error instanceof ApifyError
    ? !terminal.has(error.code)
    : !terminal.has(code)
  const multiplier = Math.max(0, Math.min(attempts, 8))
  const backoffSeconds = Math.min(86_400, baseSeconds * (2 ** multiplier))
  return { code, retryable, backoffSeconds }
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  async function consume() {
    while (nextIndex < values.length) {
      const index = nextIndex++
      results[index] = await mapper(values[index])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => consume()),
  )
  return results
}
