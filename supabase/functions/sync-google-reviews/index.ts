import { requireUser } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'
import { OutscraperError } from '../_shared/outscraper.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { syncEstablishment, type EstablishmentRow } from '../_shared/sync-service.ts'

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
      .select('id,organization_id,google_id,google_maps_url,last_review_id,last_review_at')
      .eq('active', true)

    if (typeof body.establishmentId === 'string') {
      query = query.eq('id', body.establishmentId)
    }

    const { data, error } = await query
    if (error) throw error
    const establishments = (data ?? []) as EstablishmentRow[]
    if (typeof body.establishmentId === 'string' && establishments.length === 0) {
      return json({ error: 'ESTABLISHMENT_NOT_FOUND' }, 404)
    }

    const results = []
    for (const establishment of establishments) {
      results.push(await syncEstablishment(admin, establishment))
    }

    return json({
      establishments: results.length,
      providerRequests: results.reduce((sum, result) => sum + result.providerRequests, 0),
      fetched: results.reduce((sum, result) => sum + result.fetched, 0),
      inserted: results.reduce((sum, result) => sum + result.inserted, 0),
      results,
    })
  } catch (error) {
    if (error instanceof OutscraperError) return json({ error: error.code }, error.httpStatus)
    if (error instanceof SyntaxError) return json({ error: 'INVALID_JSON' }, 400)
    const code = error instanceof Error ? error.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return json({ error: code }, 401)
    if (code === 'RATE_LIMITED') return json({ error: code }, 429)
    return json({ error: 'SYNC_FAILED' }, 500)
  }
})

