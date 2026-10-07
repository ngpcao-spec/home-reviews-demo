import { createClient } from '@supabase/supabase-js'
import {browserAuthFlow} from './auth-session'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)
// iOS may hand an installed PWA's Google navigation to Safari, whose storage
// does not contain the initiating PKCE verifier. The client-only flow carries
// the validated session in the URL fragment; desktop keeps PKCE.
const flowType=typeof window==='undefined'?'pkce':browserAuthFlow(window.location.href,navigator.userAgent,navigator.platform,navigator.maxTouchPoints)
export const supabase = isSupabaseConfigured ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType } }) : null
