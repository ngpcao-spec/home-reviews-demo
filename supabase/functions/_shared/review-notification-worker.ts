export interface ReviewNotification {
  id: string
  user_id: string
  review_id: string
  title: string
  body: string
}
export interface PushReceipt {
  sent: number
  failed: number
  skipped: boolean
  attempted: number
  subscriptionCount: number
  providerStatusCodes: number[]
  expiredRemoved: number
}
export interface ReviewNotificationPorts {
  claim: (claimId: string) => Promise<ReviewNotification | null>
  send: (notification: ReviewNotification) => Promise<PushReceipt>
  finish: (id: string, claimId: string, state: string, receipt: PushReceipt | { error: string }) => Promise<boolean>
}

export async function processReviewNotifications(ports: ReviewNotificationPorts) {
  let processed = 0
  // A small bounded batch; an interruption never reclaims an attempted push.
  for (let index = 0; index < 5; index += 1) {
    const claimId = crypto.randomUUID()
    const notification = await ports.claim(claimId)
    if (!notification) break
    let receipt: PushReceipt | { error: string }
    let state: string
    try {
      const push = await ports.send(notification)
      state = push.skipped ? 'skipped' : push.sent > 0 ? 'sent' : 'failed'
      receipt = push
    } catch {
      state = 'unknown'
      receipt = { error: 'DELIVERY_OUTCOME_UNKNOWN' }
    }
    // Do not catch persistence failure as a transport failure or call send again.
    if (!await ports.finish(notification.id, claimId, state, receipt)) throw new Error('DELIVERY_FINISH_REJECTED')
    processed += 1
  }
  return { version: 'review-notifications-v1', processed }
}
