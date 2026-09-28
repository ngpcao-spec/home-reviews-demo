import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { json } from '../_shared/cors.ts'
import {
  backfillHistoricalReviews,
  type EstablishmentRow,
} from '../_shared/sync-service.ts'

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const token = request.headers.get('x-home-reviews-scheduler') ?? ''

  const { data: authorized, error: authError } = await admin.rpc(
    'verify_review_scheduler_token',
    { p_token: token },
  )
  if (authError || authorized !== true) return json({ error: 'UNAUTHORIZED' }, 401)

  try {
    const body = await request.json() as { establishmentId?: unknown }
    if (typeof body.establishmentId !== 'string') {
      return json({ error: 'ESTABLISHMENT_ID_REQUIRED' }, 400)
    }

    const { data, error } = await admin
      .from('establishments')
      .select('id,organization_id,google_id,google_maps_url,last_review_id,last_review_at')
      .eq('id', body.establishmentId)
      .eq('active', true)
      .single()
    if (error || !data) return json({ error: 'ESTABLISHMENT_NOT_FOUND' }, 404)

    const result = await backfillHistoricalReviews(admin, data as EstablishmentRow)
    return json(result)
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 160) : 'HISTORICAL_BACKFILL_FAILED'
    return json({ error: code }, 500)
  }
})
