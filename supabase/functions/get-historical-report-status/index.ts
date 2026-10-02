import { assertMembership, requireUser } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'
import { historicalRunStatus } from '../_shared/historical-run-status.ts'

// Read-only projection. Never expose the private snapshot/findings or mutate a run.
Deno.serve(async request => {
  const early = preflight(request)
  if (early) return early
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  try {
    const context = await requireUser(request)
    const body = await request.json()
    if (typeof body.establishment_id !== 'string') return json({ error: 'ESTABLISHMENT_ID_REQUIRED' }, 400)
    const [{ data: establishment, error }, { data: profile, error: profileError }] = await Promise.all([
      context.client.from('establishments').select('id,organization_id').eq('id', body.establishment_id).single(),
      context.client.from('profiles').select('preferred_language').eq('user_id', context.user.id).single(),
    ])
    if (error || !establishment) return json({ error: 'ESTABLISHMENT_NOT_FOUND' }, 404)
    await assertMembership(context.client, context.user.id, establishment.organization_id, ['owner', 'admin', 'manager'])
    if (profileError || !['fr', 'vi'].includes(profile?.preferred_language)) return json({ error: 'PREFERRED_LANGUAGE_REQUIRED' }, 400)
    if (body.preferred_language && body.preferred_language !== profile.preferred_language) return json({ error: 'REPORT_LANGUAGE_CHANGED' }, 409)
    const { data: run, error: runError } = await context.admin.from('historical_report_runs')
      .select('establishment_id,language,generation_id,status,cursor,error_code,total_steps,snapshot')
      .eq('organization_id', establishment.organization_id).eq('establishment_id', establishment.id).eq('language', profile.preferred_language)
      .order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle()
    if (runError) throw new Error('REPORT_RUN_READ_FAILED')
    if (!run) return json({ run: null })
    return json({ run: historicalRunStatus(run) })
  } catch (error) {
    const code = error instanceof Error && ['UNAUTHORIZED', 'FORBIDDEN'].includes(error.message) ? error.message : 'REPORT_STATUS_UNAVAILABLE'
    console.warn('Historical report status unavailable', { code })
    return json({ error: code }, code === 'UNAUTHORIZED' ? 401 : code === 'FORBIDDEN' ? 403 : 500)
  }
})
