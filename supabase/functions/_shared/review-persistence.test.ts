import { describe, expect, it } from 'vitest'
import {
  REVIEW_PERSIST_BATCH_SIZE,
  reviewPersistenceBatches,
} from './review-persistence'

describe('review persistence batches', () => {
  it('divise 500 payloads Apify volumineux en lots de 50 maximum', () => {
    const reviews = Array.from({ length: 500 }, (_, index) => ({
      externalReviewId: `Ci9DQUlRQUNvZENodHljRjlv${String(index).padStart(5, '0')}${'x'.repeat(72)}`,
      text: `Review ${index} ${'t'.repeat(1_024)}`,
      translatedText: `Traduction ${index} ${'v'.repeat(1_024)}`,
      reviewContext: { service: 's'.repeat(1_024) },
      reviewDetailedRating: { food: 4, service: 3, atmosphere: 5 },
      rawPayload: { unknownProviderField: 'p'.repeat(8_192) },
    }))

    const batches = reviewPersistenceBatches(reviews)

    expect(REVIEW_PERSIST_BATCH_SIZE).toBe(50)
    expect(batches).toHaveLength(10)
    expect(batches.every((batch) => batch.length <= 50)).toBe(true)
    expect(batches.flat()).toEqual(reviews)
    expect(Math.max(...batches.map((batch) => batch
      .map((review) => review.externalReviewId).join(',').length))).toBeLessThan(8_000)
  })

  it('conserve un dernier lot partiel sans perte ni doublon', () => {
    const reviews = Array.from({ length: 348 }, (_, index) => `review-${index}`)
    const batches = reviewPersistenceBatches(reviews)
    expect(batches.map((batch) => batch.length)).toEqual([50, 50, 50, 50, 50, 50, 48])
    expect(new Set(batches.flat()).size).toBe(348)
  })
})
