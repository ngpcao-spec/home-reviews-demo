import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'
import {
  fetchOutscraperReviews,
  getMockGoogleReviews,
  type GoogleReviewsResult,
  type NormalizedReview,
} from './outscraper.ts'
import {
  fetchApifyReviews,
  type SupportedLanguage,
} from './apify.ts'
import { reviewClassification, reviewsForPersistence } from './review-classification.ts'
import {
  HISTORICAL_NEGATIVE_LIMIT,
  historicalRecentWindowDays,
  initialImportCutoffSeconds,
  mergeInitialReviewPasses,
} from './initial-import.ts'

const INCREMENTAL_WINDOW = 20
const MAX_INCREMENTAL_PAGES = 5
const INITIAL_RECENT_PAGE_SIZE = 100
const MAX_INITIAL_RECENT_PAGES = 100

export interface EstablishmentRow {
  id: string
  organization_id: string
  google_id: string
  google_maps_url: string
  last_review_id: string | null
  last_review_at: string | null
}

export interface SyncSummary {
  establishmentId: string
  provider: 'apify' | 'outscraper' | 'mock'
  providerRequests: number
  fetched: number
  inserted: number
  stoppedOnKnownReview: boolean
}

export function providerName(): 'apify' | 'outscraper' | 'mock' {
  const configured = (Deno.env.get('REVIEW_PROVIDER') ?? 'mock').trim().toLowerCase()
  if (configured === 'mock' || configured === 'outscraper' || configured === 'apify') return configured
  throw new Error('REVIEW_PROVIDER_UNSUPPORTED')
}

function outscraperKey(): string {
  const key = Deno.env.get('OUTSCRAPER_API_KEY')?.trim() ?? ''
  if (!key) throw new Error('OUTSCRAPER_KEY_MISSING')
  return key
}

export function apifyToken(): string {
  const token = Deno.env.get('APIFY_API_TOKEN')?.trim() ?? ''
  if (!token) throw new Error('APIFY_TOKEN_MISSING')
  return token
}

export async function preferredLanguageForUser(
  admin: SupabaseClient,
  userId: string,
): Promise<SupportedLanguage> {
  const { data, error } = await admin
    .from('profiles')
    .select('preferred_language')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data?.preferred_language === 'vi' ? 'vi' : 'fr'
}

export async function preferredLanguageForOrganization(
  admin: SupabaseClient,
  organizationId: string,
): Promise<SupportedLanguage> {
  const { data: organization, error: organizationError } = await admin
    .from('organizations')
    .select('created_by')
    .eq('id', organizationId)
    .single()
  if (organizationError) throw organizationError
  return preferredLanguageForUser(admin, organization.created_by as string)
}

