import { describe, expect, it } from 'vitest'
import { shouldAutomaticallyAnalyzeReview } from './ai-rules'

describe('déclenchement automatique Terra', () => {
  it('ignore toujours un avis issu de l’import historique', () => {
    expect(shouldAutomaticallyAnalyzeReview({ rating: 2, historical_import: true })).toBe(false)
  })

  it('analyse uniquement un nouvel avis 1★ à 3★ de la surveillance', () => {
    expect(shouldAutomaticallyAnalyzeReview({ rating: 1, historical_import: false })).toBe(true)
    expect(shouldAutomaticallyAnalyzeReview({ rating: 3, historical_import: false })).toBe(true)
    expect(shouldAutomaticallyAnalyzeReview({ rating: 4, historical_import: false })).toBe(false)
  })
})
