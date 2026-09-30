import type { Review } from '../types/domain'

export const REVIEWS_PAGE_SIZE = 25

export function isNegativeReview(review: Review): boolean {
  return review.rating >= 1 && review.rating <= 3
}

export function isAttentionReview(review: Review): boolean {
  return isNegativeReview(review)
    || (review.rating === 4 && review.hasNegativeFeedback === true)
}

export function negativeReviews(reviews: Review[]): Review[] {
  return reviews.filter(isNegativeReview)
}

export function attentionReviews(reviews: Review[]): Review[] {
  return reviews.filter(isAttentionReview)
}

export function sortReviewsNewest(reviews: Review[]): Review[] {
  return [...reviews].sort(
    (left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime(),
  )
}

export function recentNegativeReviews(reviews: Review[], limit = 5): Review[] {
  return sortReviewsNewest(negativeReviews(reviews))
    .slice(0, limit)
}

export function visibleReviewBatch(reviews: Review[], visibleCount: number): Review[] {
  return reviews.slice(0, Math.max(0, visibleCount))
}

export function nextVisibleReviewCount(total: number, current: number, pageSize = REVIEWS_PAGE_SIZE): number {
  return Math.min(total, current + pageSize)
}
