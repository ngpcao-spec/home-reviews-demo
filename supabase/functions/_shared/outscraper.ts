const OUTSCRAPER_REVIEWS_ENDPOINT = 'https://api.outscraper.com/google-maps-reviews'
const DEFAULT_TIMEOUT_MS = 25_000
const MAX_REVIEWS = 20
const GOOGLE_MAPS_SHORT_HOST = 'maps.app.goo.gl'

type JsonRecord = Record<string, unknown>

export interface NormalizedReview {
  externalReviewId: string
  establishmentGoogleId: string
  authorName: string
  authorImage: string | null
  rating: number
  text: string
  translatedText?: string | null
  translatedLanguage?: string | null
  publishedAt: string | null
  reviewUrl: string | null
  ownerResponse: string | null
  language: string | null
  paginationId: string | null
  providerPublishAt?: string | null
  providerRating?: number | null
  likesCount?: number | null
  reviewOrigin?: string | null
  visitedIn?: string | null
  responseFromOwnerDate?: string | null
  reviewContext?: unknown | null
  reviewDetailedRating?: unknown | null
  reviewImageUrls?: string[]
  reviewerId?: string | null
  reviewerUrl?: string | null
  reviewerNumberOfReviews?: number | null
  reviewerPhotoUrl?: string | null
  isLocalGuide?: boolean | null
  providerScrapedAt?: string | null
  rawPayload?: JsonRecord
}

export interface NormalizedEstablishment {
  name: string
  fullAddress: string
  rating: number
  totalReviews: number
  placeId: string | null
  googleId: string
  locationLink: string | null
  photo: string | null
  rawPlacePayload?: JsonRecord
}

export interface GoogleReviewsResult {
  provider: 'apify' | 'outscraper' | 'mock'
  establishment: NormalizedEstablishment
  reviews: NormalizedReview[]
  count: number
}

export class OutscraperError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
  ) {
    super(code)
    this.name = 'OutscraperError'
  }
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

const asNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const asOptionalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const asBoolean = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(asString).filter((item): item is string => Boolean(item)) : []

function toIsoDate(timestamp: unknown, dateText: unknown): string | null {
  const numericTimestamp = asNumber(timestamp)
  if (numericTimestamp > 0) {
    const milliseconds = numericTimestamp > 10_000_000_000 ? numericTimestamp : numericTimestamp * 1_000
    const date = new Date(milliseconds)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }

  const text = asString(dateText)
  const match = text?.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/)
  if (!match) return null
  const [, month, day, year, hour, minute, second] = match
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))).toISOString()
}

function firstPlace(payload: unknown): JsonRecord | null {
  const data = isRecord(payload) && 'data' in payload ? payload.data : payload
  const queue: unknown[] = Array.isArray(data) ? [...data] : [data]
  while (queue.length) {
    const current = queue.shift()
    if (Array.isArray(current)) queue.unshift(...current)
    else if (isRecord(current)) return current
  }
  return null
}

function upstreamMessage(payload: unknown): string {
  if (!isRecord(payload)) return ''
  return String(payload.errorMessage ?? payload.message ?? payload.status ?? '')
}

function isMissingGoogleIdentifier(value: string | null): boolean {
  return value === null || /^__NO_(?:PLACE|RESULT)_FOUND__$/i.test(value)
}

