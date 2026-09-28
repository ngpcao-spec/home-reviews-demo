import type { Review } from '../types/domain'

export const REVIEWS_PAGE_SIZE = 25

export function sortReviewsNewest(reviews: Review[]): Review[] {
  return [...reviews].sort(
    (left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime(),
  )
}

export function recentNegativeReviews(reviews: Review[], limit = 5): Review[] {
  return sortReviewsNewest(reviews.filter((review) => review.rating >= 1 && review.rating <= 3))
    .slice(0, limit)
}

export function visibleReviewBatch(reviews: Review[], visibleCount: number): Review[] {
  return reviews.slice(0, Math.max(0, visibleCount))
}

export function nextVisibleReviewCount(total: number, current: number, pageSize = REVIEWS_PAGE_SIZE): number {
  return Math.min(total, current + pageSize)
}
