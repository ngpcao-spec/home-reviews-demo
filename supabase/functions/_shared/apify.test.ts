import { describe, expect, it } from 'vitest'
import { normalizeApifyDataset, normalizeApifyReview } from './apify.ts'

const item = {
  reviewId: 'review-123',
  text: 'Очень медленное обслуживание.',
  textTranslated: 'Service très lent.',
  originalLanguage: 'ru',
  translatedLanguage: 'fr',
  publishedAtDate: '2026-09-29T00:00:00.000Z',
  stars: 2,
  reviewUrl: 'https://www.google.com/maps/reviews/data=review-123',
  responseFromOwnerText: 'Спасибо за отзыв.',
  name: 'Client',
  title: 'Restaurant test',
  address: 'Nha Trang, Vietnam',
  totalScore: 4.6,
  reviewsCount: 4430,
  placeId: 'ChIJ-test',
  url: 'https://www.google.com/maps/place/test',
}

describe('ApifyReviewProvider normalization', () => {
  it('keeps original and translated texts separate with a stable review id', () => {
    expect(normalizeApifyReview(item)).toMatchObject({
      externalReviewId: 'review-123',
      text: 'Очень медленное обслуживание.',
      translatedText: 'Service très lent.',
      language: 'ru',
      translatedLanguage: 'fr',
      rating: 2,
      ownerResponse: 'Спасибо за отзыв.',
    })
  })

  it('maps actor place metadata without changing the review identity', () => {
    const result = normalizeApifyDataset([item], item.url)
    expect(result.provider).toBe('apify')
    expect(result.establishment).toMatchObject({
      name: 'Restaurant test',
      placeId: 'ChIJ-test',
      totalReviews: 4430,
    })
    expect(result.reviews[0].externalReviewId).toBe('review-123')
  })
})
