import { requireUser } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
Deno.serve(async request => {
  const options = preflight(request)
  if (options) return options
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  try {
    const { user, client } = await requireUser(request)
    enforceRateLimit(`review-reload:${user.id}`, 5, 60 * 60_000)
    const body = await request.json()
    if (!uuid.test(body.establishmentId ?? '') || !uuid.test(body.requestId ?? '')) return json({ error: 'INVALID_REQUEST' }, 400)
    const { data, error } = await client.rpc('request_review_reload', { p_establishment: body.establishmentId, p_request_key: body.requestId })
    if (error || !data) {
      console.error('MANUAL_REVIEW_RELOAD_REQUEST_FAILED', user.id, error?.message)
      return json({ error: 'REVIEW_RELOAD_UNAVAILABLE' }, 409)
    }
    return json({ importJobId: data.id, status: data.status })
  } catch (error) {
    console.error('MANUAL_REVIEW_RELOAD_REQUEST_FAILED', error instanceof Error ? error.message : 'unknown')
    return json({ error: 'REVIEW_RELOAD_UNAVAILABLE' }, 400)
  }
})
