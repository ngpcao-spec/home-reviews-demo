import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { json } from '../_shared/cors.ts'
import { configuredInteger } from '../_shared/sync-queue.ts'

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )
  const { data: authorized, error: authError } = await admin.rpc(
    'verify_review_scheduler_token',
    { p_token: request.headers.get('x-home-reviews-scheduler') ?? '' },
  )
  if (authError || authorized !== true) return json({ error: 'UNAUTHORIZED' }, 401)

  const limit = configuredInteger(
    Deno.env.get('SYNC_SCHEDULER_ENQUEUE_LIMIT'),
    1000,
    1,
    10000,
  )
  const { data, error } = await admin.rpc('enqueue_due_review_sync_jobs', {
    p_limit: limit,
  })
  if (error) return json({ error: 'ENQUEUE_FAILED' }, 500)
  return json({ queued: Number(data ?? 0), providerRequests: 0 })
})
