import { requireUser } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'

interface RequestBody {
  establishmentId?: unknown
}

Deno.serve(async (request) => {
  const preflightResponse = preflight(request)
  if (preflightResponse) return preflightResponse
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const { user, client, admin } = await requireUser(request)
    enforceRateLimit(`sync-google-reviews:${user.id}`, 10, 60_000)

    const body = await request.json() as RequestBody
    let query = client
      .from('establishments')
      .select('id,next_sync_at')
      .eq('active', true)

    if (typeof body.establishmentId === 'string') {
      query = query.eq('id', body.establishmentId)
    }

    const { data, error } = await query
    if (error) throw error
    const establishments = data ?? []
    if (typeof body.establishmentId === 'string' && establishments.length === 0) {
      return json({ error: 'ESTABLISHMENT_NOT_FOUND' }, 404)
    }
    const now = Date.now()
    const due = establishments.filter((item) =>
      item.next_sync_at !== null && Date.parse(item.next_sync_at) <= now
    )
    if (due.length === 0) {
      return json({ queued: 0, providerRequests: 0, status: 'not_due' })
    }
    const { data: queued, error: enqueueError } = await admin.rpc(
      'enqueue_user_due_review_sync_jobs',
      {
        p_user_id: user.id,
        p_establishment_id: typeof body.establishmentId === 'string'
          ? body.establishmentId
          : null,
        p_limit: 100,
      },
    )
    if (enqueueError) throw enqueueError
    return json({
      queued: Number(queued ?? 0),
      providerRequests: 0,
      status: Number(queued ?? 0) > 0 ? 'queued' : 'already_queued',
    })
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'INVALID_JSON' }, 400)
    const code = error instanceof Error ? error.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return json({ error: code }, 401)
    if (code === 'RATE_LIMITED') return json({ error: code }, 429)
    return json({ error: 'ENQUEUE_FAILED' }, 500)
  }
})

