import { requireUser } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'

Deno.serve(async (request) => {
  const preflightResponse = preflight(request)
  if (preflightResponse) return preflightResponse
  try {
    const { user, client } = await requireUser(request)
    const body = await request.json() as {
      action?: 'subscribe' | 'unsubscribe'
      endpoint?: string
      keys?: { p256dh?: string; auth?: string }
    }

    if (typeof body.endpoint !== 'string' || !body.endpoint.startsWith('https://')) {
      return json({ error: 'INVALID_SUBSCRIPTION' }, 400)
    }

    if (body.action === 'unsubscribe') {
      const { error } = await client
        .from('push_subscriptions')
        .delete()
        .eq('user_id', user.id)
        .eq('endpoint', body.endpoint)
      if (error) throw error
      return json({ ok: true })
    }

    if (typeof body.keys?.p256dh !== 'string' || typeof body.keys?.auth !== 'string') {
      return json({ error: 'INVALID_SUBSCRIPTION' }, 400)
    }

    const { error } = await client.from('push_subscriptions').upsert({
      user_id: user.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      user_agent: request.headers.get('user-agent'),
    }, { onConflict: 'endpoint' })
    if (error) throw error
    return json({ ok: true })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNKNOWN'
    return json({ error: code }, code === 'UNAUTHORIZED' ? 401 : 500)
  }
})
