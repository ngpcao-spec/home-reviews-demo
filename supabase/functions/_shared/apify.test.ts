import { describe, expect, it } from 'vitest'
import { apifyActorInput, normalizeApifyDataset, normalizeApifyReview } from './apify.ts'
import { DEFAULT_INITIAL_REVIEWS_LIMIT } from './initial-import'

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
  responseFromOwnerDate: '2026-09-29T01:00:00.000Z',
  likesCount: 7,
  reviewOrigin: 'google',
  visitedIn: 'September 2026',
  reviewContext: { Meal: 'Dinner' },
  reviewDetailedRating: { Food: 2, Service: 1, Atmosphere: 4 },
  reviewImageUrls: ['https://example.com/review-photo.jpg'],
  reviewerId: 'reviewer-123',
  reviewerUrl: 'https://www.google.com/maps/contrib/reviewer-123',
  reviewerNumberOfReviews: 12,
  reviewerPhotoUrl: 'https://example.com/reviewer.jpg',
  isLocalGuide: true,
  scrapedAt: '2026-09-29T02:00:00.000Z',
  name: 'Client',
  title: 'Restaurant test',
  inputStartUrl: 'https://www.google.com/maps/place/Restaurant+test/@12.2,109.1,17z',
  address: 'Nha Trang, Vietnam',
  totalScore: 4.6,
  reviewsCount: 4430,
  placeId: 'ChIJ-test',
  url: 'https://www.google.com/maps/place/test',
}

describe('ApifyReviewProvider normalization', () => {
  it('requests one newest-first initial sample capped at 100 reviews', () => {
    expect(apifyActorInput({
      placeUrl: item.url,
      language: 'fr',
      sort: 'newest',
      limit: DEFAULT_INITIAL_REVIEWS_LIMIT,
    })).toMatchObject({
      startUrls: [{ url: item.url }],
      reviewsOrigin: 'google',
      reviewsSort: 'newest',
      language: 'fr',
      personalData: true,
      maxReviews: 100,
    })
  })

  it('keeps original and translated texts separate with a stable review id', () => {
    expect(normalizeApifyReview(item)).toMatchObject({
      externalReviewId: 'review-123',
      text: 'Очень медленное обслуживание.',
      translatedText: 'Service très lent.',
      language: 'ru',
      translatedLanguage: 'fr',
      rating: 2,
      ownerResponse: 'Спасибо за отзыв.',
      likesCount: 7,
      reviewOrigin: 'google',
      visitedIn: 'September 2026',
      responseFromOwnerDate: '2026-09-29T01:00:00.000Z',
      reviewContext: { Meal: 'Dinner' },
      reviewDetailedRating: { Food: 2, Service: 1, Atmosphere: 4 },
      reviewImageUrls: ['https://example.com/review-photo.jpg'],
      reviewerId: 'reviewer-123',
      reviewerNumberOfReviews: 12,
      isLocalGuide: true,
      providerScrapedAt: '2026-09-29T02:00:00.000Z',
      rawPayload: item,
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

  it('keeps the canonical Google Maps place name instead of a localized actor title', () => {
    const result = normalizeApifyDataset([{
      ...item,
      title: 'Nhà hàng Green Home',
      inputStartUrl: 'https://www.google.com/maps/place/Green+Home+Restaurant/@12.2,109.1,17z',
    }], item.url)

    expect(result.establishment.name).toBe('Green Home Restaurant')
  })

  it.each([
    ['vi', 'Nhà hàng Green Home'],
    ['fr', 'Restaurant Green Home'],
  ])('uses the resolved canonical URL for %s instead of the localized title', (_language, localizedTitle) => {
    const result = normalizeApifyDataset([{
      ...item,
      title: localizedTitle,
      inputStartUrl: 'https://www.google.com/maps/search/?api=1&query=localized',
    }], 'https://www.google.com/maps/search/?api=1&query=localized', 'https://www.google.com/maps/place/Green+Home+Restaurant/@12.2,109.1,17z')

    expect(result.establishment.name).toBe('Green Home Restaurant')
    expect(result.establishment.rawPlacePayload?.title).toBe(localizedTitle)
  })
})
