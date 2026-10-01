export const DEFAULT_INITIAL_REVIEWS_LIMIT = 100

export interface InitialImportReview {
  externalReviewId: string
  rating: number
  publishedAt: string | null
}

export function initialReviewsLimit(value?: string): number {
  if (!value?.trim()) return DEFAULT_INITIAL_REVIEWS_LIMIT
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= DEFAULT_INITIAL_REVIEWS_LIMIT
    ? parsed
    : DEFAULT_INITIAL_REVIEWS_LIMIT
}

export function prepareInitialReviews<T extends InitialImportReview>(
  reviews: T[],
  limit = DEFAULT_INITIAL_REVIEWS_LIMIT,
): T[] {
  const safeLimit = Math.min(DEFAULT_INITIAL_REVIEWS_LIMIT, Math.max(1, Math.floor(limit)))
  const unique = new Map<string, T>()
  for (const review of reviews) {
    if (!review.externalReviewId || review.rating < 1 || review.rating > 5) continue
    if (!unique.has(review.externalReviewId)) unique.set(review.externalReviewId, review)
  }

  return [...unique.values()]
    .sort((left, right) => {
      const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0
      const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0
      return rightTime - leftTime
    })
    .slice(0, safeLimit)
}

export function initialHistoryComplete(totalGoogleReviews: number, persistedReviews: number, limit: number): boolean {
  if (!Number.isFinite(totalGoogleReviews) || totalGoogleReviews < 0) return false
  if (totalGoogleReviews > limit) return false
  return persistedReviews >= totalGoogleReviews
}

export function canonicalEstablishmentName(existingName: string | null | undefined, importedName: string): string {
  return existingName?.trim() ? existingName : importedName
}
