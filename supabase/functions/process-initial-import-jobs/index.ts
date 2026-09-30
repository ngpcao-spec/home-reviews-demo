import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'
import { json } from '../_shared/cors.ts'
import {
  ApifyError,
  apifyRunFinished,
  apifyRunSucceeded,
  fetchApifyDataset,
  getApifyRun,
  normalizeApifyDataset,
  startApifyRun,
  type SupportedLanguage,
} from '../_shared/apify.ts'
import { initialHistoryComplete, prepareInitialReviews } from '../_shared/initial-import.ts'
import {
  apifyToken,
  fetchInitialization,
  insertReviews,
  persistEstablishmentSnapshot,
  providerName,
  type InitializationFetchResult,
} from '../_shared/sync-service.ts'
import { configuredInteger, mapWithConcurrency, retryPolicy } from '../_shared/sync-queue.ts'

interface InitialImportJob {
  id: string
  organization_id: string
  user_id: string
  query: string
  expected_google_id: string
  establishment_id: string | null
  preferred_language: SupportedLanguage
  status: string
  reviews_target: number
  attempts: number
  provider_run_id: string | null
  provider_dataset_id: string | null
}

const workerId = () => `initial-import:${crypto.randomUUID()}`
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

async function requireSuccess<T>(
  promise: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await promise
  if (error) throw new Error(error.message)
  return data
}

async function continueJob(admin: SupabaseClient, jobId: string, worker: string, delaySeconds = 5) {
  const continued = await requireSuccess<boolean>(admin.rpc('continue_initial_import_job', {
    p_job_id: jobId,
    p_worker_id: worker,
    p_delay_seconds: delaySeconds,
  }))
  if (continued !== true) throw new Error('INITIAL_IMPORT_LEASE_LOST')
}

async function checkpoint(
  admin: SupabaseClient,
  job: InitialImportJob,
  worker: string,
  values: {
    providerRunId?: string
    providerDatasetId?: string
    establishmentId?: string
    reviewsFetched?: number
    reviewsInserted?: number
    providerRequests?: number
  },
  leaseSeconds: number,
) {
  const saved = await requireSuccess<boolean>(admin.rpc('checkpoint_initial_import_job', {
    p_job_id: job.id,
    p_worker_id: worker,
    p_provider_run_id: values.providerRunId ?? null,
    p_provider_dataset_id: values.providerDatasetId ?? null,
    p_establishment_id: values.establishmentId ?? null,
    p_reviews_fetched: values.reviewsFetched ?? null,
    p_reviews_inserted: values.reviewsInserted ?? null,
    p_provider_requests: values.providerRequests ?? 0,
    p_lease_seconds: leaseSeconds,
  }))
  if (saved !== true) throw new Error('INITIAL_IMPORT_LEASE_LOST')
}

async function acquireProviderSlot(
  admin: SupabaseClient,
  token: string,
  leaseSeconds: number,
  waitMs: number,
) {
  const deadline = performance.now() + waitMs
  let slot: number | null = null
  do {
    slot = await requireSuccess<number | null>(admin.rpc('claim_review_provider_slot', {
      p_worker_token: token,
      p_lease_seconds: leaseSeconds,
    }))
    if (slot === null) await wait(100)
  } while (slot === null && performance.now() < deadline)
  return slot
}

async function createOrResumeEstablishment(
  admin: SupabaseClient,
  job: InitialImportJob,
  result: InitializationFetchResult,
) {
  const { data: existing, error: existingError } = await admin
    .from('establishments')
    .select('id,initial_import_job_id')
    .eq('organization_id', job.organization_id)
    .eq('google_id', result.establishment.googleId)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing) {
    if (existing.initial_import_job_id !== job.id && existing.id !== job.establishment_id) {
      throw new Error('ESTABLISHMENT_ALREADY_ADDED')
    }
    const { error } = await admin.from('establishments').update({
      name: result.establishment.name,
      place_id: result.establishment.placeId,
      google_maps_url: result.establishment.locationLink ?? job.query,
      address: result.establishment.fullAddress,
      rating: result.establishment.rating,
      total_reviews: result.establishment.totalReviews,
      photo_url: result.establishment.photo,
      active: false,
      sync_status: 'syncing',
      sync_error: null,
      updated_at: new Date().toISOString(),
    }).eq('id', existing.id)
    if (error) throw error
    return existing.id as string
  }

  const { data: created, error: createError } = await admin.from('establishments').insert({
    organization_id: job.organization_id,
    name: result.establishment.name,
    google_id: result.establishment.googleId,
    place_id: result.establishment.placeId,
    google_maps_url: result.establishment.locationLink ?? job.query,
    address: result.establishment.fullAddress,
    rating: result.establishment.rating,
    total_reviews: result.establishment.totalReviews,
    photo_url: result.establishment.photo,
    active: false,
    sync_status: 'syncing',
    sync_error: null,
    last_sync_status: 'pending',
    last_sync_error: null,
    initial_import_job_id: job.id,
  }).select('id').single()
  if (createError) {
    if (createError.code === '23505') throw new Error('ESTABLISHMENT_ALREADY_ADDED')
    throw createError
  }
  return created.id as string
}

