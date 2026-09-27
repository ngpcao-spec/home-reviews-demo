/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { demoPlan, seedEstablishments, seedNotifications, seedReviews } from '../data/mock-data'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { MockReviewProvider, type PlaceCandidate } from '../services/review-provider'
import type { AppNotification, Establishment, Review, ReviewAction, ReviewStatus } from '../types/domain'

interface ToastMessage { id: number; text: string }

export interface AddEstablishmentResult {
  establishmentId: string
  inserted: number
  distribution: { '1': number; '2': number; '3': number }
}

interface AppContextValue {
  establishments: Establishment[]
  reviews: Review[]
  notifications: AppNotification[]
  actions: ReviewAction[]
  toasts: ToastMessage[]
  demoMode: boolean
  authReady: boolean
  isAuthenticated: boolean
  dataLoading: boolean
  dataReady: boolean
  dataError: string | null
  passwordRecovery: boolean
  monitoringIntervalHours: number
  currentUser: { name: string; email: string }
  plan: typeof demoPlan
  aiUsage: number
  markProcessed: (reviewId: string) => void
  reopenReview: (reviewId: string) => void
  generateResponse: (reviewId: string) => Promise<string>
  logAction: (reviewId: string, actionType: ReviewAction['actionType']) => void
  markNotificationRead: (notificationId: string) => Promise<void>
  markAllNotificationsRead: () => Promise<void>
  resolveEstablishment: (input: string) => Promise<PlaceCandidate>
  addEstablishment: (input: string, candidate: PlaceCandidate) => Promise<AddEstablishmentResult>
  refreshEstablishment: (id: string) => Promise<void>
  toggleMonitoring: (id: string) => void
  removeEstablishment: (id: string) => void
  injectNegativeReview: () => string
  pushToast: (text: string) => void
  retryData: () => Promise<void>
  updateMonitoringInterval: (hours: number) => Promise<void>
  completePasswordRecovery: (password: string) => Promise<void>
}

interface EstablishmentRow {
  id: string
  organization_id: string
  name: string
  address: string
  google_maps_url: string
  photo_url: string | null
  rating: number | string
  total_reviews: number
  active: boolean
  last_sync_at: string | null
  sync_status: 'pending' | 'syncing' | 'ok' | 'error'
}

interface ReviewRow {
  id: string
  organization_id: string
  establishment_id: string
  external_review_id: string
  author_name: string
  rating: number
  text: string
  language: string | null
  published_at: string | null
  created_at: string
  review_url: string | null
  historical_import: boolean
  status: ReviewStatus
  ai_summary: string | null
  ai_suggested_reply: string | null
  ai_detected_language: string | null
  ai_analyzed_at: string | null
  ai_status: 'pending' | 'completed' | 'failed' | null
  ai_error: string | null
}

interface NotificationRow {
  id: string
  organization_id: string
  user_id: string
  review_id: string
  establishment_id: string
  type: string
  title: string
  body: string
  read_at: string | null
  push_status: 'pending' | 'sent' | 'failed' | 'skipped'
  created_at: string
}

interface AnalyzePayload {
  ai_summary?: string
  ai_suggested_reply?: string
  detected_language?: string
  ai_analyzed_at?: string
  ai_status?: 'completed'
  error?: string
}

interface ResolvePayload {
  candidate?: {
    name: string
    fullAddress: string
    rating: number
    totalReviews: number
    placeId: string | null
    googleId: string
    locationLink: string | null
    photo: string | null
  }
  error?: string
}

interface AddPayload {
  establishmentId?: string
  inserted?: number
  distribution?: { '1': number; '2': number; '3': number }
  error?: string
}

interface OrganizationRow {
  monitoring_interval_hours: number
}

const AppContext = createContext<AppContextValue | null>(null)
const mockProvider = new MockReviewProvider()
const STORAGE_KEY = 'home-reviews-demo-v1'
const allowDemo = import.meta.env.DEV || import.meta.env.MODE === 'test' || import.meta.env.VITE_DEMO_MODE === 'true'

type StoredState = { establishments: Establishment[]; reviews: Review[]; notifications: AppNotification[]; actions: ReviewAction[] }
const emptyState: StoredState = { establishments: [], reviews: [], notifications: [], actions: [] }

