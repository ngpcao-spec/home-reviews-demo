import { requireUser } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'
import { getOrCreateVapidKeys } from '../_shared/push.ts'

Deno.serve(async (request) => {
  const preflightResponse = preflight(request)
  if (preflightResponse) return preflightResponse
  try {
    const { admin } = await requireUser(request)
    const keys = await getOrCreateVapidKeys(admin)
    return json({ publicKey: keys.vapid_public_key })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'PUSH_CONFIGURATION_FAILED'
    return json({ error: code }, code === 'UNAUTHORIZED' ? 401 : 500)
  }
})
