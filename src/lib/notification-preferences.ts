import { supabase } from './supabase'

export type NotificationPermissionStatus = 'unknown' | 'granted' | 'denied'

export interface NotificationPreference {
  seen: boolean
  status: NotificationPermissionStatus
}

export function shouldShowNotificationOnboarding(preference: NotificationPreference, subscribed: boolean) {
  return !preference.seen && preference.status === 'unknown' && !subscribed
}

export function requiresIosInstallation(isIos: boolean, isStandalone: boolean) {
  return isIos && !isStandalone
}

export async function loadNotificationPreference(): Promise<NotificationPreference> {
  if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED')
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error('UNAUTHORIZED')
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('notification_onboarding_seen,notification_permission_status')
    .eq('user_id', userData.user.id)
    .maybeSingle()
  if (error) throw error
  return {
    seen: data?.notification_onboarding_seen ?? false,
    status: (data?.notification_permission_status ?? 'unknown') as NotificationPermissionStatus,
  }
}

export async function saveNotificationPreference(status: NotificationPermissionStatus, seen = true) {
  if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED')
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error('UNAUTHORIZED')
  const { error } = await supabase.from('notification_preferences').upsert({
    user_id: userData.user.id,
    notification_onboarding_seen: seen,
    notification_permission_status: status,
  }, { onConflict: 'user_id' })
  if (error) throw error
}
