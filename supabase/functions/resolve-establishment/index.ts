import { requireUser } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'
import { OutscraperError } from '../_shared/outscraper.ts'
import { ApifyError } from '../_shared/apify.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { preferredLanguageForUser, resolveEstablishmentCandidate } from '../_shared/sync-service.ts'

interface RequestBody { input?: unknown }

function isSupportedGoogleMapsUrl(input: string): boolean {
  try {
    const url = new URL(input)
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return host === 'maps.app.goo.gl'
      || ((host === 'google.com' || host.endsWith('.google.com')) && url.pathname.includes('/maps'))
  } catch {
    return false
  }
}

Deno.serve(async (request) => {
  const preflightResponse = preflight(request)
  if (preflightResponse) return preflightResponse
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const { user, admin } = await requireUser(request)
    enforceRateLimit(`resolve-establishment:${user.id}`, 10, 60_000)
    const body = await request.json() as RequestBody
    if (typeof body.input !== 'string' || body.input.length > 500 || !isSupportedGoogleMapsUrl(body.input.trim())) {
      return json({ error: 'INVALID_GOOGLE_MAPS_LINK' }, 400)
    }

    const { data: membership, error: membershipError } = await admin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .single()
    if (membershipError || !membership) return json({ error: 'FORBIDDEN' }, 403)

    const language = await preferredLanguageForUser(admin, user.id)
    const resolved = await resolveEstablishmentCandidate(body.input.trim(), language)
    const { data: existing, error: existingError } = await admin
      .from('establishments')
      .select('id')
      .eq('organization_id', membership.organization_id)
      .eq('google_id', resolved.establishment.googleId)
      .maybeSingle()
    if (existingError) throw existingError
    if (existing) return json({ error: 'ESTABLISHMENT_ALREADY_ADDED' }, 409)

    return json({ candidate: resolved.establishment })
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
