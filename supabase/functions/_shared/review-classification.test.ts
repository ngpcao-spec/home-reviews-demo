import { describe, expect, it } from 'vitest'
import { reviewClassification } from './review-classification.ts'

describe('reviewClassification', () => {
  it.each([1, 2])('marque %i étoile(s) comme nécessitant une attention', (rating) => {
    expect(reviewClassification(rating)).toEqual({
      requires_attention: true,
      requires_ai_analysis: false,
      status: 'to_process',
    })
  })

  it('diffère les avis 3 étoiles pour une future analyse IA', () => {
    expect(reviewClassification(3)).toEqual({
      requires_attention: false,
      requires_ai_analysis: true,
      status: 'new',
    })
  })

  it.each([4, 5])('ne crée aucune alerte pour %i étoiles', (rating) => {
    expect(reviewClassification(rating)).toEqual({
      requires_attention: false,
      requires_ai_analysis: false,
      status: 'ignored',
    })
  })
})