async function resolveGoogleMapsShortUrl(
  query: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<string> {
  let input: URL
  try {
    input = new URL(query)
  } catch {
    return query
  }

  if (input.protocol !== 'https:' || input.hostname.toLowerCase() !== GOOGLE_MAPS_SHORT_HOST) {
    return query
  }

  let response: Response
  try {
    response = await fetcher(input, {
      method: 'GET',
      redirect: 'follow',
      signal,
      headers: { 'User-Agent': 'HOME-Reviews/1.0' },
    })
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
    throw new OutscraperError('GOOGLE_MAPS_LINK_RESOLUTION_FAILED', 400)
  }

  if (!response.ok) throw new OutscraperError('GOOGLE_MAPS_LINK_RESOLUTION_FAILED', 400)

  let resolved: URL
  try {
    resolved = new URL(response.url)
  } catch {
    throw new OutscraperError('GOOGLE_MAPS_LINK_RESOLUTION_FAILED', 400)
  }

  const hostname = resolved.hostname.toLowerCase()
  const isGoogleMapsHost = hostname === 'google.com'
    || hostname.endsWith('.google.com')
    || hostname === 'googleusercontent.com'
    || hostname.endsWith('.googleusercontent.com')
  if (!isGoogleMapsHost || !resolved.pathname.includes('/maps')) {
    throw new OutscraperError('GOOGLE_MAPS_LINK_RESOLUTION_FAILED', 400)
  }

  const featureId = resolved.searchParams.get('ftid')
    ?? decodeURIComponent(resolved.toString()).match(/0x[0-9a-f]+:0x[0-9a-f]+/i)?.[0]
  if (featureId && /^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(featureId)) return featureId

  return resolved.toString()
}

function mapHttpError(status: number): OutscraperError {
  if (status === 401 || status === 403) return new OutscraperError('OUTSCRAPER_AUTH_ERROR', 502)
  if (status === 402) return new OutscraperError('OUTSCRAPER_BILLING_REQUIRED', 402)
  if (status === 404) return new OutscraperError('ESTABLISHMENT_NOT_FOUND', 404)
  if (status === 429) return new OutscraperError('OUTSCRAPER_QUOTA_EXCEEDED', 429)
  if (status === 422) return new OutscraperError('OUTSCRAPER_INVALID_QUERY', 400)
  if (status === 204) return new OutscraperError('OUTSCRAPER_EMPTY_RESPONSE', 502)
  return new OutscraperError('OUTSCRAPER_UPSTREAM_ERROR', 502)
}

export function normalizeOutscraperPayload(
  payload: unknown,
  maxReviews: number | null = MAX_REVIEWS,
): Omit<GoogleReviewsResult, 'provider'> {
  const place = firstPlace(payload)
  if (!place) throw new OutscraperError('ESTABLISHMENT_NOT_FOUND', 404)

  const googleId = asString(place.google_id) ?? asString(place.place_id)
  if (!googleId || isMissingGoogleIdentifier(googleId)) throw new OutscraperError('ESTABLISHMENT_NOT_FOUND', 404)

  const allReviews = Array.isArray(place.reviews_data)
    ? place.reviews_data.filter(isRecord)
    : []
  const rawReviews = maxReviews === null ? allReviews : allReviews.slice(0, maxReviews)
  const rawPlacePayload = { ...place }
  delete rawPlacePayload.reviews_data

  const reviews = rawReviews.map((review, index): NormalizedReview => {
    const publishedAt = toIsoDate(review.review_timestamp, review.review_datetime_utc)
    const externalReviewId = asString(review.review_id)
      ?? asString(review.reviews_id)
      ?? `${googleId}:${asString(review.author_id) ?? 'anonymous'}:${publishedAt ?? index}`

    return {
      externalReviewId,
      establishmentGoogleId: asString(review.google_id) ?? googleId,
      authorName: asString(review.author_title) ?? 'Client Google',
      authorImage: asString(review.author_image),
      rating: asNumber(review.review_rating ?? review.rating),
      text: asString(review.review_text) ?? '',
      publishedAt,
      reviewUrl: asString(review.review_link),
      ownerResponse: asString(review.owner_answer),
      language: asString(review.review_language)
        ?? asString(review.language)
        ?? asString(review.original_language),
      paginationId: asString(review.review_pagination_id),
      providerPublishAt: asString(review.publishAt ?? review.review_datetime_utc),
      providerRating: asOptionalNumber(review.review_rating ?? review.rating),
      likesCount: asOptionalNumber(review.likes_count ?? review.likesCount),
      reviewOrigin: asString(review.review_origin ?? review.reviewOrigin) ?? 'google',
      visitedIn: asString(review.visited_in ?? review.visitedIn),
      responseFromOwnerDate: toIsoDate(
        review.owner_answer_timestamp,
        review.owner_answer_datetime_utc,
      ),
      reviewContext: isRecord(review.review_context) ? review.review_context : null,
      reviewDetailedRating: isRecord(review.review_detailed_rating) ? review.review_detailed_rating : null,
      reviewImageUrls: asStringArray(review.review_image_urls ?? review.review_photos),
      reviewerId: asString(review.author_id),
      reviewerUrl: asString(review.author_link),
      reviewerNumberOfReviews: asOptionalNumber(review.author_reviews_count),
      reviewerPhotoUrl: asString(review.author_image),
      isLocalGuide: asBoolean(review.author_is_local_guide),
      providerScrapedAt: asString(review.scraped_at),
      rawPayload: review,
    }
  })

  return {
    establishment: {
      name: asString(place.name) ?? 'Établissement Google',
      fullAddress: asString(place.full_address) ?? asString(place.address) ?? '',
      rating: asNumber(place.rating),
      totalReviews: asNumber(place.reviews),
      placeId: asString(place.place_id),
      googleId,
      locationLink: asString(place.location_link),
      photo: asString(place.photo) ?? asString(place.photo_url),
      rawPlacePayload,
    },
    reviews,
    count: reviews.length,
  }
}

export interface FetchOutscraperOptions {
  query: string
  apiKey: string
  reviewsLimit?: number
  timeoutMs?: number
  fetcher?: typeof fetch
}

export interface FetchOutscraperReviewsOptions extends FetchOutscraperOptions {
  sort?: 'newest' | 'lowest_rating' | 'highest_rating' | 'most_relevant'
  cutoffRating?: number
  cutoff?: number
  lastPaginationId?: string
}

export async function fetchOutscraperReviews({
  query,
  apiKey,
  reviewsLimit = MAX_REVIEWS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetcher = fetch,
  sort = 'newest',
  cutoffRating,
  cutoff,
  lastPaginationId,
}: FetchOutscraperReviewsOptions): Promise<GoogleReviewsResult> {
  const normalizedQuery = query.trim()
  if (normalizedQuery.length < 2 || normalizedQuery.length > 500) {
    throw new OutscraperError('INVALID_INPUT', 400)
  }
  if (!apiKey.trim()) throw new OutscraperError('OUTSCRAPER_KEY_MISSING', 503)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    const resolvedQuery = await resolveGoogleMapsShortUrl(normalizedQuery, fetcher, controller.signal)
    const url = new URL(OUTSCRAPER_REVIEWS_ENDPOINT)
    url.searchParams.set('query', resolvedQuery)
    const safeLimit = reviewsLimit === 0 ? 0 : Math.max(1, Math.min(1_000, Math.floor(reviewsLimit)))
    url.searchParams.set('reviewsLimit', String(safeLimit))
    url.searchParams.set('limit', '1')
    url.searchParams.set('sort', sort)
    url.searchParams.set('source', 'google')
    url.searchParams.set('async', 'false')
    if (cutoffRating !== undefined) {
      url.searchParams.set('cutoffRating', String(Math.max(1, Math.min(5, Math.floor(cutoffRating)))))
    }
    if (cutoff !== undefined) url.searchParams.set('cutoff', String(Math.max(0, Math.floor(cutoff))))
    if (lastPaginationId) url.searchParams.set('lastPaginationId', lastPaginationId)

    response = await fetcher(url, {
      method: 'GET',
      headers: { 'X-API-KEY': apiKey },
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new OutscraperError('OUTSCRAPER_TIMEOUT', 504)
    }
    if (error instanceof OutscraperError) throw error
    throw new OutscraperError('OUTSCRAPER_UNAVAILABLE', 503)
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) throw mapHttpError(response.status)
  const raw = await response.text()
  if (!raw.trim()) throw new OutscraperError('OUTSCRAPER_EMPTY_RESPONSE', 502)

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    throw new OutscraperError('OUTSCRAPER_INVALID_RESPONSE', 502)
  }

  const message = upstreamMessage(payload)
  if (/quota|limit|credit/i.test(message)) throw new OutscraperError('OUTSCRAPER_QUOTA_EXCEEDED', 429)
  if (/billing|invoice|payment|card|balance/i.test(message)) throw new OutscraperError('OUTSCRAPER_BILLING_REQUIRED', 402)
  if (isRecord(payload) && payload.error === true) throw new OutscraperError('OUTSCRAPER_UPSTREAM_ERROR', 502)

  return {
    provider: 'outscraper',
    ...normalizeOutscraperPayload(payload, reviewsLimit === 0 ? null : reviewsLimit),
  }
}

