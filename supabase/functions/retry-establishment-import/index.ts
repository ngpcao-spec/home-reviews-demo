import { requireUser } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'

Deno.serve(async (request) => {
  const preflightResponse = preflight(request)
  if (preflightResponse) return preflightResponse
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const { user, client } = await requireUser(request)
    enforceRateLimit(`retry-establishment-import:${user.id}`, 5, 60 * 60_000)
    const body = await request.json() as { importJobId?: unknown; establishmentId?: unknown }
    let jobId = typeof body.importJobId === 'string' ? body.importJobId.trim() : ''

    if (!jobId && typeof body.establishmentId === 'string' && body.establishmentId.trim()) {
      const { data: existing } = await client.from('initial_import_jobs')
        .select('id')
        .eq('establishment_id', body.establishmentId.trim())
        .in('status', ['failed', 'completed', 'queued', 'running', 'retry'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      jobId = existing?.id ?? ''
    }
    if (!jobId) return json({ error: 'IMPORT_JOB_ID_REQUIRED' }, 400)

    const { data: job, error } = await client.rpc('retry_initial_import_job', { p_job_id: jobId })
    if (error || !job) {
      const code = ['APIFY_START_OUTCOME_UNKNOWN', 'IMPORT_RESULT_NOT_CONFIRMED', 'REVIEW_COLLECTION_BUSY', 'IMPORT_JOB_NOT_RETRYABLE']
        .find((value) => error?.message.includes(value)) ?? 'IMPORT_RETRY_FAILED'
      console.error('IMPORT_MANUAL_RETRY_REJECTED', { jobId, code })
      return json({ error: code }, code === 'IMPORT_RETRY_FAILED' ? 500 : 409)
    }
    return json({ importJobId: job.id, status: job.status })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'IMPORT_RETRY_FAILED'
    if (code === 'UNAUTHORIZED') return json({ error: code }, 401)
    if (code === 'RATE_LIMITED') return json({ error: code }, 429)
    return json({ error: 'IMPORT_RETRY_FAILED' }, 500)
  }
})
