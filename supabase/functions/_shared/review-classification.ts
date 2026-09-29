export function reviewClassification(rating: number) {
  if (rating >= 1 && rating <= 3) {
    return {
      requires_attention: true,
      requires_ai_analysis: true,
      status: 'to_process',
    } as const
  }
  return {
    requires_attention: false,
    requires_ai_analysis: false,
    status: 'ignored',
  } as const
}

export function reviewsForPersistence<T extends { externalReviewId: string; rating: number }>(reviews: T[]): T[] {
  return reviews.filter((review) =>
    review.externalReviewId.length > 0
    && review.rating >= 1
    && review.rating <= 5
  )
}