export function fetchOutscraperGoogleReviews(options: FetchOutscraperOptions): Promise<GoogleReviewsResult> {
  return fetchOutscraperReviews({
    ...options,
    reviewsLimit: Math.min(MAX_REVIEWS, Math.max(1, Math.floor(options.reviewsLimit ?? MAX_REVIEWS))),
    sort: 'newest',
  })
}

export function getMockGoogleReviews(query: string): GoogleReviewsResult {
  const name = query.trim() || 'Le Petit Hanoi'
  const googleId = `mock:${name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  const now = Date.now()
  const sourceUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`
  const samples = [
    ['Camille', 2, 'Service trop lent malgré une cuisine appréciée.', null],
    ['Minh', 5, 'Très belle expérience, merci à toute l’équipe !', 'Merci pour votre visite !'],
    ['Sophie', 3, 'Bonne cuisine mais attente un peu longue.', null],
  ] as const
  const reviews = samples.map(([authorName, rating, text, ownerResponse], index): NormalizedReview => ({
    externalReviewId: `${googleId}:${index + 1}`,
    establishmentGoogleId: googleId,
    authorName,
    authorImage: null,
    rating,
    text,
    publishedAt: new Date(now - index * 86_400_000).toISOString(),
    reviewUrl: sourceUrl,
    ownerResponse,
    language: 'fr',
    paginationId: null,
    providerPublishAt: null,
    providerRating: rating,
    likesCount: null,
    reviewOrigin: 'google',
    visitedIn: null,
    responseFromOwnerDate: null,
    reviewContext: null,
    reviewDetailedRating: null,
    reviewImageUrls: [],
    reviewerId: null,
    reviewerUrl: null,
    reviewerNumberOfReviews: null,
    reviewerPhotoUrl: null,
    isLocalGuide: null,
    providerScrapedAt: new Date(now).toISOString(),
    rawPayload: { authorName, rating, text, ownerResponse },
  }))

  return {
    provider: 'mock',
    establishment: {
      name,
      fullAddress: '12 rue de la Paix, Paris',
      rating: 4.2,
      totalReviews: 318,
      placeId: null,
      googleId,
      locationLink: sourceUrl,
      photo: null,
      rawPlacePayload: { name, sourceUrl },
    },
    reviews,
    count: reviews.length,
  }
}
