import { describe, expect, it } from 'vitest'
import { shouldAutomaticallyAnalyzeReview } from './ai-rules'

describe('déclenchement automatique Terra', () => {
  it('ignore toujours un avis issu de l’import historique', () => {
    expect(shouldAutomaticallyAnalyzeReview({ rating: 2, historical_import: true, text: 'Problème' })).toBe(false)
    expect(shouldAutomaticallyAnalyzeReview({ rating: 4, historical_import: true, text: 'Attente longue' })).toBe(false)
  })

  it('analyse les nouveaux avis 1★ à 3★', () => {
    expect(shouldAutomaticallyAnalyzeReview({ rating: 1, historical_import: false })).toBe(true)
    expect(shouldAutomaticallyAnalyzeReview({ rating: 3, historical_import: false })).toBe(true)
  })

  it('vérifie une seule fois un nouvel avis 4★ avec texte', () => {
    expect(shouldAutomaticallyAnalyzeReview({ rating: 4, historical_import: false, text: 'Très bon, mais 45 minutes d’attente.' })).toBe(true)
    expect(shouldAutomaticallyAnalyzeReview({ rating: 4, historical_import: false, text: '' })).toBe(false)
    expect(shouldAutomaticallyAnalyzeReview({ rating: 4, historical_import: false, text: 'Critique', negative_feedback_checked_at: '2026-09-30T00:00:00Z' })).toBe(false)
    expect(shouldAutomaticallyAnalyzeReview({ rating: 5, historical_import: false, text: 'Texte' })).toBe(false)
  })
}
