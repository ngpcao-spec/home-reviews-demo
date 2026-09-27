import { describe, expect, it } from 'vitest'
import { shouldCreateReviewNotification } from './notification-rules'

describe('notification après analyse IA', () => {
  it.each([
    [1, true],
    [2, true],
    [3, true],
    [4, false],
  ])('%i★ → notification %s', (rating, expected) => {
    expect(shouldCreateReviewNotification({ rating, historical_import: false })).toBe(expected)
  })

  it('exclut les imports historiques', () => {
    expect(shouldCreateReviewNotification({ rating: 1, historical_import: true })).toBe(false)
  })
})
