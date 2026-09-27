import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'
import {
  fetchOutscraperReviews,
  getMockGoogleReviews,
  type GoogleReviewsResult,
  type NormalizedReview,
} from './outscraper.ts'
import { reviewClassification } from './review-classification.ts'

const INCREMENTAL_WINDOW = 20
const MAX_INCREMENTAL_PAGES = 5

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
  provider: 'outscraper' | 'mock'
  providerRequests: number
  fetched: number
  inserted: number
  stoppedOnKnownReview: boolean
}

function providerName(): 'outscraper' | 'mock' {
  const configured = (Deno.env.get('REVIEW_PROVIDER') ?? 'mock').trim().toLowerCase()
  if (configured === 'mock' || configured === 'outscraper') return configured
  throw new Error('REVIEW_PROVIDER_UNSUPPORTED')
}

function outscraperKey(): string {
  const key = Deno.env.get('OUTSCRAPER_API_KEY')?.trim() ?? ''
  if (!key) throw new Error('OUTSCRAPER_KEY_MISSING')
  return key
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
) {
  return {
    organization_id: establishment.organization_id,
    establishment_id: establishment.id,
    external_review_id: review.externalReviewId,
    author_name: review.authorName,
    author_image: review.authorImage,
    rating: review.rating,
    text: review.text,
    language: review.language,
    published_at: review.publishedAt,
    review_url: review.reviewUrl,
    owner_response: review.ownerResponse,
    historical_import: historicalImport,
    ...reviewClassification(review.rating),
  }
}

export async function insertReviews(
  admin: SupabaseClient,
  establishment: Pick<EstablishmentRow, 'id' | 'organization_id'>,
  reviews: NormalizedReview[],
  historicalImport: boolean,
): Promise<number> {
  if (!reviews.length) return 0
  const validReviews = reviews.filter((review) =>
    review.externalReviewId.length > 0
    && review.rating >= 1
    && review.rating <= 5
  )
  if (!validReviews.length) return 0

  const { data, error } = await admin
    .from('reviews')
    .upsert(
      validReviews.map((review) => reviewRow(establishment, review, historicalImport)),
      {
        onConflict: 'establishment_id,external_review_id',
        ignoreDuplicates: true,
      },
    )
    .select('external_review_id')
  if (error) throw error
  return data?.length ?? 0
}

async function fetchInitialization(query: string): Promise<GoogleReviewsResult> {
  const provider = providerName()
  if (provider === 'mock') {
    const result = getMockGoogleReviews(query)
    const reviews = result.reviews.filter((review) => review.rating <= 3)
    return { ...result, reviews, count: reviews.length }
  }
  return fetchOutscraperReviews({
    query,
    apiKey: outscraperKey(),
    reviewsLimit: 0,
    sort: 'lowest_rating',
    cutoffRating: 3,
    timeoutMs: 90_000,
  })
}

export async function resolveEstablishmentCandidate(query: string) {
  const provider = providerName()
  const result = provider === 'mock'
    ? getMockGoogleReviews(query)
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
) {
  const provider = providerName()
  const result = await fetchInitialization(query)
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

  const negativeReviews = result.reviews
    .filter((review) => review.rating >= 1 && review.rating <= 3)
    .sort((left, right) => {
      const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0
      const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0
      return rightTime - leftTime
    })

  const now = new Date().toISOString()
  const newestReview = negativeReviews[0]
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
    .select('id,organization_id,google_id,google_maps_url,last_review_id,last_review_at')
    .single()
  if (establishmentError) {
    if (establishmentError.code === '23505') throw new Error('ESTABLISHMENT_ALREADY_ADDED')
    throw establishmentError
  }

  const runId = await createRun(admin, establishment, 'initialization', provider)
  try {
    const inserted = await insertReviews(admin, establishment, negativeReviews, true)
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
      provider_requests: 1,
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
      providerRequests: 1,
      fetched: result.reviews.length,
      inserted,
      distribution,
    }
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 120) : 'INITIALIZATION_FAILED'
    await finishRun(admin, runId, {
      status: 'failed',
      provider_requests: 1,
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
      providerRequests: 1,
      fetched: result.reviews.length,
      inserted: 0,
      distribution,
      importStatus: 'failed' as const,
      retryable: true,
      importError: code,
    }
  }
}

async function fetchNewest(
  establishment: EstablishmentRow,
  cursor?: string,
): Promise<GoogleReviewsResult> {
  const provider = providerName()
  if (provider === 'mock') return getMockGoogleReviews(establishment.google_id)

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
      const page = await fetchNewest(establishment, cursor)
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
      inserted += await insertReviews(admin, establishment, newReviews, false)

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
