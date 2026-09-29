import { describe, expect, it } from 'vitest'
import { reviewClassification, reviewsForPersistence } from './review-classification'

describe('persistance et classification des avis 1★ à 5★', () => {
  it('conserve les cinq notes récupérées par le provider', () => {
    const reviews = [1, 2, 3, 4, 5].map((rating) => ({
      externalReviewId: `review-${rating}`,
      rating,
    }))

    expect(reviewsForPersistence(reviews).map((review) => review.rating)).toEqual([1, 2, 3, 4, 5])
  })

  it.each([1, 2, 3])('%i★ reste à traiter et à analyser', (rating) => {
    expect(reviewClassification(rating)).toEqual({
      requires_attention: true,
      requires_ai_analysis: true,
      status: 'to_process',
    })
  })

  it.each([4, 5])('%i★ est conservé sans attention ni IA', (rating) => {
    expect(reviewClassification(rating)).toEqual({
      requires_attention: false,
      requires_ai_analysis: false,
      status: 'ignored',
    })
  })
})