async function createRun(
  admin: SupabaseClient,
  establishment: Pick<EstablishmentRow, 'id' | 'organization_id'>,
  syncType: 'initialization' | 'incremental',
  provider: string,
) {
  const { data, error } = await admin
    .from('sync_runs')
    .insert({
      organization_id: establishment.organization_id,
      establishment_id: establishment.id,
      sync_type: syncType,
      provider,
      status: 'running',
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

async function finishRun(
  admin: SupabaseClient,
  runId: string,
  values: {
    status: 'success' | 'failed'
    provider_requests?: number
    reviews_fetched?: number
    reviews_inserted?: number
    error_code?: string
  },
) {
  const { error } = await admin
    .from('sync_runs')
    .update({ ...values, finished_at: new Date().toISOString() })
    .eq('id', runId)
  if (error) throw error
}

function reviewRow(
  establishment: Pick<EstablishmentRow, 'id' | 'organization_id'>,
  review: NormalizedReview,
  historicalImport: boolean,
  provider: GoogleReviewsResult['provider'],
) {
  return {
    organization_id: establishment.organization_id,
    establishment_id: establishment.id,
    external_review_id: review.externalReviewId,
    author_name: review.authorName,
    author_image: review.authorImage,
    rating: review.rating,
    text: review.text,
    original_text: review.text,
    original_language: review.language,
    language: review.language,
    published_at: review.publishedAt,
    review_url: review.reviewUrl,
    owner_response: review.ownerResponse,
    source_provider: provider,
    provider_publish_at: review.providerPublishAt,
    provider_rating: review.providerRating,
    likes_count: review.likesCount,
    review_context: review.reviewContext,
    review_detailed_rating: review.reviewDetailedRating,
    visited_in: review.visitedIn,
    review_image_urls: review.reviewImageUrls ?? [],
    response_from_owner_text: review.ownerResponse,
    response_from_owner_date: review.responseFromOwnerDate,
    reviewer_id: review.reviewerId,
    reviewer_url: review.reviewerUrl,
    reviewer_number_of_reviews: review.reviewerNumberOfReviews,
    reviewer_photo_url: review.reviewerPhotoUrl,
    is_local_guide: review.isLocalGuide,
    review_origin: review.reviewOrigin,
    provider_scraped_at: review.providerScrapedAt,
    historical_import: historicalImport,
    ...reviewClassification(review.rating),
  }
}

export async function insertReviews(
  admin: SupabaseClient,
  establishment: Pick<EstablishmentRow, 'id' | 'organization_id'>,
  reviews: NormalizedReview[],
  historicalImport: boolean,
  provider: GoogleReviewsResult['provider'],
): Promise<number> {
  if (!reviews.length) return 0
  const validReviews = reviewsForPersistence(reviews)
  if (!validReviews.length) return 0

  const externalIds = validReviews.map((review) => review.externalReviewId)
  const { data: existingRows, error: existingRowsError } = await admin
    .from('reviews')
    .select('external_review_id')
    .eq('establishment_id', establishment.id)
    .in('external_review_id', externalIds)
  if (existingRowsError) throw existingRowsError
  const existingIds = new Set(
    (existingRows ?? []).map((row) => row.external_review_id as string),
  )

  const { error } = await admin
    .from('reviews')
    .upsert(
      validReviews.map((review) => reviewRow(establishment, review, historicalImport, provider)),
      {
        onConflict: 'establishment_id,external_review_id',
        ignoreDuplicates: true,
      },
    )
  if (error) throw error

  const { data: persisted, error: persistedError } = await admin
    .from('reviews')
    .select('id,external_review_id')
    .eq('establishment_id', establishment.id)
    .in('external_review_id', externalIds)
  if (persistedError) throw persistedError

  const byExternalId = new Map(
    (persisted ?? []).map((row) => [row.external_review_id as string, row.id as string]),
  )
  const translations = validReviews.flatMap((review) => {
    const reviewId = byExternalId.get(review.externalReviewId)
    const language = review.translatedLanguage
    const translatedText = review.translatedText?.trim()
    if (!reviewId || (language !== 'fr' && language !== 'vi') || !translatedText) return []
    return [{ review_id: reviewId, language, translated_text: translatedText, updated_at: new Date().toISOString() }]
  })
  if (translations.length) {
    const { error: translationError } = await admin
      .from('review_translations')
      .upsert(translations, { onConflict: 'review_id,language' })
    if (translationError) throw translationError
  }


  const observedAt = new Date().toISOString()
  const providerPayloads = validReviews.flatMap((review) => {
    const reviewId = byExternalId.get(review.externalReviewId)
    if (!reviewId) return []
    return [{
      review_id: reviewId,
      provider,
      raw_payload: review.rawPayload ?? {},
      provider_last_seen_at: observedAt,
      updated_at: observedAt,
    }]
  })
  if (providerPayloads.length) {
    const { error: payloadError } = await admin
      .from('review_provider_payloads')
      .upsert(providerPayloads, { onConflict: 'review_id,provider' })
    if (payloadError) throw payloadError
  }
  return validReviews.filter((review) => !existingIds.has(review.externalReviewId)).length
}

export async function persistEstablishmentSnapshot(
  admin: SupabaseClient,
  establishment: Pick<EstablishmentRow, 'id' | 'organization_id'>,
  provider: GoogleReviewsResult['provider'],
  place: GoogleReviewsResult['establishment'],
  sourceRunId: string,
) {
  const capturedAt = new Date().toISOString()
  const { error } = await admin.from('establishment_snapshots').upsert({
    establishment_id: establishment.id,
    organization_id: establishment.organization_id,
    captured_at: capturedAt,
    rating: place.rating,
    total_reviews: place.totalReviews,
    provider,
    source_run_id: sourceRunId,
    raw_place_payload: place.rawPlacePayload ?? {},
  }, { onConflict: 'establishment_id,provider,source_run_id' })
  if (error) throw error
}

interface InitializationFetchResult extends GoogleReviewsResult {
  providerRequests: number
  recentFetched: number
  recentNegative: number
  historicalFetched: number
  finalAfterDeduplication: number
  checkpointReview: NormalizedReview | null
}

function sortNewest(reviews: NormalizedReview[]): NormalizedReview[] {
  return reviews.sort((left, right) => {
    const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0
    const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0
    return rightTime - leftTime
  })
}

async function fetchInitialization(
  query: string,
  language: SupportedLanguage,
): Promise<InitializationFetchResult> {
  const provider = providerName()
  const recentWindowDays = historicalRecentWindowDays(Deno.env.get('HISTORICAL_RECENT_WINDOW_DAYS'))
  const cutoffSeconds = initialImportCutoffSeconds(Date.now(), recentWindowDays)
  const cutoffMilliseconds = cutoffSeconds * 1_000
  if (provider === 'mock') {
    const result = getMockGoogleReviews(query)
    const merged = mergeInitialReviewPasses(result.reviews, result.reviews, cutoffMilliseconds)
    return {
      ...result,
      reviews: merged.reviews,
      count: merged.reviews.length,
      providerRequests: 2,
      recentFetched: merged.recentFetched,
      recentNegative: merged.recentNegative,
      historicalFetched: Math.min(result.reviews.length, HISTORICAL_NEGATIVE_LIMIT),
      finalAfterDeduplication: merged.reviews.length,
      checkpointReview: sortNewest([...result.reviews])[0] ?? null,
    }
  }

  if (provider === 'apify') {
    const cutoffIso = new Date(cutoffMilliseconds).toISOString()
    const [recent, historical] = await Promise.all([
      fetchApifyReviews(apifyToken(), {
        placeUrl: query,
        language,
        sort: 'newest',
        since: cutoffIso,
      }),
      fetchApifyReviews(apifyToken(), {
        placeUrl: query,
        language,
        sort: 'lowest_rating',
        limit: HISTORICAL_NEGATIVE_LIMIT,
      }),
    ])
    const merged = mergeInitialReviewPasses(recent.reviews, historical.reviews, cutoffMilliseconds)
    return {
      provider: 'apify',
      establishment: recent.establishment,
      reviews: merged.reviews,
      count: merged.reviews.length,
      providerRequests: 2,
      recentFetched: merged.recentFetched,
      recentNegative: merged.recentNegative,
      historicalFetched: historical.reviews.length,
      finalAfterDeduplication: merged.reviews.length,
      checkpointReview: sortNewest([...recent.reviews])[0] ?? null,
    }
  }

  const apiKey = outscraperKey()
  const recentReviews: NormalizedReview[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  let recentEstablishment: GoogleReviewsResult['establishment'] | undefined
  let providerRequests = 0
  let recentWindowComplete = false

  for (let pageNumber = 0; pageNumber < MAX_INITIAL_RECENT_PAGES; pageNumber += 1) {
    const page = await fetchOutscraperReviews({
      query,
      apiKey,
      reviewsLimit: INITIAL_RECENT_PAGE_SIZE,
      sort: 'newest',
      cutoff: cutoffSeconds,
      lastPaginationId: cursor,
      timeoutMs: 90_000,
    })
    providerRequests += 1
    recentEstablishment ??= page.establishment

    const inWindow = page.reviews.filter((review) => {
      if (!review.publishedAt) return true
      return Date.parse(review.publishedAt) >= cutoffMilliseconds
    })
    recentReviews.push(...inWindow)

    if (page.reviews.length === 0) {
      recentWindowComplete = true
      break
    }

    const crossedCutoff = page.reviews.some((review) =>
      review.publishedAt !== null
      && Date.parse(review.publishedAt) < cutoffMilliseconds
    )
    if (crossedCutoff) {
      recentWindowComplete = true
      break
    }

    const nextCursor = page.reviews.at(-1)?.paginationId ?? undefined
    if (!nextCursor) {
      recentWindowComplete = true
      break
    }
    if (seenCursors.has(nextCursor)) throw new Error('RECENT_IMPORT_PAGINATION_LOOP')
    seenCursors.add(nextCursor)
    cursor = nextCursor
  }

  if (!recentWindowComplete) throw new Error('RECENT_IMPORT_WINDOW_INCOMPLETE')

  const historical = await fetchOutscraperReviews({
    query,
    apiKey,
    reviewsLimit: HISTORICAL_NEGATIVE_LIMIT,
    sort: 'lowest_rating',
    cutoffRating: 3,
    timeoutMs: 90_000,
  })
  providerRequests += 1

  const merged = mergeInitialReviewPasses(recentReviews, historical.reviews, cutoffMilliseconds)
  const checkpointReview = sortNewest([...recentReviews])[0] ?? null

  return {
    provider: 'outscraper',
    establishment: recentEstablishment ?? historical.establishment,
    reviews: merged.reviews,
    count: merged.reviews.length,
    providerRequests,
    recentFetched: merged.recentFetched,
    recentNegative: merged.recentNegative,
    historicalFetched: historical.reviews.length,
    finalAfterDeduplication: merged.reviews.length,
    checkpointReview,
  }
}

export async function resolveEstablishmentCandidate(
  query: string,
  language: SupportedLanguage,
) {
  const provider = providerName()
  const result = provider === 'mock'
    ? getMockGoogleReviews(query)
    : provider === 'apify'
      ? await fetchApifyReviews(apifyToken(), {
        placeUrl: query,
        language,
        sort: 'newest',
        limit: 1,
      })
      : await fetchOutscraperReviews({
      query,
      apiKey: outscraperKey(),
      reviewsLimit: 1,
      sort: 'newest',
      timeoutMs: 30_000,
    })

  return { provider, establishment: result.establishment }
}

export async function initializeEstablishment(
  admin: SupabaseClient,
  organizationId: string,
  query: string,
  expectedGoogleId?: string,
  language: SupportedLanguage = 'fr',
) {
  const provider = providerName()
  const result = await fetchInitialization(query, language)
  if (expectedGoogleId && result.establishment.googleId !== expectedGoogleId) {
    throw new Error('ESTABLISHMENT_MISMATCH')
  }

  const { data: existing, error: existingError } = await admin
    .from('establishments')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('google_id', result.establishment.googleId)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing) throw new Error('ESTABLISHMENT_ALREADY_ADDED')

  const importedReviews = sortNewest([...result.reviews])
  const negativeReviews = importedReviews.filter((review) => review.rating <= 3)

  const now = new Date().toISOString()
  // The Google stream checkpoint always follows the newest review, regardless
  // of rating. PASS A now persists every 1-5 star review in the recent window.
  const newestReview = result.checkpointReview
  const { data: establishment, error: establishmentError } = await admin
    .from('establishments')
    .insert({
      organization_id: organizationId,
      name: result.establishment.name,
      google_id: result.establishment.googleId,
      place_id: result.establishment.placeId,
      google_maps_url: result.establishment.locationLink ?? query,
      address: result.establishment.fullAddress,
      rating: result.establishment.rating,
      total_reviews: result.establishment.totalReviews,
      photo_url: result.establishment.photo,
      active: true,
      initialized_at: now,
      last_sync_at: now,
      last_review_id: newestReview?.externalReviewId ?? null,
      last_review_at: newestReview?.publishedAt ?? null,
      sync_status: 'syncing',
      sync_error: null,
    })
    .select('id,organization_id,google_id,google_maps_url,last_review_id,last_review_at,next_sync_at')
    .single()
  if (establishmentError) {
    if (establishmentError.code === '23505') throw new Error('ESTABLISHMENT_ALREADY_ADDED')
    throw establishmentError
  }

  const runId = await createRun(admin, establishment, 'initialization', provider)
  try {
    const inserted = await insertReviews(admin, establishment, importedReviews, true, result.provider)
    await persistEstablishmentSnapshot(
      admin,
      establishment,
      result.provider,
      result.establishment,
      `initial:${runId}`,
    )
    const { error: updateError } = await admin
      .from('establishments')
      .update({
        sync_status: 'ok',
        sync_error: null,
        last_sync_status: 'ok',
        last_sync_error: null,
        last_sync_at: now,
      })
      .eq('id', establishment.id)
    if (updateError) throw updateError

    await finishRun(admin, runId, {
      status: 'success',
      provider_requests: result.providerRequests,
      reviews_fetched: result.reviews.length,
      reviews_inserted: inserted,
    })

    const distribution = negativeReviews.reduce<Record<'1' | '2' | '3', number>>(
      (counts, review) => {
        if (review.rating === 1 || review.rating === 2 || review.rating === 3) {
          counts[String(review.rating) as '1' | '2' | '3'] += 1
        }
        return counts
      },
      { '1': 0, '2': 0, '3': 0 },
    )

    return {
      establishmentId: establishment.id as string,
      establishment: result.establishment,
      provider,
      providerRequests: result.providerRequests,
      fetched: result.reviews.length,
      inserted,
      distribution,
      nextSyncAt: establishment.next_sync_at as string,
      recentFetched: result.recentFetched,
      recentNegative: result.recentNegative,
      historicalFetched: result.historicalFetched,
      finalAfterDeduplication: result.finalAfterDeduplication,
    }
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 120) : 'INITIALIZATION_FAILED'
    await finishRun(admin, runId, {
      status: 'failed',
      provider_requests: result.providerRequests,
      reviews_fetched: result.reviews.length,
      reviews_inserted: 0,
      error_code: code,
    })
    await admin
      .from('establishments')
      .update({
        sync_status: 'error',
        sync_error: code,
        last_sync_status: 'error',
        last_sync_error: code,
        last_review_id: null,
        last_review_at: null,
      })
      .eq('id', establishment.id)

    const distribution = negativeReviews.reduce<Record<'1' | '2' | '3', number>>(
      (counts, review) => {
        if (review.rating === 1 || review.rating === 2 || review.rating === 3) {
          counts[String(review.rating) as '1' | '2' | '3'] += 1
        }
        return counts
      },
      { '1': 0, '2': 0, '3': 0 },
    )

    return {
      establishmentId: establishment.id as string,
      establishment: result.establishment,
      provider,
      providerRequests: result.providerRequests,
      fetched: result.reviews.length,
      inserted: 0,
      distribution,
      nextSyncAt: establishment.next_sync_at as string,
      importStatus: 'failed' as const,
      retryable: true,
      importError: code,
      recentFetched: result.recentFetched,
      recentNegative: result.recentNegative,
      historicalFetched: result.historicalFetched,
      finalAfterDeduplication: result.finalAfterDeduplication,
    }
  }
}

export async function backfillHistoricalReviews(
  admin: SupabaseClient,
  establishment: EstablishmentRow,
  language: SupportedLanguage = 'fr',
) {
  const result = await fetchInitialization(establishment.google_maps_url || establishment.google_id, language)
  if (result.establishment.googleId !== establishment.google_id) {
    throw new Error('ESTABLISHMENT_MISMATCH')
  }

  const inserted = await insertReviews(admin, establishment, result.reviews, true, result.provider)
  await persistEstablishmentSnapshot(
    admin,
    establishment,
    result.provider,
    result.establishment,
    `backfill:${crypto.randomUUID()}`,
  )
  const newestReview = result.checkpointReview
  const currentNewestAt = establishment.last_review_at ? Date.parse(establishment.last_review_at) : 0
  const importedNewestAt = newestReview?.publishedAt ? Date.parse(newestReview.publishedAt) : 0

  if (newestReview && importedNewestAt > currentNewestAt) {
    const { error } = await admin
      .from('establishments')
      .update({
        last_review_id: newestReview.externalReviewId,
        last_review_at: newestReview.publishedAt,
      })
      .eq('id', establishment.id)
    if (error) throw error
  }

  return {
    establishmentId: establishment.id,
    provider: result.provider,
    providerRequests: result.providerRequests,
    recentFetched: result.recentFetched,
    recentNegative: result.recentNegative,
    historicalFetched: result.historicalFetched,
    finalAfterDeduplication: result.finalAfterDeduplication,
    inserted,
  }
}

export async function fetchIncrementalPage(
  establishment: EstablishmentRow,
  cursor?: string,
  _language: SupportedLanguage = 'fr',
): Promise<GoogleReviewsResult> {
  const provider = providerName()
  if (provider === 'mock') return getMockGoogleReviews(establishment.google_id)
  if (provider === 'apify') throw new Error('APIFY_ASYNC_WORKER_REQUIRED')

  const cutoff = establishment.last_review_at
    ? Math.max(0, Math.floor(Date.parse(establishment.last_review_at) / 1_000) - 5)
    : undefined

  return fetchOutscraperReviews({
    query: establishment.google_id,
    apiKey: outscraperKey(),
    reviewsLimit: INCREMENTAL_WINDOW,
    sort: 'newest',
    cutoff,
    lastPaginationId: cursor,
    timeoutMs: 45_000,
  })
}

export async function syncEstablishment(
  admin: SupabaseClient,
  establishment: EstablishmentRow,
): Promise<SyncSummary> {
  const provider = providerName()
  const runId = await createRun(admin, establishment, 'incremental', provider)
  let providerRequests = 0
  let fetched = 0
  let inserted = 0
  let stoppedOnKnownReview = false
  let cursor: string | undefined
  let newestReview: NormalizedReview | undefined

  try {
    for (let pageNumber = 0; pageNumber < MAX_INCREMENTAL_PAGES; pageNumber += 1) {
      const page = await fetchIncrementalPage(establishment, cursor)
      providerRequests += 1
      fetched += page.reviews.length
      if (!newestReview) newestReview = page.reviews[0]
      if (!page.reviews.length) break

      const externalIds = page.reviews.map((review) => review.externalReviewId)
      const { data: knownRows, error: knownError } = await admin
        .from('reviews')
        .select('external_review_id')
        .eq('establishment_id', establishment.id)
        .in('external_review_id', externalIds)
      if (knownError) throw knownError
      const knownIds = new Set((knownRows ?? []).map((row) => row.external_review_id as string))
      const newReviews = page.reviews.filter((review) => !knownIds.has(review.externalReviewId))
      inserted += await insertReviews(admin, establishment, newReviews, false, page.provider)
      if (pageNumber === 0) {
        await persistEstablishmentSnapshot(admin, establishment, page.provider, page.establishment, `sync:${runId}`)
      }

      if (knownIds.size > 0) {
        stoppedOnKnownReview = true
        break
      }

      if (!establishment.last_review_at) break
      cursor = page.reviews.at(-1)?.paginationId ?? undefined
      if (!cursor) break
    }

    const update: Record<string, unknown> = {
      last_sync_at: new Date().toISOString(),
      sync_status: 'ok',
      sync_error: null,
    }
    if (newestReview) {
      update.last_review_id = newestReview.externalReviewId
      update.last_review_at = newestReview.publishedAt
    }

    const { error: updateError } = await admin
      .from('establishments')
      .update(update)
      .eq('id', establishment.id)
    if (updateError) throw updateError

    await finishRun(admin, runId, {
      status: 'success',
      provider_requests: providerRequests,
      reviews_fetched: fetched,
      reviews_inserted: inserted,
    })

    return {
      establishmentId: establishment.id,
      provider,
      providerRequests,
      fetched,
      inserted,
      stoppedOnKnownReview,
    }
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 120) : 'SYNC_FAILED'
    await admin.from('establishments').update({ sync_status: 'error', sync_error: code }).eq('id', establishment.id)
    await finishRun(admin, runId, {
      status: 'failed',
      provider_requests: providerRequests,
      reviews_fetched: fetched,
      reviews_inserted: inserted,
      error_code: code,
    })
    throw error
  }
}
