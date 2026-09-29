import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'
import { json } from '../_shared/cors.ts'
import {
  apifyToken,
  insertReviews,
  fetchIncrementalPage,
  persistEstablishmentSnapshot,
  preferredLanguageForOrganization,
  providerName,
} from '../_shared/sync-service.ts'
import {
  ApifyError,
  apifyRunFinished,
  apifyRunSucceeded,
  fetchApifyDataset,
  getApifyRun,
  normalizeApifyDataset,
  startApifyRun,
} from '../_shared/apify.ts'
import {
  configuredInteger,
  mapWithConcurrency,
  pageBeforeCheckpoint,
  retryPolicy,
} from '../_shared/sync-queue.ts'

interface SyncJob {
  id: string
  establishment_id: string
  organization_id: string
  attempts: number
  pagination_cursor: string | null
  checkpoint_review_id: string | null
  checkpoint_review_at: string | null
  head_review_id: string | null
  head_review_at: string | null
  google_id: string
  google_maps_url: string
}

const workerId = () => `worker:${crypto.randomUUID()}`
const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

async function requireSuccess<T>(
  promise: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await promise
  if (error) throw new Error(error.message)
  return data
}

interface ApifyCursor {
  provider: 'apify'
  runId: string
  datasetId: string
  language: 'fr' | 'vi'
}

function parseApifyCursor(value: string | null): ApifyCursor | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<ApifyCursor>
    if (parsed.provider !== 'apify' || !parsed.runId || !parsed.datasetId) return null
    return {
      provider: 'apify',
      runId: parsed.runId,
      datasetId: parsed.datasetId,
      language: parsed.language === 'vi' ? 'vi' : 'fr',
    }
  } catch {
    return null
  }
}

async function continueJob(admin: SupabaseClient, jobId: string, worker: string, delaySeconds: number) {
  const continued = await requireSuccess<boolean>(admin.rpc('continue_review_sync_job', {
    p_job_id: jobId,
    p_worker_id: worker,
    p_delay_seconds: delaySeconds,
  }))
  if (continued !== true) throw new Error('SYNC_LEASE_LOST')
}

async function processApifyJob(
  admin: SupabaseClient,
  job: SyncJob,
  worker: string,
  config: {
    leaseSeconds: number
    providerLeaseSeconds: number
    providerCooldownMs: number
    providerSlotWaitMs: number
  },
) {
  const token = apifyToken()
  let cursor = parseApifyCursor(job.pagination_cursor)
  if (!cursor) {
    const providerToken = `${worker}:${job.id}:apify-start`
    const slotDeadline = performance.now() + config.providerSlotWaitMs
    let slot: number | null = null
    do {
      slot = await requireSuccess<number | null>(admin.rpc('claim_review_provider_slot', {
        p_worker_token: providerToken,
        p_lease_seconds: config.providerLeaseSeconds,
      }))
      if (slot === null) await wait(100)
    } while (slot === null && performance.now() < slotDeadline)
    if (slot === null) {
      await continueJob(admin, job.id, worker, 5)
      return { jobId: job.id, status: 'deferred', providerRequests: 0 }
    }

    try {
      const language = await preferredLanguageForOrganization(admin, job.organization_id)
      const since = job.checkpoint_review_at
        ? new Date(Date.parse(job.checkpoint_review_at) - 5_000).toISOString()
        : new Date(Date.now() - 30 * 86_400_000).toISOString()
      const run = await startApifyRun(token, {
        placeUrl: job.google_maps_url,
        language,
        sort: 'newest',
        since,
      })
      cursor = { provider: 'apify', runId: run.runId, datasetId: run.datasetId, language }
      const saved = await requireSuccess(admin.rpc('checkpoint_review_sync_job', {
        p_job_id: job.id,
        p_worker_id: worker,
        p_pagination_cursor: JSON.stringify(cursor),
        p_head_review_id: job.head_review_id,
        p_head_review_at: job.head_review_at,
        p_provider_requests: 1,
        p_reviews_fetched: 0,
        p_reviews_inserted: 0,
        p_lease_seconds: config.leaseSeconds,
      }))
      if (saved !== true) throw new Error('SYNC_LEASE_LOST')
    } finally {
      await admin.rpc('release_review_provider_slot', {
        p_slot_number: slot,
        p_worker_token: providerToken,
        p_cooldown_ms: config.providerCooldownMs,
      })
    }
    await continueJob(admin, job.id, worker, 5)
    return { jobId: job.id, status: 'provider_started', providerRequests: 1 }
  }

  const run = await getApifyRun(token, cursor.runId)
  if (!apifyRunFinished(run.status)) {
    await continueJob(admin, job.id, worker, 5)
    return { jobId: job.id, status: 'provider_running', providerRequests: 0 }
  }
  if (!apifyRunSucceeded(run.status)) {
    await admin.rpc('checkpoint_review_sync_job', {
      p_job_id: job.id,
      p_worker_id: worker,
      p_pagination_cursor: null,
      p_head_review_id: job.head_review_id,
      p_head_review_at: job.head_review_at,
      p_provider_requests: 0,
      p_reviews_fetched: 0,
      p_reviews_inserted: 0,
      p_lease_seconds: config.leaseSeconds,
    })
    throw new ApifyError(`APIFY_RUN_${run.status}`, 503)
  }

  const items = await fetchApifyDataset(token, cursor.datasetId)
  const page = normalizeApifyDataset(items, job.google_maps_url)
  const first = page.reviews[0]
  const headReviewId = job.head_review_id ?? first?.externalReviewId ?? null
  const headReviewAt = job.head_review_at ?? first?.publishedAt ?? null
  const checkpoint = pageBeforeCheckpoint(page.reviews, job.checkpoint_review_id)
  const inserted = await insertReviews(admin, {
    id: job.establishment_id,
    organization_id: job.organization_id,
  }, checkpoint.reviews, false, page.provider)
  await persistEstablishmentSnapshot(admin, {
    id: job.establishment_id,
    organization_id: job.organization_id,
  }, page.provider, page.establishment, `sync:${job.id}:${cursor.runId}`)
  const saved = await requireSuccess(admin.rpc('checkpoint_review_sync_job', {
    p_job_id: job.id,
    p_worker_id: worker,
    p_pagination_cursor: null,
    p_head_review_id: headReviewId,
    p_head_review_at: headReviewAt,
    p_provider_requests: 0,
    p_reviews_fetched: page.reviews.length,
    p_reviews_inserted: inserted,
    p_lease_seconds: config.leaseSeconds,
  }))
  if (saved !== true) throw new Error('SYNC_LEASE_LOST')
  const completed = await requireSuccess(admin.rpc('complete_review_sync_job', {
    p_job_id: job.id,
    p_worker_id: worker,
    p_synced_at: new Date().toISOString(),
  }))
  if (completed !== true) throw new Error('SYNC_LEASE_LOST')
  return { jobId: job.id, status: 'completed', providerRequests: 0 }
}

