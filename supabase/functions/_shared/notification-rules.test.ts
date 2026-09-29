import { describe, expect, it } from 'vitest'
import { isDuplicateNotificationError, runNonBlockingNotification, shouldCreateReviewNotification } from './notification-rules'

describe('notification après analyse IA', () => {
  it.each([
    [1, true],
    [2, true],
    [3, true],
    [4, false],
    [5, false],
  ])('%i★ → notification %s', (rating, expected) => {
    expect(shouldCreateReviewNotification({ rating, historical_import: false })).toBe(expected)
  })

  it('exclut les imports historiques', () => {
    expect(shouldCreateReviewNotification({ rating: 1, historical_import: true })).toBe(false)
  })
  it('reconnaît une insertion déjà dédupliquée', () => {
    expect(isDuplicateNotificationError('23505')).toBe(true)
    expect(isDuplicateNotificationError('PUSH_FAILED')).toBe(false)
  })

  it('absorbe un échec push sans propager l’erreur', async () => {
    await expect(runNonBlockingNotification(async () => { throw new Error('PUSH_FAILED') })).resolves.toBe('failed')
  })
})
