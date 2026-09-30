export interface NotificationEligibleReview {
  rating: number
  historical_import: boolean
  has_negative_feedback?: boolean | null
}

export function shouldCreateReviewNotification(review: NotificationEligibleReview) {
  if (review.historical_import || !Number.isInteger(review.rating)) return false
  if (review.rating >= 1 && review.rating <= 3) return true
  return review.rating === 4 && review.has_negative_feedback === true
}

export function isDuplicateNotificationError(code?: string) {
  return code === '23505'
}

export async function runNonBlockingNotification(task: () => Promise<void>) {
  try {
    await task()
    return 'completed' as const
  } catch {
    return 'failed' as const
  }
}
