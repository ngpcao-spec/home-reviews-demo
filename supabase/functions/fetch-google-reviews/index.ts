import { requireUser } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import {
  fetchOutscraperGoogleReviews,
  getMockGoogleReviews,
  OutscraperError,
} from '../_shared/outscraper.ts'
import { ApifyError, fetchApifyReviews } from '../_shared/apify.ts'
import { apifyToken, preferredLanguageForUser } from '../_shared/sync-service.ts'

interface RequestBody {
  query?: unknown
  establishmentGoogleId?: unknown
}

Deno.serve(async (request) => {
  const preflightResponse = preflight(request)
  if (preflightResponse) return preflightResponse
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const { user, admin } = await requireUser(request)
    enforceRateLimit(`fetch-google-reviews:${user.id}`, 10, 60_000)

    const body = await request.json() as RequestBody
    const rawQuery = typeof body.establishmentGoogleId === 'string'
      ? body.establishmentGoogleId
      : body.query
    if (typeof rawQuery !== 'string' || rawQuery.trim().length < 2 || rawQuery.length > 500) {
      return json({ error: 'INVALID_INPUT' }, 400)
    }

    const query = rawQuery.trim()
    const provider = (Deno.env.get('REVIEW_PROVIDER') ?? 'mock').trim().toLowerCase()
    if (provider === 'mock') return json(getMockGoogleReviews(query))
    if (provider === 'apify') {
      const language = await preferredLanguageForUser(admin, user.id)
      return json(await fetchApifyReviews(apifyToken(), {
        placeUrl: query,
        language,
        sort: 'newest',
        limit: 20,
      }))
    }
    if (provider !== 'outscraper') return json({ error: 'REVIEW_PROVIDER_UNSUPPORTED' }, 500)

    const apiKey = Deno.env.get('OUTSCRAPER_API_KEY') ?? ''
    const result = await fetchOutscraperGoogleReviews({ query, apiKey, reviewsLimit: 20 })
    return json(result)
  } catch (error) {
    if (error instanceof OutscraperError) return json({ error: error.code }, error.httpStatus)
    if (error instanceof ApifyError) return json({ error: error.code }, error.httpStatus)
    if (error instanceof SyntaxError) return json({ error: 'INVALID_JSON' }, 400)
    const code = error instanceof Error ? error.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return json({ error: code }, 401)
    if (code === 'RATE_LIMITED') return json({ error: code }, 429)
    return json({ error: 'INTERNAL_ERROR' }, 500)
  }
})