function demoState(): StoredState {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) return JSON.parse(stored) as StoredState
    } catch { /* use seed */ }
  }
  return { establishments: seedEstablishments, reviews: seedReviews, notifications: seedNotifications, actions: [] }
}

function cityFromAddress(address: string): string {
  return address.split(',').map((part) => part.trim()).filter(Boolean)[1] ?? address
}

function mapEstablishment(row: EstablishmentRow): Establishment {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    address: row.address,
    city: cityFromAddress(row.address),
    category: 'Établissement',
    googleMapsUrl: row.google_maps_url,
    photoUrl: row.photo_url ?? undefined,
    currentRating: Number(row.rating),
    currentReviewCount: row.total_reviews,
    isActive: row.active,
    syncEnabled: row.active,
    lastSyncedAt: row.last_sync_at ?? new Date().toISOString(),
    syncStatus: row.sync_status,
  }
}

function mapReview(row: ReviewRow): Review {
  const status = row.rating <= 3 && row.status === 'new' ? 'to_process' : row.status
  return {
    id: row.id,
    organizationId: row.organization_id,
    establishmentId: row.establishment_id,
    externalReviewId: row.external_review_id,
    authorName: row.author_name,
    rating: row.rating,
    reviewText: row.text,
    reviewLanguage: row.language ?? 'fr',
    publishedAt: row.published_at ?? row.created_at,
    sourceUrl: row.review_url ?? '',
    isHistoricalImport: row.historical_import,
    requiresAction: row.rating <= 3,
    status,
    aiSummary: row.ai_summary ?? undefined,
    aiSuggestedReply: row.ai_suggested_reply ?? undefined,
    aiDetectedLanguage: row.ai_detected_language ?? undefined,
    aiAnalyzedAt: row.ai_analyzed_at ?? undefined,
    aiStatus: row.ai_status ?? undefined,
    aiError: row.ai_error ?? undefined,
  }
}

function mapNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    establishmentId: row.establishment_id,
    reviewId: row.review_id,
    type: row.type,
    title: row.title,
    body: row.body,
    severity: 'high',
    readAt: row.read_at ?? undefined,
    pushStatus: row.push_status,
    createdAt: row.created_at,
  }
}

