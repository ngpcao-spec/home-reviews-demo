import { describe, expect, it } from 'vitest'
import { isDuplicateNotificationError, runNonBlockingNotification, shouldCreateReviewNotification } from './notification-rules'

describe('notification après analyse IA', () => {
  it.each([
    [1, undefined, true],
    [2, undefined, true],
    [3, undefined, true],
    [4, true, true],
    [4, false, false],
    [5, true, false],
  ])('%i★ / remarque=%s → notification %s', (rating, hasNegativeFeedback, expected) => {
    expect(shouldCreateReviewNotification({
      rating,
      historical_import: false,
      has_negative_feedback: hasNegativeFeedback,
    })).toBe(expected)
  })

  it('exclut tous les imports historiques, y compris les 4★ critiques', () => {
    expect(shouldCreateReviewNotification({ rating: 1, historical_import: true })).toBe(false)
    expect(shouldCreateReviewNotification({ rating: 4, historical_import: true, has_negative_feedback: true })).toBe(false)
  })

  it('reconnaît une insertion déjà dédupliquée', () => {
    expect(isDuplicateNotificationError('23505')).toBe(true)
    expect(isDuplicateNotificationError('PUSH_FAILED')).toBe(false)
  })

  it('absorbe un échec push sans propager l’erreur', async () => {
    await expect(runNonBlockingNotification(async () => { throw new Error('PUSH_FAILED') })).resolves.toBe('failed')
  })
})
