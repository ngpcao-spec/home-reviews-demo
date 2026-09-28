import { assertMembership, requireUser } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'
import { OutscraperError } from '../_shared/outscraper.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { backfillHistoricalReviews, type EstablishmentRow } from '../_shared/sync-service.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'

Deno.serve(async (request) => {
  const preflightResponse = preflight(request)
  if (preflightResponse) return preflightResponse
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  let establishmentId = ''
  let adminClient: SupabaseClient | undefined
  try {
    const { user, client, admin } = await requireUser(request)
    adminClient = admin
    enforceRateLimit(`retry-establishment-import:${user.id}`, 3, 60 * 60_000)
    const body = await request.json() as { establishmentId?: unknown }
    if (typeof body.establishmentId !== 'string' || !body.establishmentId.trim()) {
      return json({ error: 'ESTABLISHMENT_ID_REQUIRED' }, 400)
    }
    establishmentId = body.establishmentId.trim()

    const { data: establishment, error } = await client
      .from('establishments')
      .select('id,organization_id,google_id,google_maps_url,last_review_id,last_review_at,next_sync_at')
      .eq('id', establishmentId)
      .eq('active', true)
      .single()
    if (error || !establishment) return json({ error: 'ESTABLISHMENT_NOT_FOUND' }, 404)
    await assertMembership(admin, user.id, establishment.organization_id, ['owner', 'admin', 'manager'])

    await admin.from('establishments').update({
      sync_status: 'syncing',
      sync_error: null,
    }).eq('id', establishmentId)

    const result = await backfillHistoricalReviews(admin, establishment as EstablishmentRow)
    const now = new Date().toISOString()
    const { data: updated, error: updateError } = await admin
      .from('establishments')
      .update({
        sync_status: 'ok',
        sync_error: null,
        last_sync_status: 'ok',
        last_sync_error: null,
        last_sync_at: now,
      })
      .eq('id', establishmentId)
      .select('next_sync_at')
      .single()
    if (updateError) throw updateError

    const { count, error: countError } = await admin
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .eq('establishment_id', establishmentId)
      .lte('rating', 3)
    if (countError) throw countError

    return json({
      ...result,
      negativeReviewCount: count ?? 0,
      nextSyncAt: updated.next_sync_at,
      importStatus: 'completed',
    })
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 160) : 'IMPORT_RETRY_FAILED'
    if (establishmentId && adminClient) {
      await adminClient.from('establishments').update({
        sync_status: 'error',
        sync_error: code,
        last_sync_status: 'error',
        last_sync_error: code,
      }).eq('id', establishmentId)
    }
    if (error instanceof OutscraperError) return json({ error: error.code, retryable: true }, error.httpStatus)
    if (code === 'UNAUTHORIZED') return json({ error: code }, 401)
    if (code === 'FORBIDDEN') return json({ error: code }, 403)
    if (code === 'RATE_LIMITED') return json({ error: code }, 429)
    return json({ error: code, retryable: true }, 500)
  }
})
