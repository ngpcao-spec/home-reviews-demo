import { describe, expect, it } from 'vitest'
import { canAddEstablishment, deterministicReviewKey, previousPeriod, transitionReview } from './review-rules'

describe('transitions et entitlements', () => {
  it('traite puis rouvre un avis', () => {
    expect(transitionReview('to_process', 'process')).toBe('processed')
    expect(transitionReview('processed', 'reopen')).toBe('to_process')
  })

  it('respecte la limite d’établissements', () => {
    expect(canAddEstablishment(4, 5)).toBe(true)
    expect(canAddEstablishment(5, 5)).toBe(false)
  })
})

describe('cohérence des données', () => {
  it('déduplique avec ID externe ou hash stable', () => {
    expect(deterministicReviewKey('e1', 'mock', 'r1')).toBe('e1:mock:r1')
    expect(deterministicReviewKey('e1', 'mock', undefined, ['a', 'b'])).toBe(deterministicReviewKey('e1', 'mock', undefined, ['a', 'b']))
  })

  it('calcule la période précédente de même longueur', () => {
    const result = previousPeriod(new Date('2026-09-01'), new Date('2026-10-01'))
    expect(result.end.toISOString()).toContain('2026-09-01')
    expect(result.start.toISOString()).toContain('2026-08-02')
  })
})