async function functionErrorCode(error: unknown, payload: unknown): Promise<string> {
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
    return payload.error
  }
  if (error && typeof error === 'object' && 'context' in error && error.context instanceof Response) {
    try {
      const body = await error.context.clone().json() as { error?: unknown }
      if (typeof body.error === 'string') return body.error
    } catch { /* fall through */ }
  }
  return error instanceof Error ? error.message : 'UNKNOWN'
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(() => allowDemo ? demoState() : emptyState)
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured)
  const [dataLoading, setDataLoading] = useState(false)
  const [dataReady, setDataReady] = useState(allowDemo)
  const [dataError, setDataError] = useState<string | null>(() => !allowDemo && !isSupabaseConfigured ? 'Supabase n’est pas configuré pour ce déploiement.' : null)
  const [passwordRecovery, setPasswordRecovery] = useState(() => window.location.hash.includes('type=recovery'))
  const [monitoringIntervalHours, setMonitoringIntervalHours] = useState(12)
  const [establishments, setEstablishments] = useState(initial.establishments)
  const [reviews, setReviews] = useState(initial.reviews)
  const [notifications, setNotifications] = useState(initial.notifications)
  const [actions, setActions] = useState(initial.actions)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const demoMode = !authUser && allowDemo

  const pushToast = useCallback((text: string) => {
    const id = Date.now()
    setToasts((items) => [...items, { id, text }])
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 2800)
  }, [])

  const loadRealData = useCallback(async () => {
    if (!supabase) {
      setDataError('Supabase n’est pas configuré pour ce déploiement.')
      setDataReady(true)
      return
    }
    setDataLoading(true)
    setDataReady(false)
    setDataError(null)
    const [establishmentsResult, reviewsResult, notificationsResult, organizationResult] = await Promise.all([
      supabase.from('establishments').select('id,organization_id,name,address,google_maps_url,photo_url,rating,total_reviews,active,last_sync_at,sync_status').eq('active', true).order('created_at'),
      supabase.from('reviews').select('id,organization_id,establishment_id,external_review_id,author_name,rating,text,language,published_at,created_at,review_url,historical_import,status,ai_summary,ai_suggested_reply,ai_detected_language,ai_analyzed_at,ai_status,ai_error').order('published_at', { ascending: false, nullsFirst: false }),
      supabase.from('notifications').select('id,organization_id,user_id,review_id,establishment_id,type,title,body,read_at,push_status,created_at').order('created_at', { ascending: false }).limit(100),
      supabase.from('organizations').select('monitoring_interval_hours').limit(1).maybeSingle(),
    ])
    setDataLoading(false)
    setDataReady(true)
    if (establishmentsResult.error || reviewsResult.error || notificationsResult.error || organizationResult.error) {
      setEstablishments([])
      setReviews([])
      setNotifications([])
      setActions([])
      setDataError('Impossible de charger vos données Supabase. Vérifiez votre connexion puis réessayez.')
      return
    }
    setEstablishments((establishmentsResult.data as EstablishmentRow[]).map(mapEstablishment))
    setReviews((reviewsResult.data as ReviewRow[]).map(mapReview))
    setNotifications((notificationsResult.data as NotificationRow[]).map(mapNotification))
    setActions([])
    const organization = organizationResult.data as OrganizationRow | null
    if (organization?.monitoring_interval_hours) setMonitoringIntervalHours(organization.monitoring_interval_hours)
  }, [])

  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setAuthUser(data.session?.user ?? null)
      setAuthReady(true)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthUser(session?.user ?? null)
      setAuthReady(true)
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!authReady) return
    const timer = window.setTimeout(() => {
      if (authUser) {
        void loadRealData()
        return
      }
      if (allowDemo) {
        const state = demoState()
        setEstablishments(state.establishments)
        setReviews(state.reviews)
        setNotifications(state.notifications)
        setActions(state.actions)
      } else {
        setEstablishments([])
        setReviews([])
        setNotifications([])
        setActions([])
        setDataReady(true)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [authReady, authUser, loadRealData])

  useEffect(() => {
    if (demoMode) localStorage.setItem(STORAGE_KEY, JSON.stringify({ establishments, reviews, notifications, actions }))
  }, [demoMode, establishments, reviews, notifications, actions])

  useEffect(() => {
    if (!supabase || !authUser || demoMode) return
    const channel = supabase
      .channel(`notifications:${authUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${authUser.id}` }, () => {
        void loadRealData()
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [authUser, demoMode, loadRealData])

  const logAction = (reviewId: string, actionType: ReviewAction['actionType']) => {
    setActions((items) => [...items, { id: crypto.randomUUID(), reviewId, actionType, createdAt: new Date().toISOString() }])
  }

  const updateReviewStatus = (reviewId: string, status: ReviewStatus) => {
    setReviews((items) => items.map((review) => review.id === reviewId
      ? { ...review, status, requiresAction: status === 'to_process' }
      : review))
    if (!demoMode && supabase) {
      void supabase.from('reviews').update({ status }).eq('id', reviewId).then(({ error }) => {
        if (error) {
          pushToast('La modification n’a pas pu être enregistrée')
          void loadRealData()
        }
      })
    }
  }

  const markProcessed = (reviewId: string) => {
    updateReviewStatus(reviewId, 'processed')
    logAction(reviewId, 'marked_processed')
    pushToast('Avis marqué comme traité')
  }

  const reopenReview = (reviewId: string) => {
    updateReviewStatus(reviewId, 'to_process')
    logAction(reviewId, 'reopened')
    pushToast('Avis rouvert')
  }

  const generateResponse = async (reviewId: string) => {
    const review = reviews.find((item) => item.id === reviewId)
    if (!review) throw new Error('REVIEW_NOT_FOUND')
    if (demoMode) {
      await new Promise((resolve) => setTimeout(resolve, 650))
      const response = review.aiSuggestedReply ?? `Bonjour, merci d’avoir pris le temps de partager votre expérience. Nous sommes désolés qu’elle n’ait pas été à la hauteur de vos attentes et prenons votre retour au sérieux.`
      setReviews((items) => items.map((item) => item.id === reviewId ? { ...item, aiSuggestedReply: response, aiStatus: 'completed' } : item))
      logAction(reviewId, 'response_generated')
      return response
    }
    if (!supabase || !authUser) throw new Error('UNAUTHORIZED')
    const { data, error } = await supabase.functions.invoke<AnalyzePayload>('analyze-review', {
      body: { review_id: reviewId, regenerate: true },
    })
    if (error || !data?.ai_suggested_reply) throw new Error(await functionErrorCode(error, data))
    await loadRealData()
    return data.ai_suggested_reply
  }

  const markNotificationRead = async (id: string) => {
    const readAt = new Date().toISOString()
    setNotifications((items) => items.map((item) => item.id === id ? { ...item, readAt } : item))
    if (!demoMode && supabase) {
      const { error } = await supabase.from('notifications').update({ read_at: readAt }).eq('id', id).is('read_at', null)
      if (error) {
        pushToast('Impossible de marquer la notification comme lue')
        await loadRealData()
      }
    }
  }

  const markAllNotificationsRead = async () => {
    const readAt = new Date().toISOString()
    setNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt ?? readAt })))
    if (!demoMode && supabase) {
      const { error } = await supabase.from('notifications').update({ read_at: readAt }).is('read_at', null)
      if (error) {
        pushToast('Impossible de marquer les notifications comme lues')
        await loadRealData()
      }
    }
  }

  const resolveEstablishment = async (input: string): Promise<PlaceCandidate> => {
    if (demoMode) {
      const candidates = await mockProvider.resolvePlace(input)
      if (!candidates[0]) throw new Error('ESTABLISHMENT_NOT_FOUND')
      return candidates[0]
    }
    if (!supabase || !authUser) throw new Error('UNAUTHORIZED')
    const { data, error } = await supabase.functions.invoke<ResolvePayload>('resolve-establishment', { body: { input } })
    if (error || !data?.candidate) throw new Error(await functionErrorCode(error, data))
    return {
      placeRef: data.candidate.googleId,
      name: data.candidate.name,
      address: data.candidate.fullAddress,
      rating: data.candidate.rating,
      reviewCount: data.candidate.totalReviews,
      googleMapsUrl: data.candidate.locationLink ?? input,
      photoUrl: data.candidate.photo ?? undefined,
      confidence: 1,
    }
  }

  const addEstablishment = async (input: string, candidate: PlaceCandidate): Promise<AddEstablishmentResult> => {
    if (demoMode) {
      const establishment: Establishment = {
        id: crypto.randomUUID(),
        organizationId: seedEstablishments[0].organizationId,
        name: candidate.name,
        address: candidate.address,
        city: cityFromAddress(candidate.address),
        category: 'Établissement',
        googleMapsUrl: candidate.googleMapsUrl,
        photoUrl: candidate.photoUrl,
        currentRating: candidate.rating,
        currentReviewCount: candidate.reviewCount,
        isActive: true,
        syncEnabled: true,
        lastSyncedAt: new Date().toISOString(),
        syncStatus: 'ok',
      }
      setEstablishments((items) => [...items, establishment])
      return { establishmentId: establishment.id, inserted: 0, distribution: { '1': 0, '2': 0, '3': 0 } }
    }
    if (!supabase || !authUser) throw new Error('UNAUTHORIZED')
    const { data, error } = await supabase.functions.invoke<AddPayload>('add-establishment', {
      body: { query: input, confirmed: true, expectedGoogleId: candidate.placeRef },
    })
    if (error || !data?.establishmentId || !data.distribution) {
      throw new Error(await functionErrorCode(error, data))
    }
    await loadRealData()
    return {
      establishmentId: data.establishmentId,
      inserted: data.inserted ?? 0,
      distribution: data.distribution,
    }
  }

  const refreshEstablishment = async (id: string) => {
    setEstablishments((items) => items.map((item) => item.id === id ? { ...item, syncStatus: 'syncing' } : item))
    if (!demoMode && supabase) {
      const { error } = await supabase.functions.invoke('sync-google-reviews', { body: { establishmentId: id } })
      if (error) pushToast('Synchronisation impossible')
      await loadRealData()
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 700))
    setEstablishments((items) => items.map((item) => item.id === id ? { ...item, syncStatus: 'ok', lastSyncedAt: new Date().toISOString() } : item))
    pushToast('Avis actualisés')
  }

  const toggleMonitoring = (id: string) => setEstablishments((items) => items.map((item) => item.id === id ? { ...item, syncEnabled: !item.syncEnabled } : item))
  const removeEstablishment = (id: string) => {
    if (!demoMode) {
      pushToast('Suppression indisponible dans cette version')
      return
    }
    setEstablishments((items) => items.filter((item) => item.id !== id))
    setReviews((items) => items.filter((item) => item.establishmentId !== id))
    pushToast('Établissement supprimé')
  }

  const injectNegativeReview = () => {
    if (!demoMode) return ''
    const establishment = establishments[0]
    if (!establishment) return ''
    const id = crypto.randomUUID()
    const review: Review = {
      id, organizationId: establishment.organizationId, establishmentId: establishment.id, externalReviewId: `mock-${id}`,
      authorName: 'Alex M.', rating: 1, reviewText: "Nous avons attendu une heure et personne n'est venu nous expliquer la situation.",
      reviewLanguage: 'fr', publishedAt: new Date().toISOString(), sourceUrl: establishment.googleMapsUrl, isHistoricalImport: false,
      requiresAction: true, status: 'to_process', aiSummary: "Le client signale une attente d’une heure sans information de l’équipe.", aiSuggestedReply: "Bonjour, merci d’avoir partagé votre expérience. Nous sommes désolés pour cette longue attente sans information et prenons votre retour au sérieux.", aiDetectedLanguage: 'fr', aiAnalyzedAt: new Date().toISOString(), aiStatus: 'completed',
    }
    setReviews((items) => [review, ...items])
    setNotifications((items) => [{ id: crypto.randomUUID(), establishmentId: establishment.id, reviewId: id, type: 'new_negative_review', title: `Nouvel avis 1★ — ${establishment.name}`, body: "Le client signale un problème d'attente.", severity: 'high', createdAt: new Date().toISOString() }, ...items])
    pushToast('Nouvel avis négatif injecté')
    return id
  }

  const currentUser = useMemo(() => ({
    name: authUser?.user_metadata?.display_name ?? authUser?.email?.split('@')[0] ?? (demoMode ? 'Linh Nguyen' : 'Utilisateur'),
    email: authUser?.email ?? (demoMode ? 'linh@home-reviews.fr' : ''),
  }), [authUser, demoMode])

  const updateMonitoringInterval = async (hours: number) => {
    if (demoMode) {
      setMonitoringIntervalHours(hours)
      return
    }
    if (!supabase || !authUser) throw new Error('UNAUTHORIZED')
    const { error } = await supabase.rpc('set_monitoring_interval', { p_hours: hours })
    if (error) throw error
    setMonitoringIntervalHours(hours)
  }

  const completePasswordRecovery = async (password: string) => {
    if (!supabase || !authUser) throw new Error('RECOVERY_SESSION_MISSING')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
    setPasswordRecovery(false)
    window.location.hash = '/'
  }

  const value: AppContextValue = {
    establishments, reviews, notifications, actions, toasts, demoMode, authReady, isAuthenticated: Boolean(authUser), dataLoading, dataReady, dataError, passwordRecovery, monitoringIntervalHours, currentUser,
    plan: demoPlan, aiUsage: demoMode ? actions.filter((action) => action.actionType === 'response_generated').length + 38 : actions.filter((action) => action.actionType === 'response_generated').length,
    markProcessed, reopenReview, generateResponse, logAction, markNotificationRead, markAllNotificationsRead,
    resolveEstablishment, addEstablishment, refreshEstablishment, toggleMonitoring, removeEstablishment,
    injectNegativeReview, pushToast, retryData: loadRealData, updateMonitoringInterval, completePasswordRecovery,
  }
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside AppProvider')
  return context
}
