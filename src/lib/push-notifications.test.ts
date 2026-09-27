import { describe, expect, it } from 'vitest'
import { getPushUiState, shouldNotifyForRating } from './push-notifications'

describe('règles de notification V1', () => {
  it.each([
    [1, true],
    [2, true],
    [3, true],
    [4, false],
    [5, false],
  ])('%i étoile(s) → notification %s', (rating, expected) => {
    expect(shouldNotifyForRating(rating)).toBe(expected)
  })

  it('représente une permission refusée sans abonnement', () => {
    expect(getPushUiState(true, 'denied', false)).toBe('denied')
  })

  it('reste désactivé en absence de subscription', () => {
    expect(getPushUiState(true, 'granted', false)).toBe('disabled')
  })

  it('est activé uniquement avec permission et subscription', () => {
    expect(getPushUiState(true, 'granted', true)).toBe('enabled')
  })
})
