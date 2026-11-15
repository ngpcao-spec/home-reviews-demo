import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { sendPushToUser } from '../_shared/push.ts'
import { processReviewNotifications } from '../_shared/review-notification-worker.ts'

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
})

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  const token = request.headers.get('x-home-reviews-scheduler')
  if (!token) return json({ error: 'UNAUTHORIZED' }, 401)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const auth = await admin.rpc('verify_review_scheduler_token', { p_token: token })
  if (auth.error || auth.data !== true) return json({ error: 'UNAUTHORIZED' }, 401)
  try {
    const result = await processReviewNotifications({
      claim: async (claimId) => {
        const result = await admin.rpc('claim_review_notification_delivery', { p_claim: claimId })
        if (result.error) throw new Error('DELIVERY_CLAIM_FAILED')
        return result.data
      },
      send: (notification) => sendPushToUser(admin, notification.user_id, {
        title: notification.title, body: notification.body,
        url: `#/avis/${notification.review_id}`, tag: `review-${notification.review_id}`,
      }),
      finish: async (id, claimId, state, receipt) => {
        const result = await admin.rpc('finish_review_notification_delivery', {
          p_id: id, p_claim: claimId, p_state: state, p_receipt: receipt,
        })
        if (result.error) throw new Error('DELIVERY_FINISH_FAILED')
        return result.data === true
      },
    })
    return json(result)
  } catch {
    return json({ error: 'REVIEW_NOTIFICATION_WORKER_FAILED' }, 500)
  }
})