function newestFirst<T extends { publishedAt: string | null }>(values: T[]) {
  return [...values].sort((left, right) =>
    (right.publishedAt ? Date.parse(right.publishedAt) : 0)
    - (left.publishedAt ? Date.parse(left.publishedAt) : 0))
}

async function persistResult(
  admin: SupabaseClient,
  job: InitialImportJob,
  worker: string,
  fetched: InitializationFetchResult,
  leaseSeconds: number,
) {
  if (fetched.establishment.googleId !== job.expected_google_id) {
    throw new Error('ESTABLISHMENT_MISMATCH')
  }
  const importedReviews = newestFirst(prepareInitialReviews(fetched.reviews, job.reviews_target))
  const newest = importedReviews[0] ?? null
  const oldest = importedReviews.at(-1) ?? null
  const establishmentId = await createOrResumeEstablishment(admin, job, fetched)
  await checkpoint(admin, job, worker, {
    establishmentId,
    reviewsFetched: importedReviews.length,
  }, leaseSeconds)

  await insertReviews(admin, {
    id: establishmentId,
    organization_id: job.organization_id,
  }, importedReviews, true, fetched.provider)
  await persistEstablishmentSnapshot(admin, {
    id: establishmentId,
    organization_id: job.organization_id,
  }, fetched.provider, fetched.establishment, `initial-job:${job.id}:${job.provider_run_id ?? 'direct'}`)

  const { count, error: countError } = await admin.from('reviews')
    .select('id', { count: 'exact', head: true })
    .eq('establishment_id', establishmentId)
  if (countError) throw countError
  const persistedCount = count ?? 0
  await checkpoint(admin, job, worker, {
    establishmentId,
    reviewsFetched: importedReviews.length,
    reviewsInserted: persistedCount,
  }, leaseSeconds)

  const ratingDistribution = importedReviews.reduce<Record<string, number>>((counts, review) => {
    counts[String(review.rating)] = (counts[String(review.rating)] ?? 0) + 1
    return counts
  }, { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 })
  const negativeReviewCount = ratingDistribution['1'] + ratingDistribution['2'] + ratingDistribution['3']
  const historyComplete = initialHistoryComplete(
    fetched.establishment.totalReviews,
    importedReviews.length,
    job.reviews_target,
  )
  const completedAt = new Date().toISOString()
  const finalized = await requireSuccess<boolean>(admin.rpc('finalize_initial_import_job', {
    p_job_id: job.id,
    p_worker_id: worker,
    p_establishment_id: establishmentId,
    p_last_review_id: newest?.externalReviewId ?? null,
    p_last_review_at: newest?.publishedAt ?? null,
    p_reporting_started_at: historyComplete ? oldest?.publishedAt ?? completedAt : completedAt,
    p_result: {
      establishmentId,
      inserted: persistedCount,
      negativeReviewCount,
      distribution: ratingDistribution,
      importStatus: 'completed',
      reviewsTarget: job.reviews_target,
    },
  }))
  if (finalized !== true) throw new Error('INITIAL_IMPORT_LEASE_LOST')
  return { jobId: job.id, status: 'completed', establishmentId, reviews: persistedCount }
}

async function processApify(
  admin: SupabaseClient,
  job: InitialImportJob,
  worker: string,
  config: {
    leaseSeconds: number
    providerLeaseSeconds: number
    providerCooldownMs: number
    providerSlotWaitMs: number
  },
) {
  const token = apifyToken()
  if (!job.provider_run_id || !job.provider_dataset_id) {
    const providerToken = `${worker}:${job.id}:start`
    const slot = await acquireProviderSlot(
      admin,
      providerToken,
      config.providerLeaseSeconds,
      config.providerSlotWaitMs,
    )
    if (slot === null) {
      await continueJob(admin, job.id, worker, 5)
      return { jobId: job.id, status: 'deferred' }
    }
    try {
      const run = await startApifyRun(token, {
        placeUrl: job.query,
        language: job.preferred_language,
        sort: 'newest',
        limit: job.reviews_target,
      })
      await checkpoint(admin, job, worker, {
        providerRunId: run.runId,
        providerDatasetId: run.datasetId,
        providerRequests: 1,
      }, config.leaseSeconds)
    } finally {
      await admin.rpc('release_review_provider_slot', {
        p_slot_number: slot,
        p_worker_token: providerToken,
        p_cooldown_ms: config.providerCooldownMs,
      })
    }
    await continueJob(admin, job.id, worker, 5)
    return { jobId: job.id, status: 'provider_started' }
  }

  const run = await getApifyRun(token, job.provider_run_id)
  if (!apifyRunFinished(run.status)) {
    await continueJob(admin, job.id, worker, 5)
    return { jobId: job.id, status: 'provider_running' }
  }
  if (!apifyRunSucceeded(run.status)) throw new ApifyError(`APIFY_RUN_${run.status}`, 503)

  const items = await fetchApifyDataset(token, job.provider_dataset_id)
  const normalized = normalizeApifyDataset(items, job.query)
  const reviews = prepareInitialReviews(normalized.reviews, job.reviews_target)
  await checkpoint(admin, job, worker, {
    reviewsFetched: reviews.length,
    providerRequests: 2,
  }, config.leaseSeconds)
  return persistResult(admin, job, worker, {
    ...normalized,
    reviews,
    count: reviews.length,
    providerRequests: 3,
    initialLimit: job.reviews_target,
    initialFetched: reviews.length,
    checkpointReview: reviews[0] ?? null,
  }, config.leaseSeconds)
}

