import { assertMembership, requireUser } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { preferredLanguageForUser } from '../_shared/sync-service.ts'

interface RequestBody {
  organizationId?: unknown
  query?: unknown
  confirmed?: unknown
  expectedGoogleId?: unknown
  candidate?: unknown
}

function candidateSnapshot(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const candidate = value as Record<string, unknown>
  const text = (key: string, maximum = 500) =>
    typeof candidate[key] === 'string' ? candidate[key].trim().slice(0, maximum) : null
  const number = (key: string) => {
    const parsed = Number(candidate[key])
    return Number.isFinite(parsed) ? parsed : null
  }
  return {
    name: text('name', 250),
    address: text('address'),
    photoUrl: text('photoUrl', 1_500),
    googleMapsUrl: text('googleMapsUrl', 1_500),
    rating: number('rating'),
    reviewCount: number('reviewCount'),
  }
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
    const { data: job, error: enqueueError } = await admin.rpc('enqueue_initial_import_job', {
      p_organization_id: organizationId,
      p_user_id: user.id,
      p_query: body.query.trim(),
      p_expected_google_id: body.expectedGoogleId.trim(),
      p_preferred_language: language,
      p_candidate_snapshot: candidateSnapshot(body.candidate),
    })
    if (enqueueError) {
      if (enqueueError.message.includes('ESTABLISHMENT_ALREADY_ADDED')) {
        return json({ error: 'ESTABLISHMENT_ALREADY_ADDED' }, 409)
      }
      if (enqueueError.message.includes('FORBIDDEN')) return json({ error: 'FORBIDDEN' }, 403)
      throw enqueueError
    }
    return json({ importJobId: job.id, status: job.status }, 202)
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'INVALID_JSON' }, 400)
    const code = error instanceof Error ? error.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return json({ error: code }, 401)
    if (code === 'FORBIDDEN') return json({ error: code }, 403)
    if (code === 'RATE_LIMITED') return json({ error: code }, 429)
    if (code === 'ESTABLISHMENT_ALREADY_ADDED') return json({ error: code }, 409)
    return json({ error: 'IMPORT_JOB_ENQUEUE_FAILED' }, 500)
  }
})
