export const DEFAULT_HISTORICAL_RECENT_WINDOW_DAYS = 30
export const HISTORICAL_NEGATIVE_LIMIT = 100

export interface InitialImportReview {
  externalReviewId: string
  rating: number
  publishedAt: string | null
}

export function historicalRecentWindowDays(value?: string): number {
  if (!value?.trim()) return DEFAULT_HISTORICAL_RECENT_WINDOW_DAYS
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 365
    ? parsed
    : DEFAULT_HISTORICAL_RECENT_WINDOW_DAYS
}

export function initialImportCutoffSeconds(nowMs: number, windowDays: number): number {
  return Math.floor((nowMs - windowDays * 24 * 60 * 60 * 1_000) / 1_000)
}

export function mergeInitialReviewPasses<T extends InitialImportReview>(
  recentPass: T[],
  historicalPass: T[],
  cutoffMilliseconds: number,
): { recentFetched: number; recentNegative: number; reviews: T[] } {
  const recentNegative = recentPass.filter((review) => {
    const publishedAt = review.publishedAt ? Date.parse(review.publishedAt) : Number.NaN
    return review.rating >= 1
      && review.rating <= 3
      && Number.isFinite(publishedAt)
      && publishedAt >= cutoffMilliseconds
  })
  const historicalNegative = historicalPass
    .filter((review) => review.rating >= 1 && review.rating <= 3)
    .slice(0, HISTORICAL_NEGATIVE_LIMIT)

  const unique = new Map<string, T>()
  for (const review of [...recentNegative, ...historicalNegative]) {
    if (review.externalReviewId && !unique.has(review.externalReviewId)) {
      unique.set(review.externalReviewId, review)
    }
  }

  const reviews = [...unique.values()].sort((left, right) => {
    const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0
    const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0
    return rightTime - leftTime
  })

  return { recentFetched: recentPass.length, recentNegative: recentNegative.length, reviews }
}
