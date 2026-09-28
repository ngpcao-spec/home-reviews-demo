import { describe, expect, it } from 'vitest'
import { isNegativeReview, negativeReviews, nextVisibleReviewCount, recentNegativeReviews, visibleReviewBatch } from './review-list'
import type { Review } from '../types/domain'

const makeReview = (id: string, rating: number, day: number): Review => ({
  id,
  organizationId: 'org',
  establishmentId: 'establishment',
  externalReviewId: id,
  authorName: id,
  rating,
  reviewText: id,
  reviewLanguage: 'fr',
  publishedAt: `2026-09-${String(day).padStart(2, '0')}T00:00:00.000Z`,
  sourceUrl: '',
  isHistoricalImport: true,
  requiresAction: rating <= 3,
  status: 'to_process',
})

describe('affichage des listes d’avis', () => {
  it('limite l’accueil aux cinq avis négatifs les plus récents', () => {
    const reviews = [
      makeReview('one', 1, 1),
      makeReview('two', 2, 2),
      makeReview('three', 3, 3),
      makeReview('four', 1, 4),
      makeReview('five', 2, 5),
      makeReview('six', 3, 6),
      makeReview('positive', 5, 7),
    ]
    expect(recentNegativeReviews(reviews).map((review) => review.id))
      .toEqual(['six', 'five', 'four', 'three', 'two'])
  })

  it('exclut toujours les avis 4★ et 5★ même si leur statut demande une action', () => {
    const reviews = [
      makeReview('negative', 3, 1),
      makeReview('positive-four', 4, 2),
      makeReview('positive-five', 5, 3),
    ]
    expect(reviews.map(isNegativeReview)).toEqual([true, false, false])
    expect(negativeReviews(reviews).map((review) => review.id)).toEqual(['negative'])
  })

  it('rend tous les avis accessibles par chargement progressif', () => {
    const reviews = Array.from({ length: 61 }, (_, index) => makeReview(String(index), 2, 1))
    const firstCount = nextVisibleReviewCount(reviews.length, 0)
    const secondCount = nextVisibleReviewCount(reviews.length, firstCount)
    const finalCount = nextVisibleReviewCount(reviews.length, secondCount)
    expect(visibleReviewBatch(reviews, firstCount)).toHaveLength(25)
    expect(visibleReviewBatch(reviews, finalCount)).toHaveLength(61)
  })
})
