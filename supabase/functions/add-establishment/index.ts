import { assertMembership, requireUser } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'
import { OutscraperError } from '../_shared/outscraper.ts'
import { ApifyError } from '../_shared/apify.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { initializeEstablishment, preferredLanguageForUser } from '../_shared/sync-service.ts'

interface RequestBody {
  organizationId?: unknown
  query?: unknown
  confirmed?: unknown
  expectedGoogleId?: unknown
}

Deno.serve(async (request) => {
  const preflightResponse = preflight(request)
  if (preflightResponse) return preflightResponse
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const { user, admin } = await requireUser(request)
    enforceRateLimit(`add-establishment:${user.id}`, 5, 60 * 60_000)

    const body = await request.json() as RequestBody
    if (typeof body.query !== 'string' || body.query.trim().length < 2 || body.query.length > 500) {
      return json({ error: 'INVALID_INPUT' }, 400)
    }
    if (body.confirmed !== true) return json({ error: 'CONFIRMATION_REQUIRED' }, 400)
    if (typeof body.expectedGoogleId !== 'string' || body.expectedGoogleId.length < 2) {
      return json({ error: 'INVALID_ESTABLISHMENT' }, 400)
    }

    let organizationId = typeof body.organizationId === 'string' ? body.organizationId : null
    if (!organizationId) {
      const { data, error } = await admin
        .from('organization_members')
        .select('organization_id,role')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .single()
      if (error || !data) throw new Error('FORBIDDEN')
      organizationId = data.organization_id
    }

    await assertMembership(admin, user.id, organizationId, ['owner', 'admin', 'manager'])
    const language = await preferredLanguageForUser(admin, user.id)
    const result = await initializeEstablishment(
      admin,
      organizationId,
      body.query.trim(),
      body.expectedGoogleId,
      language,
    )
    return json(result, 201)
  } catch (error) {
    if (error instanceof OutscraperError) return json({ error: error.code }, error.httpStatus)
    if (error instanceof ApifyError) return json({ error: error.code }, error.httpStatus)
    if (error instanceof SyntaxError) return json({ error: 'INVALID_JSON' }, 400)
    const code = error instanceof Error ? error.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return json({ error: code }, 401)
    if (code === 'FORBIDDEN') return json({ error: code }, 403)
    if (code === 'RATE_LIMITED') return json({ error: code }, 429)
    if (code === 'ESTABLISHMENT_ALREADY_ADDED') return json({ error: code }, 409)
    if (code === 'ESTABLISHMENT_MISMATCH') return json({ error: code }, 409)
    return json({ error: 'INITIALIZATION_FAILED' }, 500)
  }
})

