import webpush from 'npm:web-push@3.6.7'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'

interface PushPayload {
  title: string
  body: string
  url: string
  tag: string
}

interface PushSubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

export async function getOrCreateVapidKeys(admin: SupabaseClient) {
  const existing = await admin
    .from('push_server_config')
    .select('vapid_public_key,vapid_private_key')
    .eq('singleton', true)
    .maybeSingle()
  if (existing.data) return existing.data

  const generated = webpush.generateVAPIDKeys()
  const inserted = await admin
    .from('push_server_config')
    .insert({
      singleton: true,
      vapid_public_key: generated.publicKey,
      vapid_private_key: generated.privateKey,
    })
    .select('vapid_public_key,vapid_private_key')
    .single()

  if (inserted.data) return inserted.data

  const raced = await admin
    .from('push_server_config')
    .select('vapid_public_key,vapid_private_key')
    .eq('singleton', true)
    .single()
  if (raced.error || !raced.data) throw raced.error ?? new Error('VAPID_CONFIGURATION_FAILED')
  return raced.data
}

export async function sendPushToUser(admin: SupabaseClient, userId: string, payload: PushPayload) {
  const { data, error } = await admin
    .from('push_subscriptions')
    .select('id,endpoint,p256dh,auth')
    .eq('user_id', userId)
  if (error) throw error

  const subscriptions = (data ?? []) as PushSubscriptionRow[]
  if (!subscriptions.length) {
    return {
      sent: 0,
      failed: 0,
      skipped: true,
      attempted: 0,
      subscriptionCount: 0,
      providerStatusCodes: [] as number[],
      expiredRemoved: 0,
    }
  }

  const keys = await getOrCreateVapidKeys(admin)
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')?.trim() || 'mailto:support@home-reviews.app',
    keys.vapid_public_key,
    keys.vapid_private_key,
  )

  let sent = 0
  let failed = 0
  let attempted = 0
  let expiredRemoved = 0
  const providerStatusCodes: number[] = []

  await Promise.all(subscriptions.map(async (subscription) => {
    attempted += 1
    try {
      const response = await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
        { TTL: 60 * 60, urgency: 'normal' },
      )
      const statusCode = Number(response?.statusCode)
      if (Number.isInteger(statusCode) && statusCode > 0) providerStatusCodes.push(statusCode)
      sent += 1
    } catch (error) {
      failed += 1
      const statusCode = typeof error === 'object' && error && 'statusCode' in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : 0
      if (Number.isInteger(statusCode) && statusCode > 0) providerStatusCodes.push(statusCode)
      if (statusCode === 404 || statusCode === 410) {
        const removed = await admin.from('push_subscriptions').delete().eq('id', subscription.id)
        if (!removed.error) expiredRemoved += 1
      }
    }
  }))

  return {
    sent,
    failed,
    skipped: false,
    attempted,
    subscriptionCount: subscriptions.length,
    providerStatusCodes,
    expiredRemoved,
  }
}
