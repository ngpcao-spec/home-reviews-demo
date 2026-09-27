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
