import { describe, expect, it, vi } from 'vitest'
import {
  fetchOutscraperGoogleReviews,
  fetchOutscraperReviews,
  normalizeOutscraperPayload,
  OutscraperError,
} from './outscraper.ts'

const payload = {
  status: 'Success',
  data: [{
    name: 'Le Petit Hanoi',
    full_address: '12 rue de la Paix, Paris',
    rating: 4.2,
    reviews: 318,
    place_id: 'ChIJ-place',
    google_id: '0xgoogle:id',
    location_link: 'https://maps.google.com/place',
    photo: 'https://images.example/place.jpg',
    reviews_data: [{
      review_id: 'review-1',
      google_id: '0xgoogle:id',
      author_title: 'Camille',
      author_image: 'https://images.example/camille.jpg',
      review_rating: 2,
      review_text: 'Service trop lent.',
      review_timestamp: 1_716_000_000,
      review_link: 'https://maps.google.com/review/1',
      owner_answer: 'Merci pour votre retour.',
    }],
  }],
}

describe('Outscraper Google reviews', () => {
  it('normalise les informations établissement et avis', () => {
    const result = normalizeOutscraperPayload(payload)
    expect(result.establishment).toEqual({
      name: 'Le Petit Hanoi',
      fullAddress: '12 rue de la Paix, Paris',
      rating: 4.2,
      totalReviews: 318,
      placeId: 'ChIJ-place',
      googleId: '0xgoogle:id',
      locationLink: 'https://maps.google.com/place',
      photo: 'https://images.example/place.jpg',
    })
    expect(result.reviews[0]).toMatchObject({
      externalReviewId: 'review-1',
      establishmentGoogleId: '0xgoogle:id',
      authorName: 'Camille',
      rating: 2,
      ownerResponse: 'Merci pour votre retour.',
    })
  })

  it('envoie uniquement la clé dans le header et impose le tri récent avec 20 avis maximum', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }))
    await fetchOutscraperGoogleReviews({
      query: 'Le Petit Hanoi',
      apiKey: 'server-secret',
      reviewsLimit: 99,
      fetcher,
    })

    const [url, init] = fetcher.mock.calls[0]
    const requestedUrl = new URL(String(url))
    expect(requestedUrl.searchParams.get('sort')).toBe('newest')
    expect(requestedUrl.searchParams.get('reviewsLimit')).toBe('20')
    expect(requestedUrl.searchParams.get('source')).toBe('google')
    expect(requestedUrl.searchParams.get('limit')).toBe('1')
    expect(requestedUrl.searchParams.get('async')).toBe('false')
    expect(requestedUrl.searchParams.has('apiKey')).toBe(false)
    expect((init?.headers as Record<string, string>)['X-API-KEY']).toBe('server-secret')
  })

  it('transmet le filtre négatif documenté et accepte la récupération illimitée', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }))
    await fetchOutscraperReviews({
      query: '0x123:0x456',
      apiKey: 'server-secret',
      reviewsLimit: 0,
      sort: 'lowest_rating',
      cutoffRating: 3,
      fetcher,
    })

    const requestedUrl = new URL(String(fetcher.mock.calls[0][0]))
    expect(requestedUrl.searchParams.get('reviewsLimit')).toBe('0')
    expect(requestedUrl.searchParams.get('sort')).toBe('lowest_rating')
    expect(requestedUrl.searchParams.get('cutoffRating')).toBe('3')
  })

  it('transmet le curseur et la borne temporelle pour une pagination incrémentale', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }))
    await fetchOutscraperReviews({
      query: '0x123:0x456',
      apiKey: 'server-secret',
      reviewsLimit: 20,
      sort: 'newest',
      cutoff: 1_700_000_000,
      lastPaginationId: 'next-page',
      fetcher,
    })

    const requestedUrl = new URL(String(fetcher.mock.calls[0][0]))
    expect(requestedUrl.searchParams.get('cutoff')).toBe('1700000000')
    expect(requestedUrl.searchParams.get('lastPaginationId')).toBe('next-page')
  })

  it('resolves a short Google Maps URL server-side before calling Outscraper', async () => {
    const redirectResponse = new Response('', { status: 200 })
    Object.defineProperty(redirectResponse, 'url', {
      value: 'https://www.google.com/maps/place/Test/data=!4m2!3m1!1s0x123:0x456',
    })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(redirectResponse)
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))

    await fetchOutscraperGoogleReviews({
      query: 'https://maps.app.goo.gl/short-link',
      apiKey: 'server-secret',
      fetcher,
    })

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(String(fetcher.mock.calls[0][0])).toBe('https://maps.app.goo.gl/short-link')
    const outscraperUrl = new URL(String(fetcher.mock.calls[1][0]))
    expect(outscraperUrl.searchParams.get('query')).toBe('0x123:0x456')
    expect((fetcher.mock.calls[1][1]?.headers as Record<string, string>)['X-API-KEY']).toBe('server-secret')
  })

  it.each([
    [401, 'OUTSCRAPER_AUTH_ERROR'],
    [402, 'OUTSCRAPER_BILLING_REQUIRED'],
    [404, 'ESTABLISHMENT_NOT_FOUND'],
    [429, 'OUTSCRAPER_QUOTA_EXCEEDED'],
  ])('convertit le statut %i en erreur %s', async (status, code) => {
    const fetcher = vi.fn(async () => new Response('{}', { status }))
    await expect(fetchOutscraperGoogleReviews({ query: 'restaurant', apiKey: 'secret', fetcher }))
      .rejects.toMatchObject<Partial<OutscraperError>>({ code })
  })

  it('refuse une clé absente avant tout appel réseau', async () => {
    const fetcher = vi.fn()
    await expect(fetchOutscraperGoogleReviews({ query: 'restaurant', apiKey: '', fetcher }))
      .rejects.toMatchObject({ code: 'OUTSCRAPER_KEY_MISSING' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('signale une réponse vide', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 200 }))
    await expect(fetchOutscraperGoogleReviews({ query: 'restaurant', apiKey: 'secret', fetcher }))
      .rejects.toMatchObject({ code: 'OUTSCRAPER_EMPTY_RESPONSE' })
  })

  it('signale un établissement introuvable', () => {
    expect(() => normalizeOutscraperPayload({ status: 'Success', data: [] }))
      .toThrowError(expect.objectContaining({ code: 'ESTABLISHMENT_NOT_FOUND' }))
  })

  it('interrompt proprement un appel trop long', async () => {
    const fetcher = vi.fn((_url: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    await expect(fetchOutscraperGoogleReviews({
      query: 'restaurant',
      apiKey: 'secret',
      timeoutMs: 1,
      fetcher,
    })).rejects.toMatchObject({ code: 'OUTSCRAPER_TIMEOUT' })
  })

  it('treats the Outscraper no-place marker as a missing establishment', () => {
    expect(() => normalizeOutscraperPayload({
      status: 'Success',
      data: [[{ google_id: '__NO_PLACE_FOUND__', reviews_data: [] }]],
    })).toThrowError(expect.objectContaining({ code: 'ESTABLISHMENT_NOT_FOUND' }))
  })
})
