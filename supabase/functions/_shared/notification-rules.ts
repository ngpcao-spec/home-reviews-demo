export interface NotificationEligibleReview {
  rating: number
  historical_import: boolean
}

export function shouldCreateReviewNotification(review: NotificationEligibleReview) {
  return !review.historical_import
    && Number.isInteger(review.rating)
    && review.rating >= 1
    && review.rating <= 3
}