async function processDirect(
  admin: SupabaseClient,
  job: InitialImportJob,
  worker: string,
  config: {
    leaseSeconds: number
    providerLeaseSeconds: number
    providerCooldownMs: number
    providerSlotWaitMs: number
  },
) {
  const providerToken = `${worker}:${job.id}:direct`
  const slot = await acquireProviderSlot(
    admin,
    providerToken,
    config.providerLeaseSeconds,
    config.providerSlotWaitMs,
  )
  if (slot === null) {
    await continueJob(admin, job.id, worker, 5)
    return { jobId: job.id, status: 'deferred' }
  }
  try {
    const result = await fetchInitialization(job.query, job.preferred_language)
    await checkpoint(admin, job, worker, {
      reviewsFetched: result.reviews.length,
      providerRequests: result.providerRequests,
    }, config.leaseSeconds)
    return await persistResult(admin, job, worker, result, config.leaseSeconds)
  } finally {
    await admin.rpc('release_review_provider_slot', {
      p_slot_number: slot,
      p_worker_token: providerToken,
      p_cooldown_ms: config.providerCooldownMs,
    })
  }
}

async function processJob(
  admin: SupabaseClient,
  job: InitialImportJob,
  worker: string,
  config: {
    leaseSeconds: number
    maxAttempts: number
    backoffSeconds: number
    providerLeaseSeconds: number
    providerCooldownMs: number
    providerSlotWaitMs: number
  },
) {
  try {
    return providerName() === 'apify'
      ? await processApify(admin, job, worker, config)
      : await processDirect(admin, job, worker, config)
  } catch (error) {
    const policy = retryPolicy(error, job.attempts, config.backoffSeconds)
    const resetProvider = policy.code.startsWith('APIFY_RUN_')
    const status = await requireSuccess<string>(admin.rpc('fail_initial_import_job', {
      p_job_id: job.id,
      p_worker_id: worker,
      p_error_code: policy.code,
      p_retryable: policy.retryable,
      p_max_attempts: config.maxAttempts,
      p_backoff_seconds: policy.backoffSeconds,
      p_reset_provider: resetProvider,
    }))
    return { jobId: job.id, status, error: policy.code }
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )
  const { data: authorized, error: authError } = await admin.rpc(
    'verify_review_scheduler_token',
    { p_token: request.headers.get('x-home-reviews-scheduler') ?? '' },
  )
  if (authError || authorized !== true) return json({ error: 'UNAUTHORIZED' }, 401)

  const { data: runtime, error: runtimeError } = await admin
    .from('review_sync_runtime_config')
    .select('*')
    .eq('singleton', true)
    .single()
  if (runtimeError) return json({ error: 'RUNTIME_CONFIG_UNAVAILABLE' }, 500)
  const config = {
    claimBatch: configuredInteger(Deno.env.get('INITIAL_IMPORT_CLAIM_BATCH'), 5, 1, 25),
    concurrency: configuredInteger(
      Deno.env.get('INITIAL_IMPORT_WORKER_CONCURRENCY'),
      Math.min(2, runtime.provider_slot_count),
      1,
      Math.min(8, runtime.provider_slot_count),
    ),
    leaseSeconds: configuredInteger(String(runtime.lease_seconds), 240, 30, 900),
    maxAttempts: configuredInteger(String(runtime.max_attempts), 5, 1, 20),
    backoffSeconds: configuredInteger(String(runtime.retry_base_seconds), 60, 1, 3600),
    providerLeaseSeconds: configuredInteger(String(runtime.provider_lease_seconds), 60, 10, 180),
    providerCooldownMs: configuredInteger(String(runtime.provider_cooldown_ms), 200, 0, 10_000),
    providerSlotWaitMs: 2_000,
  }
  const worker = workerId()
  const jobs = await requireSuccess<InitialImportJob[]>(admin.rpc('claim_initial_import_jobs', {
    p_worker_id: worker,
    p_limit: config.claimBatch,
    p_lease_seconds: config.leaseSeconds,
  }))
  const results = await mapWithConcurrency(jobs ?? [], config.concurrency, (job) =>
    processJob(admin, job, worker, config))
  return json({ claimed: jobs?.length ?? 0, results })
})
