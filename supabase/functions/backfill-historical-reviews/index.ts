import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { json } from '../_shared/cors.ts'
import {
  backfillHistoricalReviews,
  type EstablishmentRow,
} from '../_shared/sync-service.ts'

async function sameSecret(left: string, right: string) {
  const encoder = new TextEncoder()
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ])
  const leftBytes = new Uint8Array(leftHash)
  const rightBytes = new Uint8Array(rightHash)
  return leftBytes.length === rightBytes.length
    && leftBytes.every((value, index) => value === rightBytes[index])
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const provided = request.headers.get('x-home-reviews-webhook') ?? ''
  const { data: config, error: configError } = await admin
    .from('ai_webhook_config')
    .select('secret')
    .eq('singleton', true)
    .single()
  if (configError || !config?.secret || !provided || !await sameSecret(provided, config.secret)) {
    return json({ error: 'UNAUTHORIZED' }, 401)
  }

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