async function processJob(
  admin: SupabaseClient,
  job: SyncJob,
  worker: string,
  config: {
    leaseSeconds: number
    maxPages: number
    maxAttempts: number
    backoffSeconds: number
    providerLeaseSeconds: number
    providerCooldownMs: number
    providerSlotWaitMs: number
  },
) {
  if (providerName() === 'apify') {
    try {
      return await processApifyJob(admin, job, worker, config)
    } catch (error) {
      const policy = retryPolicy(error, job.attempts, config.backoffSeconds)
      const status = await requireSuccess(admin.rpc('fail_review_sync_job', {
        p_job_id: job.id,
        p_worker_id: worker,
        p_error_code: policy.code,
        p_retryable: policy.retryable,
        p_max_attempts: config.maxAttempts,
        p_backoff_seconds: policy.backoffSeconds,
      }))
      return { jobId: job.id, status, error: policy.code }
    }
  }
  let cursor = job.pagination_cursor ?? undefined
  let headReviewId = job.head_review_id
  let headReviewAt = job.head_review_at
  let providerAttempted = false
  try {
    for (let pageNumber = 0; pageNumber < config.maxPages; pageNumber += 1) {
      const alive = await requireSuccess(admin.rpc('heartbeat_review_sync_job', {
        p_job_id: job.id,
        p_worker_id: worker,
        p_lease_seconds: config.leaseSeconds,
      }))
      if (alive !== true) throw new Error('SYNC_LEASE_LOST')

      const providerToken = `${worker}:${job.id}:${pageNumber}`
      const slotDeadline = performance.now() + config.providerSlotWaitMs
      let slot: number | null = null
      do {
        slot = await requireSuccess<number | null>(
          admin.rpc('claim_review_provider_slot', {
            p_worker_token: providerToken,
            p_lease_seconds: config.providerLeaseSeconds,
          }),
        )
        if (slot === null) await wait(100)
      } while (slot === null && performance.now() < slotDeadline)
      if (slot === null) {
        await requireSuccess(admin.rpc('continue_review_sync_job', {
          p_job_id: job.id,
          p_worker_id: worker,
          p_delay_seconds: 5,
        }))
        return { jobId: job.id, status: 'deferred', providerRequests: 0 }
      }

      let page
      try {
        providerAttempted = true
        page = await fetchIncrementalPage({
          id: job.establishment_id,
          organization_id: job.organization_id,
          google_id: job.google_id,
          google_maps_url: job.google_maps_url,
          last_review_id: job.checkpoint_review_id,
          last_review_at: job.checkpoint_review_at,
        }, cursor)
      } finally {
        await admin.rpc('release_review_provider_slot', {
          p_slot_number: slot,
          p_worker_token: providerToken,
          p_cooldown_ms: config.providerCooldownMs,
        })
      }

      const first = page.reviews[0]
      headReviewId ??= first?.externalReviewId ?? null
      headReviewAt ??= first?.publishedAt ?? null
      const checkpoint = pageBeforeCheckpoint(page.reviews, job.checkpoint_review_id)
      const inserted = await insertReviews(admin, {
        id: job.establishment_id,
        organization_id: job.organization_id,
      }, checkpoint.reviews, false, page.provider)
      if (pageNumber === 0) {
        await persistEstablishmentSnapshot(admin, {
          id: job.establishment_id,
          organization_id: job.organization_id,
        }, page.provider, page.establishment, `sync:${job.id}`)
      }
      const nextCursor = page.reviews.at(-1)?.paginationId ?? null
      const saved = await requireSuccess(admin.rpc('checkpoint_review_sync_job', {
        p_job_id: job.id,
        p_worker_id: worker,
        p_pagination_cursor: nextCursor,
        p_head_review_id: headReviewId,
        p_head_review_at: headReviewAt,
        p_provider_requests: 1,
        p_reviews_fetched: page.reviews.length,
        p_reviews_inserted: inserted,
        p_lease_seconds: config.leaseSeconds,
      }))
      if (saved !== true) throw new Error('SYNC_LEASE_LOST')

      const caughtUp = checkpoint.caughtUp || page.reviews.length === 0 || !nextCursor
      if (caughtUp) {
        const completed = await requireSuccess(admin.rpc('complete_review_sync_job', {
          p_job_id: job.id,
          p_worker_id: worker,
          p_synced_at: new Date().toISOString(),
        }))
        if (completed !== true) throw new Error('SYNC_LEASE_LOST')
        return { jobId: job.id, status: 'completed', providerRequests: pageNumber + 1 }
      }
      cursor = nextCursor
    }

    await requireSuccess(admin.rpc('continue_review_sync_job', {
      p_job_id: job.id,
      p_worker_id: worker,
      p_delay_seconds: 0,
    }))
    return { jobId: job.id, status: 'continued', providerRequests: config.maxPages }
  } catch (error) {
    if (providerAttempted) {
      await admin.rpc('checkpoint_review_sync_job', {
        p_job_id: job.id,
        p_worker_id: worker,
        p_pagination_cursor: cursor ?? null,
        p_head_review_id: headReviewId,
        p_head_review_at: headReviewAt,
        p_provider_requests: 1,
        p_reviews_fetched: 0,
        p_reviews_inserted: 0,
        p_lease_seconds: config.leaseSeconds,
      })
    }
    const policy = retryPolicy(error, job.attempts, config.backoffSeconds)
    const status = await requireSuccess(admin.rpc('fail_review_sync_job', {
      p_job_id: job.id,
      p_worker_id: worker,
      p_error_code: policy.code,
      p_retryable: policy.retryable,
      p_max_attempts: config.maxAttempts,
      p_backoff_seconds: policy.backoffSeconds,
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
    claimBatch: configuredInteger(String(runtime.claim_batch), 25, 1, 100),
    concurrency: configuredInteger(
      String(Math.min(runtime.worker_concurrency, runtime.provider_slot_count)),
      5,
      1,
      32,
    ),
    leaseSeconds: configuredInteger(String(runtime.lease_seconds), 240, 30, 900),
    maxPages: configuredInteger(String(runtime.max_pages_per_claim), 5, 1, 25),
    maxAttempts: configuredInteger(String(runtime.max_attempts), 5, 1, 20),
    backoffSeconds: configuredInteger(String(runtime.retry_base_seconds), 60, 1, 3600),
    providerLeaseSeconds: configuredInteger(String(runtime.provider_lease_seconds), 60, 10, 180),
    providerCooldownMs: configuredInteger(String(runtime.provider_cooldown_ms), 200, 0, 10000),
    providerSlotWaitMs: 2_000,
    timeBudgetMs: configuredInteger(String(runtime.worker_time_budget_ms), 50_000, 5_000, 120_000),
    maxBatches: configuredInteger(String(runtime.max_batches_per_invocation), 8, 1, 100),
  }
  const worker = workerId()
  const startedAt = performance.now()
  const results: Array<Record<string, unknown>> = []
  let claimed = 0
  let batches = 0
  while (
    batches < config.maxBatches
    && performance.now() - startedAt < config.timeBudgetMs
  ) {
    const jobs = await requireSuccess<SyncJob[]>(admin.rpc('claim_review_sync_jobs', {
      p_worker_id: worker,
      p_limit: config.claimBatch,
      p_lease_seconds: config.leaseSeconds,
    }))
    if (!jobs?.length) break
    claimed += jobs.length
    batches += 1
    results.push(...await mapWithConcurrency(jobs, config.concurrency, (job) =>
      processJob(admin, job, worker, config)))
  }
  return json({
    claimed,
    batches,
    elapsedMs: Math.round(performance.now() - startedAt),
    results,
  })
})
