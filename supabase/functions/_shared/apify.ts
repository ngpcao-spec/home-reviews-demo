import type {
  GoogleReviewsResult,
  NormalizedEstablishment,
  NormalizedReview,
} from './outscraper.ts'

const APIFY_ACTOR = 'compass~google-maps-reviews-scraper'
const APIFY_API = 'https://api.apify.com/v2'

type JsonRecord = Record<string, unknown>
export type SupportedLanguage = 'fr' | 'vi'

export class ApifyError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
  ) {
    super(code)
    this.name = 'ApifyError'
  }
}

export interface ApifyRunState {
  runId: string
  datasetId: string
  status: string
  resolvedPlaceUrl?: string
}

export interface ApifyReviewRequest {
  placeUrl: string
  language: SupportedLanguage
  sort: 'newest' | 'lowest_rating'
  limit?: number
  since?: string
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stringValue = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const numberValue = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const optionalNumberValue = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const stringArrayValue = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(stringValue).filter((item): item is string => Boolean(item)) : []

const scalarText = (value: unknown): string | null => {
  if (typeof value === 'string') return stringValue(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function placeNameFromMapsUrl(value: unknown): string | null {
  const raw = stringValue(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    const match = url.pathname.match(/\/maps\/place\/([^/]+)/i)
    if (!match?.[1]) return null
    return decodeURIComponent(match[1].replace(/\+/g, ' ')).trim() || null
  } catch {
    return null
  }
}

function apiHeaders(token: string, json = false): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }
}

async function apiJson(
  token: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<JsonRecord> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${APIFY_API}${path}`, {
      ...init,
      headers: { ...apiHeaders(token), ...(init.headers ?? {}) },
      signal: controller.signal,
    })
    if (response.status === 401 || response.status === 403) throw new ApifyError('APIFY_AUTH_ERROR', 502)
    if (response.status === 402) throw new ApifyError('APIFY_BILLING_REQUIRED', 402)
    if (response.status === 429) throw new ApifyError('APIFY_RATE_LIMIT', 429)
    if (!response.ok) throw new ApifyError(`APIFY_HTTP_${response.status}`, response.status >= 500 ? 503 : 502)
    const payload = await response.json()
    if (!isRecord(payload)) throw new ApifyError('APIFY_INVALID_RESPONSE', 502)
    return payload
  } catch (error) {
    if (error instanceof ApifyError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') throw new ApifyError('APIFY_TIMEOUT', 504)
    throw new ApifyError('APIFY_UNAVAILABLE', 503)
  } finally {
    clearTimeout(timer)
  }
}

export function apifyActorInput(request: ApifyReviewRequest) {
  return {
    startUrls: [{ url: request.placeUrl }],
    reviewsOrigin: 'google',
    reviewsSort: request.sort === 'lowest_rating' ? 'lowestRanking' : 'newest',
    language: request.language,
    personalData: true,
    ...(request.limit ? { maxReviews: request.limit } : {}),
    ...(request.since ? { reviewsStartDate: request.since } : {}),
  }
}

export async function resolvePlaceUrl(placeUrl: string): Promise<string> {
  try {
    const url = new URL(placeUrl)
    if (url.hostname.toLowerCase() !== 'maps.app.goo.gl') return placeUrl
    const response = await fetch(url, { method: 'GET', redirect: 'follow' })
    if (!response.ok || !response.url.includes('/maps')) throw new ApifyError('GOOGLE_MAPS_LINK_RESOLUTION_FAILED', 400)
    return response.url
  } catch (error) {
    if (error instanceof ApifyError) throw error
    throw new ApifyError('GOOGLE_MAPS_LINK_RESOLUTION_FAILED', 400)
  }
}

function runFromPayload(payload: JsonRecord): ApifyRunState {
  const data = isRecord(payload.data) ? payload.data : payload
  const runId = stringValue(data.id)
  const datasetId = stringValue(data.defaultDatasetId)
  const status = stringValue(data.status)
  if (!runId || !datasetId || !status) throw new ApifyError('APIFY_INVALID_RUN', 502)
  return { runId, datasetId, status }
}

export async function startApifyRun(
  token: string,
  request: ApifyReviewRequest,
): Promise<ApifyRunState> {
  if (!token.trim()) throw new ApifyError('APIFY_TOKEN_MISSING', 503)
  const resolvedUrl = await resolvePlaceUrl(request.placeUrl)
  const configuredChargeLimit = Number(Deno.env.get('APIFY_MAX_RUN_CHARGE_USD') ?? '1')
  const maxTotalChargeUsd = Number.isFinite(configuredChargeLimit)
    ? Math.min(10, Math.max(0.1, configuredChargeLimit))
    : 1
  const payload = await apiJson(token, `/acts/${APIFY_ACTOR}/runs?maxTotalChargeUsd=${maxTotalChargeUsd}`, {
    method: 'POST',
    headers: apiHeaders(token, true),
    body: JSON.stringify(apifyActorInput({ ...request, placeUrl: resolvedUrl })),
  })
  return { ...runFromPayload(payload), resolvedPlaceUrl: resolvedUrl }
}

export async function getApifyRun(token: string, runId: string): Promise<ApifyRunState> {
  const payload = await apiJson(token, `/actor-runs/${encodeURIComponent(runId)}`)
  return runFromPayload(payload)
}

export function apifyRunFinished(status: string): boolean {
  return ['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'].includes(status)
}

export function apifyRunSucceeded(status: string): boolean {
  return status === 'SUCCEEDED'
}

export async function fetchApifyDataset(token: string, datasetId: string): Promise<JsonRecord[]> {
  const items: JsonRecord[] = []
  const pageSize = 1_000
  for (let offset = 0; ; offset += pageSize) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
      const response = await fetch(
        `${APIFY_API}/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&offset=${offset}&limit=${pageSize}`,
        { headers: apiHeaders(token), signal: controller.signal },
      )
      if (response.status === 429) throw new ApifyError('APIFY_RATE_LIMIT', 429)
      if (!response.ok) throw new ApifyError(`APIFY_DATASET_HTTP_${response.status}`, response.status >= 500 ? 503 : 502)
      const payload = await response.json()
      if (!Array.isArray(payload)) throw new ApifyError('APIFY_INVALID_DATASET', 502)
      const page = payload.filter(isRecord)
      items.push(...page)
      if (page.length < pageSize) return items
    } catch (error) {
      if (error instanceof ApifyError) throw error
      if (error instanceof DOMException && error.name === 'AbortError') throw new ApifyError('APIFY_TIMEOUT', 504)
      throw new ApifyError('APIFY_UNAVAILABLE', 503)
    } finally {
      clearTimeout(timer)
    }
  }
}

export function normalizeApifyReview(item: JsonRecord): NormalizedReview | null {
  const externalReviewId = stringValue(item.reviewId)
  const rating = numberValue(item.stars ?? item.rating)
  if (!externalReviewId || rating < 1 || rating > 5) return null
  return {
    externalReviewId,
    establishmentGoogleId: stringValue(item.placeId) ?? stringValue(item.cid) ?? '',
    authorName: stringValue(item.name) ?? 'Client Google',
    authorImage: stringValue(item.reviewerPhotoUrl),
    rating,
    text: stringValue(item.text) ?? '',
    translatedText: stringValue(item.textTranslated),
    translatedLanguage: stringValue(item.translatedLanguage),
    publishedAt: stringValue(item.publishedAtDate),
    reviewUrl: stringValue(item.reviewUrl),
    ownerResponse: stringValue(item.responseFromOwnerText),
    language: stringValue(item.originalLanguage),
    paginationId: null,
    providerPublishAt: scalarText(item.publishAt),
    providerRating: optionalNumberValue(item.rating ?? item.stars),
    likesCount: optionalNumberValue(item.likesCount),
    reviewOrigin: stringValue(item.reviewOrigin) ?? 'google',
    visitedIn: scalarText(item.visitedIn),
    responseFromOwnerDate: stringValue(item.responseFromOwnerDate),
    reviewContext: item.reviewContext ?? null,
    reviewDetailedRating: item.reviewDetailedRating ?? null,
    reviewImageUrls: stringArrayValue(item.reviewImageUrls),
    reviewerId: stringValue(item.reviewerId),
    reviewerUrl: stringValue(item.reviewerUrl),
    reviewerNumberOfReviews: optionalNumberValue(item.reviewerNumberOfReviews),
    reviewerPhotoUrl: stringValue(item.reviewerPhotoUrl),
    isLocalGuide: typeof item.isLocalGuide === 'boolean' ? item.isLocalGuide : null,
    providerScrapedAt: stringValue(item.scrapedAt),
    rawPayload: item,
  }
}

export function normalizeApifyDataset(
  items: JsonRecord[],
  fallbackUrl: string,
  resolvedPlaceUrl?: string,
): GoogleReviewsResult {
  const first = items[0] ?? {}
  const reviews = items.map(normalizeApifyReview).filter((review): review is NormalizedReview => Boolean(review))
  const address = stringValue(first.address)
    ?? [first.street, first.city, first.state, first.countryCode].map(stringValue).filter(Boolean).join(', ')
  const placeId = stringValue(first.placeId)
  const googleId = stringValue(first.cid) ?? placeId ?? stringValue(first.googleId) ?? fallbackUrl
  // Apify localizes `title` according to the requested review language. A
  // canonical Google Maps place URL retains the proper business name in its
  // `/maps/place/<name>/` segment, so prefer it and never localize that name.
  const canonicalName = placeNameFromMapsUrl(resolvedPlaceUrl)
    ?? placeNameFromMapsUrl(first.inputStartUrl)
    ?? placeNameFromMapsUrl(fallbackUrl)
  const imageUrls = stringArrayValue(first.imageUrls)
  const rawPlacePayload: JsonRecord = {
    title: first.title,
    placeId: first.placeId,
    cid: first.cid,
    fid: first.fid,
    categoryName: first.categoryName,
    categories: first.categories,
    totalScore: first.totalScore,
    reviewsCount: first.reviewsCount,
    url: first.url,
    imageUrl: first.imageUrl,
    address: first.address,
    neighborhood: first.neighborhood,
    street: first.street,
    city: first.city,
    postalCode: first.postalCode,
    state: first.state,
    countryCode: first.countryCode,
    location: first.location,
    scrapedAt: first.scrapedAt,
    language: first.language,
    inputStartUrl: first.inputStartUrl,
    reviewOrigin: first.reviewOrigin,
  }
  const establishment: NormalizedEstablishment = {
    name: canonicalName ?? stringValue(first.title) ?? 'Établissement Google',
    fullAddress: address ?? '',
    rating: numberValue(first.totalScore ?? first.rating),
    totalReviews: Math.trunc(numberValue(first.reviewsCount ?? first.reviewsNumber)),
    placeId,
    googleId,
    locationLink: stringValue(first.url) ?? fallbackUrl,
    photo: stringValue(first.imageUrl) ?? imageUrls[0] ?? null,
    rawPlacePayload,
  }
  return { provider: 'apify', establishment, reviews, count: reviews.length }
}

export async function waitForApifyRun(
  token: string,
  run: ApifyRunState,
  timeoutMs = 110_000,
): Promise<ApifyRunState> {
  const deadline = Date.now() + timeoutMs
  let current = run
  while (!apifyRunFinished(current.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    current = await getApifyRun(token, current.runId)
  }
  if (!apifyRunFinished(current.status)) throw new ApifyError('APIFY_TIMEOUT', 504)
  if (!apifyRunSucceeded(current.status)) throw new ApifyError(`APIFY_RUN_${current.status}`, 503)
  return current
}

export async function fetchApifyReviews(
  token: string,
  request: ApifyReviewRequest,
): Promise<GoogleReviewsResult> {
  const run = await startApifyRun(token, request)
  const completed = await waitForApifyRun(token, run)
  const items = await fetchApifyDataset(token, completed.datasetId)
  return normalizeApifyDataset(items, request.placeUrl, run.resolvedPlaceUrl)
}
