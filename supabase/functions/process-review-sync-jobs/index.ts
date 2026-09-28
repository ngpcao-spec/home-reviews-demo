import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'
import { json } from '../_shared/cors.ts'
import { insertReviews, fetchIncrementalPage } from '../_shared/sync-service.ts'
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

async function requireSuccess<T>(
  promise: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await promise
  if (error) throw new Error(error.message)
  return data
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
  },
) {
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
      const slot = await requireSuccess<number | null>(
        admin.rpc('claim_review_provider_slot', {
          p_worker_token: providerToken,
          p_lease_seconds: config.providerLeaseSeconds,
        }),
      )
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
      const negative = checkpoint.reviews.filter(
        (review) => review.rating >= 1 && review.rating <= 3,
      )
      const inserted = await insertReviews(admin, {
        id: job.establishment_id,
        organization_id: job.organization_id,
      }, negative, false)
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

  const config = {
    claimBatch: configuredInteger(Deno.env.get('SYNC_JOB_CLAIM_BATCH'), 25, 1, 100),
    concurrency: configuredInteger(Deno.env.get('SYNC_PROVIDER_CONCURRENCY'), 5, 1, 20),
    leaseSeconds: configuredInteger(Deno.env.get('SYNC_JOB_LEASE_SECONDS'), 240, 30, 900),
    maxPages: configuredInteger(Deno.env.get('SYNC_MAX_PAGES_PER_CLAIM'), 5, 1, 25),
    maxAttempts: configuredInteger(Deno.env.get('SYNC_JOB_MAX_ATTEMPTS'), 5, 1, 20),
    backoffSeconds: configuredInteger(Deno.env.get('SYNC_RETRY_BASE_SECONDS'), 60, 1, 3600),
    providerLeaseSeconds: configuredInteger(Deno.env.get('SYNC_PROVIDER_LEASE_SECONDS'), 60, 10, 180),
    providerCooldownMs: configuredInteger(Deno.env.get('SYNC_PROVIDER_COOLDOWN_MS'), 200, 0, 10000),
  }
  const worker = workerId()
  const jobs = await requireSuccess<SyncJob[]>(admin.rpc('claim_review_sync_jobs', {
    p_worker_id: worker,
    p_limit: config.claimBatch,
    p_lease_seconds: config.leaseSeconds,
  }))
  const results = await mapWithConcurrency(jobs ?? [], config.concurrency, (job) =>
    processJob(admin, job, worker, config))
  return json({ claimed: jobs?.length ?? 0, results })
})
