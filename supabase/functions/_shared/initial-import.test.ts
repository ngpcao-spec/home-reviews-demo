import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INITIAL_REVIEWS_LIMIT,
  canonicalEstablishmentName,
  initialHistoryComplete,
  initialReviewsLimit,
  prepareInitialReviews,
} from './initial-import'
import { shouldAutomaticallyAnalyzeReview } from './ai-rules'
import { shouldCreateReviewNotification } from './notification-rules'

const now = Date.parse('2026-09-30T00:00:00.000Z')
const review = (index: number, rating = index % 5 + 1) => ({
  externalReviewId: `review-${index}`,
  rating,
  text: 'Un témoignage',
  publishedAt: new Date(now - index * 60_000).toISOString(),
})

describe('import initial des avis les plus récents', () => {
  it('utilise la limite serveur 150 et rejette une ancienne configuration 500', () => {
    expect(DEFAULT_INITIAL_REVIEWS_LIMIT).toBe(150)
    expect(initialReviewsLimit(undefined)).toBe(150)
    expect(initialReviewsLimit('65')).toBe(65)
    expect(initialReviewsLimit('500')).toBe(150)
    expect(initialReviewsLimit('151')).toBe(150)
    expect(initialReviewsLimit('incorrect')).toBe(150)
  })

  it.each([65, 150])('conserve tous les %i avis disponibles', (total) => {
    const result = prepareInitialReviews(Array.from({ length: total }, (_, index) => review(index)))
    expect(result).toHaveLength(total)
    expect(initialHistoryComplete(total, result.length, 150)).toBe(true)
    expect(initialHistoryComplete(total, result.length - 1, 150)).toBe(false)
  })

  it.each([345, 1_659, 10_000])('plafonne à 150 les %i avis Google les plus récents', (total) => {
    const result = prepareInitialReviews(Array.from({ length: total }, (_, index) => review(index)))
    expect(result).toHaveLength(150)
    expect(result[0].externalReviewId).toBe('review-0')
    expect(result.at(-1)?.externalReviewId).toBe('review-149')
    expect(initialHistoryComplete(total, result.length, 150)).toBe(false)
  })

  it('conserve toutes les notes 1★ à 5★, déduplique et trie par date décroissante', () => {
    const mixed = [1, 2, 3, 4, 5].map((rating, index) => review(index + 1, rating))
    const result = prepareInitialReviews([mixed[4], ...mixed, mixed[0]])
    expect(result.map((item) => item.rating).sort()).toEqual([1, 2, 3, 4, 5])
    expect(result.map((item) => item.externalReviewId)).toEqual([
      'review-1', 'review-2', 'review-3', 'review-4', 'review-5',
    ])
  })

  it('utilise le premier avis trié comme checkpoint, quelle que soit sa note', () => {
    const newestPositive = review(0, 5)
    const result = prepareInitialReviews([review(2, 1), newestPositive, review(1, 3)])
    expect(result[0]).toEqual(newestPositive)
  })

  it.each([1, 2, 3, 4, 5])('ne déclenche ni Terra ni notification pour un import historique %i★', (rating) => {
    expect(shouldAutomaticallyAnalyzeReview({ rating, historical_import: true })).toBe(false)
    expect(shouldCreateReviewNotification({ rating, historical_import: true })).toBe(false)
  })

  it('never overwrites an existing canonical establishment name with a localized provider title', () => {
    expect(canonicalEstablishmentName('Green Home Restaurant', 'Nhà hàng Green Home')).toBe('Green Home Restaurant')
    expect(canonicalEstablishmentName(null, 'Green Home Restaurant')).toBe('Green Home Restaurant')
  })
  it('keeps textless and old reviews, preserves text across duplicates and cannot refresh an old publication',()=>{
    const valid=review(0),empty={...review(1),text:' '},old={...review(2),publishedAt:'2020-01-01T00:00:00.000Z'};
    expect(prepareInitialReviews([valid,{...valid,text:''},empty,old,{...old,publishedAt:valid.publishedAt}])).toEqual([valid,empty,old]);
  })
})
