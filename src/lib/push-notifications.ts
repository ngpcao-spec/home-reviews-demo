import { supabase } from './supabase'

export type PushUiState = 'enabled' | 'disabled' | 'denied' | 'unsupported'

export function shouldNotifyForRating(rating: number) {
  return Number.isInteger(rating) && rating >= 1 && rating <= 3
}

export function getPushUiState(supported: boolean, permission: NotificationPermission, subscribed: boolean): PushUiState {
  if (!supported) return 'unsupported'
  if (permission === 'denied') return 'denied'
  return permission === 'granted' && subscribed ? 'enabled' : 'disabled'
}

export function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export function isStandalonePwa() {
  return window.matchMedia('(display-mode: standalone)').matches
    || ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
}

export function pushIsSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)))
}

function keyToBase64(key: ArrayBuffer | null) {
  if (!key) return ''
  let binary = ''
  for (const byte of new Uint8Array(key)) binary += String.fromCharCode(byte)
  return window.btoa(binary)
}

export async function currentPushSubscription() {
  if (!pushIsSupported()) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

export async function enablePushNotifications() {
  if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED')
  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()

  if (!subscription) {
    const { data: config, error: configError } = await supabase.functions.invoke<{ publicKey?: string; error?: string }>('push-config')
    if (configError || !config?.publicKey) throw new Error(config?.error ?? 'PUSH_CONFIG_UNAVAILABLE')
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey),
    })
  }

  const { error } = await supabase.functions.invoke('register-push-subscription', {
    body: {
      action: 'subscribe',
      endpoint: subscription.endpoint,
      keys: {
        p256dh: keyToBase64(subscription.getKey('p256dh')),
        auth: keyToBase64(subscription.getKey('auth')),
      },
    },
  })
  if (error) throw error
  return subscription
}

export async function disablePushNotifications() {
  if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED')
  const subscription = await currentPushSubscription()
  if (!subscription) return
  const { error } = await supabase.functions.invoke('register-push-subscription', {
    body: { action: 'unsubscribe', endpoint: subscription.endpoint },
  })
  if (error) throw error
  await subscription.unsubscribe()
}
