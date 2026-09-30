/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { demoPlan, seedEstablishments, seedNotifications, seedReviews } from '../data/mock-data'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { nextSyncAtFromLastSync } from '../lib/monitoring-schedule'
import { localizedReviewText } from '../lib/review-translation'
import { MockReviewProvider, type PlaceCandidate } from '../services/review-provider'
import type { AppNotification, Establishment, PreferredLanguage, Review, ReviewAction, ReviewStatus } from '../types/domain'

interface ToastMessage { id: number; text: string }

export interface AddEstablishmentResult {
  importJobId?: string
  status?: 'queued' | 'running' | 'retry' | 'completed' | 'failed'
  establishmentId?: string
  inserted: number
  distribution: { '1': number; '2': number; '3': number }
  importStatus?: 'completed' | 'failed'
  retryable?: boolean
  nextSyncAt?: string
  negativeReviewCount?: number
}

export interface InitialImportJob {
  id: string
  organizationId: string
  userId: string
  query: string
  expectedGoogleId: string
  establishmentId?: string
  status: 'queued' | 'running' | 'retry' | 'completed' | 'failed'
  reviewsTarget: number
  reviewsFetched: number
  reviewsInserted: number
  errorCode?: string
  candidate: {
    name?: string
    address?: string
    photoUrl?: string
    googleMapsUrl?: string
    rating?: number
    reviewCount?: number
  }
  result?: AddEstablishmentResult
  createdAt: string
  updatedAt: string
}

interface AppContextValue {
  establishments: Establishment[]
  initialImportJobs: InitialImportJob[]
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
  preferredLanguage: PreferredLanguage | null
  currentUser: { name: string; email: string; avatarUrl?: string; initials: string }
  plan: typeof demoPlan
  aiUsage: number
  markProcessed: (reviewId: string) => void
  reopenReview: (reviewId: string) => void
  generateResponse: (reviewId: string) => Promise<string>
  saveReplyDraft: (reviewId: string, text: string) => Promise<number>
  translateReply: (reviewId: string, draftVersion: number) => Promise<void>
  logAction: (reviewId: string, actionType: ReviewAction['actionType']) => void
  markNotificationRead: (notificationId: string) => Promise<void>
  markAllNotificationsRead: () => Promise<void>
  resolveEstablishment: (input: string) => Promise<PlaceCandidate>
  addEstablishment: (input: string, candidate: PlaceCandidate) => Promise<AddEstablishmentResult>
  retryEstablishmentImport: (importJobId: string) => Promise<void>
  acknowledgeInitialImport: (importJobId: string) => Promise<void>
  refreshInitialImports: () => Promise<void>
  refreshEstablishment: (id: string) => Promise<void>
  toggleMonitoring: (id: string) => void
  removeEstablishment: (id: string) => Promise<void>
  injectNegativeReview: () => string
  pushToast: (text: string) => void
  retryData: () => Promise<void>
  updateMonitoringInterval: (hours: number) => Promise<void>
  updatePreferredLanguage: (language: PreferredLanguage) => Promise<void>
  completePasswordRecovery: (password: string) => Promise<void>
  signOut: () => Promise<void>
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
  next_sync_at: string | null
  sync_status: 'pending' | 'syncing' | 'ok' | 'error'
}

interface InitialImportJobRow {
  id: string
  organization_id: string
  user_id: string
  query: string
  expected_google_id: string
  establishment_id: string | null
  status: 'queued' | 'running' | 'retry' | 'completed' | 'failed'
  reviews_target: number
  reviews_fetched: number
  reviews_inserted: number
  error_code: string | null
  candidate_snapshot: InitialImportJob['candidate'] | null
  result: AddEstablishmentResult | null
  created_at: string
  updated_at: string
}

interface ReviewRow {
  id: string
  organization_id: string
  establishment_id: string
  external_review_id: string
  author_name: string
  rating: number
  text: string
  original_text: string
  original_language: string | null
  review_translations: Array<{ language: PreferredLanguage; translated_text: string }> | null
  language: string | null
  published_at: string | null
  created_at: string
  review_url: string | null
  historical_import: boolean
  status: ReviewStatus
  ai_summary: string | null
  ai_suggested_reply: string | null
  ai_suggested_reply_language: string | null
  reply_draft_text: string | null
  reply_draft_language: string | null
  reply_draft_updated_at: string | null
  reply_draft_version: number
  translated_reply_text: string | null
  translated_reply_language: string | null
  translated_from_draft_updated_at: string | null
  translated_from_draft_version: number | null
  translated_reply_at: string | null
  ai_detected_language: string | null
  ai_analyzed_at: string | null
  ai_status: 'pending' | 'completed' | 'failed' | null
  ai_error: string | null
  review_reply_drafts: LocalizedReplyDraftRow[] | null
}

interface LocalizedReplyDraftRow {
  language: PreferredLanguage
  ai_summary: string | null
  ai_suggested_reply: string | null
  draft_text: string | null
  draft_updated_at: string | null
  draft_version: number
  translated_reply_text: string | null
  translated_reply_language: string | null
  translated_from_draft_version: number | null
  translated_at: string | null
  ai_status: 'pending' | 'processing' | 'completed' | 'failed'
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
  reply_draft_text?: string
  reply_draft_language?: string
  reply_draft_updated_at?: string
  reply_draft_version?: number
  error?: string
}

interface TranslateReplyPayload {
  translation_required?: boolean
  translated_reply_text?: string
  translated_reply_language?: string
  translated_from_draft_updated_at?: string
  translated_from_draft_version?: number
  translated_reply_at?: string
  error?: string
}

interface SaveReplyDraftPayload {
  reply_draft_text?: string
  reply_draft_language?: string
  reply_draft_updated_at?: string
  reply_draft_version?: number
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
  importStatus?: 'completed' | 'failed'
  retryable?: boolean
  nextSyncAt?: string
  negativeReviewCount?: number
  error?: string
}

interface RetryImportPayload {
  negativeReviewCount?: number
  nextSyncAt?: string
  error?: string
}

interface OrganizationRow {
  monitoring_interval_hours: number
}

interface ProfileRow {
  preferred_language: PreferredLanguage | null
}

const AppContext = createContext<AppContextValue | null>(null)
const mockProvider = new MockReviewProvider()
const STORAGE_KEY = 'home-reviews-demo-v1'
const allowDemo = import.meta.env.DEV || import.meta.env.MODE === 'test' || import.meta.env.VITE_DEMO_MODE === 'true'
const REVIEW_SELECT = 'id,organization_id,establishment_id,external_review_id,author_name,rating,text,original_text,original_language,language,published_at,created_at,review_url,historical_import,status,ai_summary,ai_suggested_reply,ai_suggested_reply_language,reply_draft_text,reply_draft_language,reply_draft_updated_at,reply_draft_version,translated_reply_text,translated_reply_language,translated_from_draft_updated_at,translated_from_draft_version,translated_reply_at,ai_detected_language,ai_analyzed_at,ai_status,ai_error,review_translations(language,translated_text),review_reply_drafts(language,ai_summary,ai_suggested_reply,draft_text,draft_updated_at,draft_version,translated_reply_text,translated_reply_language,translated_from_draft_version,translated_at,ai_status,ai_error)'
const REVIEW_LOAD_PAGE_SIZE = 500

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
    nextSyncAt: row.next_sync_at ?? undefined,
    syncStatus: row.sync_status,
  }
}

function mapInitialImportJob(row: InitialImportJobRow): InitialImportJob {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    query: row.query,
    expectedGoogleId: row.expected_google_id,
    establishmentId: row.establishment_id ?? undefined,
    status: row.status,
    reviewsTarget: row.reviews_target,
    reviewsFetched: row.reviews_fetched,
    reviewsInserted: row.reviews_inserted,
    errorCode: row.error_code ?? undefined,
    candidate: row.candidate_snapshot ?? {},
    result: row.result ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapReview(row: ReviewRow, preferredLanguage: PreferredLanguage): Review {
  const status = row.rating <= 3 && row.status === 'new' ? 'to_process' : row.status
  const localized = localizedReviewText(row.original_text || row.text, row.review_translations, preferredLanguage)
  const localizedReply = row.review_reply_drafts?.find((draft) => draft.language === preferredLanguage)
  const hasLocalizedReply = Boolean(localizedReply?.draft_text && localizedReply.ai_status === 'completed')
  return {
    id: row.id,
    organizationId: row.organization_id,
    establishmentId: row.establishment_id,
    externalReviewId: row.external_review_id,
    authorName: row.author_name,
    rating: row.rating,
    reviewText: localized.displayText,
    originalText: localized.originalText,
    translatedText: localized.translatedText,
    reviewLanguage: row.original_language ?? row.language ?? 'fr',
    publishedAt: row.published_at ?? row.created_at,
    sourceUrl: row.review_url ?? '',
    isHistoricalImport: row.historical_import,
    requiresAction: row.rating <= 3,
    status,
    aiSummary: localizedReply?.ai_summary ?? undefined,
    aiSuggestedReply: localizedReply?.ai_suggested_reply ?? undefined,
    aiSuggestedReplyLanguage: localizedReply?.language,
    replyDraftText: localizedReply?.draft_text ?? undefined,
    replyDraftLanguage: localizedReply?.language,
    replyDraftUpdatedAt: localizedReply?.draft_updated_at ?? undefined,
    replyDraftVersion: localizedReply?.draft_version ?? 0,
    translatedReplyText: localizedReply?.translated_reply_text ?? undefined,
    translatedReplyLanguage: localizedReply?.translated_reply_language ?? undefined,
    translatedFromDraftVersion: localizedReply?.translated_from_draft_version ?? undefined,
    translatedReplyAt: localizedReply?.translated_at ?? undefined,
    hasLocalizedReply,
    hasLegacyCompletedAnalysis: row.ai_status === 'completed',
    aiDetectedLanguage: row.ai_detected_language ?? undefined,
    aiAnalyzedAt: row.ai_analyzed_at ?? undefined,
    aiStatus: localizedReply?.ai_status ?? (row.ai_status === 'completed' ? 'pending' : row.ai_status ?? undefined),
    aiError: localizedReply?.ai_error ?? undefined,
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

async function fetchAllReviewRows() {
  if (!supabase) return { data: [] as ReviewRow[], error: new Error('SUPABASE_NOT_CONFIGURED') }
  const rows: ReviewRow[] = []
  for (let from = 0; ; from += REVIEW_LOAD_PAGE_SIZE) {
    const result = await supabase
      .from('reviews')
      .select(REVIEW_SELECT)
      .order('published_at', { ascending: false, nullsFirst: false })
      .range(from, from + REVIEW_LOAD_PAGE_SIZE - 1)
    if (result.error) return { data: [] as ReviewRow[], error: result.error }
    rows.push(...(result.data as ReviewRow[]))
    if (result.data.length < REVIEW_LOAD_PAGE_SIZE) return { data: rows, error: null }
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
  const [preferredLanguage, setPreferredLanguage] = useState<PreferredLanguage | null>(allowDemo ? 'fr' : null)
  const [establishments, setEstablishments] = useState(initial.establishments)
  const [initialImportJobs, setInitialImportJobs] = useState<InitialImportJob[]>([])
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

  const loadRealData = useCallback(async (options?: { background?: boolean }) => {
    const background = options?.background === true
    if (!supabase) {
      setDataError('Supabase n’est pas configuré pour ce déploiement.')
      setDataReady(true)
      return
    }
    if (!background) {
      setDataLoading(true)
      setDataReady(false)
      setDataError(null)
    }

    const [establishmentsResult, reviewsResult, notificationsResult, organizationResult, profileResult, initialImportsResult] = await Promise.all([
      supabase.from('establishments').select('id,organization_id,name,address,google_maps_url,photo_url,rating,total_reviews,active,last_sync_at,next_sync_at,sync_status').eq('active', true).order('created_at'),
      fetchAllReviewRows(),
      supabase.from('notifications').select('id,organization_id,user_id,review_id,establishment_id,type,title,body,read_at,push_status,created_at').order('created_at', { ascending: false }).limit(100),
      supabase.from('organizations').select('monitoring_interval_hours').limit(1).maybeSingle(),
      supabase.from('profiles').select('preferred_language').eq('user_id', authUser?.id ?? '').maybeSingle(),
      supabase.from('initial_import_jobs').select('id,organization_id,user_id,query,expected_google_id,establishment_id,status,reviews_target,reviews_fetched,reviews_inserted,error_code,candidate_snapshot,result,created_at,updated_at').is('acknowledged_at', null).order('created_at', { ascending: false }).limit(10),
    ])
    if (!background) {
      setDataLoading(false)
      setDataReady(true)
    }
    if (establishmentsResult.error || reviewsResult.error || notificationsResult.error || organizationResult.error || profileResult.error || initialImportsResult.error) {
      if (background) {
        pushToast('Les données seront actualisées à la prochaine ouverture.')
      } else {
        setEstablishments([])
        setReviews([])
        setNotifications([])
        setActions([])
        setDataError('Impossible de charger vos données Supabase. Vérifiez votre connexion puis réessayez.')
      }
      return
    }
    setEstablishments((establishmentsResult.data as EstablishmentRow[]).map(mapEstablishment))
    setInitialImportJobs((initialImportsResult.data as InitialImportJobRow[]).map(mapInitialImportJob))
    const profile = profileResult.data as ProfileRow | null
    const language = profile?.preferred_language === 'vi' ? 'vi' : 'fr'
    setPreferredLanguage(profile?.preferred_language ?? null)
    setReviews((reviewsResult.data as ReviewRow[]).map((row) => mapReview(row, language)))
    setNotifications((notificationsResult.data as NotificationRow[]).map(mapNotification))
    setActions([])
    const organization = organizationResult.data as OrganizationRow | null
    if (organization?.monitoring_interval_hours) setMonitoringIntervalHours(organization.monitoring_interval_hours)
  }, [authUser?.id, pushToast])

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
    const client = supabase
    const channel = client
      .channel(`notifications:${authUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${authUser.id}` }, () => {
        void loadRealData()
      })
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [authUser, demoMode, loadRealData])

  useEffect(() => {
    if (!supabase || !authUser || demoMode) return
    const client = supabase
    const channel = client
      .channel(`initial-imports:${authUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'initial_import_jobs', filter: `user_id=eq.${authUser.id}` }, () => {
        void loadRealData({ background: true })
      })
      .subscribe()
    const refreshOnForeground = () => {
      if (document.visibilityState === 'visible') void loadRealData({ background: true })
    }
    document.addEventListener('visibilitychange', refreshOnForeground)
    window.addEventListener('focus', refreshOnForeground)
    return () => {
      document.removeEventListener('visibilitychange', refreshOnForeground)
      window.removeEventListener('focus', refreshOnForeground)
      void client.removeChannel(channel)
    }
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
      const now = new Date().toISOString()
      setReviews((items) => items.map((item) => item.id === reviewId ? {
        ...item,
        aiSuggestedReply: response,
        aiSuggestedReplyLanguage: preferredLanguage ?? 'fr',
        replyDraftText: response,
        replyDraftLanguage: preferredLanguage ?? 'fr',
        replyDraftUpdatedAt: now,
        replyDraftVersion: (item.replyDraftVersion ?? 0) + 1,
        aiStatus: 'completed',
      } : item))
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

  const saveReplyDraft = async (reviewId: string, text: string) => {
    const review = reviews.find((item) => item.id === reviewId)
    if (!review) throw new Error('REVIEW_NOT_FOUND')
    if (demoMode) {
      const updatedAt = new Date().toISOString()
      const version = (review.replyDraftVersion ?? 0) + 1
      setReviews((items) => items.map((item) => item.id === reviewId ? {
        ...item,
        replyDraftText: text,
        replyDraftLanguage: preferredLanguage ?? 'fr',
        replyDraftUpdatedAt: updatedAt,
        replyDraftVersion: version,
      } : item))
      return version
    }
    if (!supabase || !authUser) throw new Error('UNAUTHORIZED')
    const { data, error } = await supabase.functions.invoke<SaveReplyDraftPayload>('save-reply-draft', {
      body: { review_id: reviewId, draft_text: text },
    })
    if (error || !data?.reply_draft_text && data?.reply_draft_text !== '') {
      throw new Error(await functionErrorCode(error, data))
    }
    const saved = data
    setReviews((items) => items.map((item) => item.id === reviewId ? {
      ...item,
      replyDraftText: saved.reply_draft_text,
      replyDraftLanguage: saved.reply_draft_language ?? preferredLanguage ?? 'fr',
      replyDraftUpdatedAt: saved.reply_draft_updated_at,
      replyDraftVersion: saved.reply_draft_version ?? (item.replyDraftVersion ?? 0) + 1,
    } : item))
    return saved.reply_draft_version ?? (review.replyDraftVersion ?? 0) + 1
  }

  const translateReply = async (reviewId: string, draftVersion: number) => {
    if (demoMode) {
      const review = reviews.find((item) => item.id === reviewId)
      if (!review?.replyDraftText) throw new Error('REPLY_DRAFT_REQUIRED')
      const translatedAt = new Date().toISOString()
      setReviews((items) => items.map((item) => item.id === reviewId ? {
        ...item,
        translatedReplyText: item.replyDraftText,
        translatedReplyLanguage: item.reviewLanguage,
        translatedFromDraftUpdatedAt: item.replyDraftUpdatedAt,
        translatedFromDraftVersion: item.replyDraftVersion,
        translatedReplyAt: translatedAt,
      } : item))
      return
    }
    if (!supabase || !authUser) throw new Error('UNAUTHORIZED')
    const { data, error } = await supabase.functions.invoke<TranslateReplyPayload>('translate-reply', {
      body: { review_id: reviewId, draft_version: draftVersion },
    })
    if (error || !data) throw new Error(await functionErrorCode(error, data))
    if (data.translation_required === false) return
    if (!data.translated_reply_text) throw new Error(data.error ?? 'REPLY_TRANSLATION_FAILED')
    setReviews((items) => items.map((item) => item.id === reviewId ? {
      ...item,
      translatedReplyText: data.translated_reply_text,
      translatedReplyLanguage: data.translated_reply_language,
      translatedFromDraftUpdatedAt: data.translated_from_draft_updated_at,
      translatedFromDraftVersion: data.translated_from_draft_version,
      translatedReplyAt: data.translated_reply_at,
    } : item))
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
        nextSyncAt: nextSyncAtFromLastSync(undefined, monitoringIntervalHours),
        syncStatus: 'ok',
      }
      setEstablishments((items) => [...items, establishment])
      return { status: 'completed', establishmentId: establishment.id, inserted: 0, distribution: { '1': 0, '2': 0, '3': 0 } }
    }
    if (!supabase || !authUser) throw new Error('UNAUTHORIZED')
    const { data, error } = await supabase.functions.invoke<AddPayload>('add-establishment', {
      body: {
        query: input,
        confirmed: true,
        expectedGoogleId: candidate.placeRef,
        candidate,
      },
    })
    if (error || !data?.importJobId || !data.status) {
      throw new Error(await functionErrorCode(error, data))
    }
    await loadRealData({ background: true })
    return { importJobId: data.importJobId, status: data.status }
  }

  const refreshInitialImports = useCallback(async () => {
    await loadRealData({ background: true })
  }, [loadRealData])

  const retryEstablishmentImport = async (importJobId: string) => {
    if (!supabase || !authUser) throw new Error('UNAUTHORIZED')
    const { data, error } = await supabase.functions.invoke<RetryImportPayload>('retry-establishment-import', {
      body: { importJobId },
    })
    if (error || !data?.importJobId) throw new Error(await functionErrorCode(error, data))
    await loadRealData({ background: true })
  }

  const acknowledgeInitialImport = async (importJobId: string) => {
    if (demoMode) {
      setInitialImportJobs((items) => items.filter((item) => item.id !== importJobId))
      return
    }
    if (!supabase || !authUser) throw new Error('UNAUTHORIZED')
    const { data, error } = await supabase.rpc('acknowledge_initial_import_job', { p_job_id: importJobId })
    if (error || data !== true) throw error ?? new Error('IMPORT_ACKNOWLEDGE_FAILED')
    setInitialImportJobs((items) => items.filter((item) => item.id !== importJobId))
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
    setEstablishments((items) => items.map((item) => {
      if (item.id !== id) return item
      const lastSyncedAt = new Date().toISOString()
      return { ...item, syncStatus: 'ok', lastSyncedAt, nextSyncAt: nextSyncAtFromLastSync(lastSyncedAt, monitoringIntervalHours) }
    }))
    pushToast('Avis actualisés')
  }

  const toggleMonitoring = (id: string) => setEstablishments((items) => items.map((item) => item.id === id ? { ...item, syncEnabled: !item.syncEnabled } : item))
  const removeEstablishment = async (id: string) => {
    const removedReviewIds = new Set(reviews.filter((item) => item.establishmentId === id).map((item) => item.id))
    if (!demoMode) {
      if (!supabase || !authUser) throw new Error('UNAUTHORIZED')
      const { data, error } = await supabase
        .from('establishments')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error('ESTABLISHMENT_NOT_FOUND_OR_FORBIDDEN')
    }
    setEstablishments((items) => items.filter((item) => item.id !== id))
    setReviews((items) => items.filter((item) => item.establishmentId !== id))
    setNotifications((items) => items.filter((item) => item.establishmentId !== id))
    setActions((items) => items.filter((item) => !removedReviewIds.has(item.reviewId)))
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
      originalText: "Nous avons attendu une heure et personne n'est venu nous expliquer la situation.",
      requiresAction: true, status: 'to_process', aiSummary: "Le client signale une attente d’une heure sans information de l’équipe.", aiSuggestedReply: "Bonjour, merci d’avoir partagé votre expérience. Nous sommes désolés pour cette longue attente sans information et prenons votre retour au sérieux.", aiDetectedLanguage: 'fr', aiAnalyzedAt: new Date().toISOString(), aiStatus: 'completed',
    }
    setReviews((items) => [review, ...items])
    setNotifications((items) => [{ id: crypto.randomUUID(), establishmentId: establishment.id, reviewId: id, type: 'new_negative_review', title: `Nouvel avis 1★ — ${establishment.name}`, body: "Le client signale un problème d'attente.", severity: 'high', createdAt: new Date().toISOString() }, ...items])
    pushToast('Nouvel avis négatif injecté')
    return id
  }

  const currentUser = useMemo(() => {
    const metadata = authUser?.user_metadata ?? {}
    const name = metadata.full_name ?? metadata.name ?? metadata.display_name ?? authUser?.email?.split('@')[0] ?? (demoMode ? 'Linh Nguyen' : 'Utilisateur')
    const initials = String(name).split(/\\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'HR'
    return {
      name: String(name),
      email: authUser?.email ?? (demoMode ? 'linh@home-reviews.fr' : ''),
      avatarUrl: metadata.avatar_url ?? metadata.picture ?? undefined,
      initials,
    }
  }, [authUser, demoMode])

  const updateMonitoringInterval = async (hours: number) => {
    if (demoMode) {
      setMonitoringIntervalHours(hours)
      setEstablishments((items) => items.map((item) => item.isActive
        ? { ...item, nextSyncAt: nextSyncAtFromLastSync(item.lastSyncedAt, hours) }
        : item))
      return
    }
    if (!supabase || !authUser) throw new Error('UNAUTHORIZED')
    const { error } = await supabase.rpc('set_monitoring_interval', { p_hours: hours })
    if (error) throw error
    setMonitoringIntervalHours(hours)
    await loadRealData({ background: true })
  }

  const updatePreferredLanguage = async (language: PreferredLanguage) => {
    if (demoMode) {
      setPreferredLanguage(language)
      return
    }
    if (!supabase || !authUser) throw new Error('UNAUTHORIZED')
    const { error } = await supabase
      .from('profiles')
      .update({ preferred_language: language })
      .eq('user_id', authUser.id)
    if (error) throw error
    setPreferredLanguage(language)
    await loadRealData({ background: true })
  }

  const signOut = async () => {
    if (!supabase) return
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) throw error
    setEstablishments([])
    setReviews([])
    setNotifications([])
    setActions([])
    setPreferredLanguage(null)
    setDataReady(true)
  }

  const completePasswordRecovery = async (password: string) => {
    if (!supabase || !authUser) throw new Error('RECOVERY_SESSION_MISSING')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
    setPasswordRecovery(false)
    window.location.hash = '/'
  }

  const value: AppContextValue = {
    establishments, initialImportJobs, reviews, notifications, actions, toasts, demoMode, authReady, isAuthenticated: Boolean(authUser), dataLoading, dataReady, dataError, passwordRecovery, monitoringIntervalHours, preferredLanguage, currentUser,
    plan: demoPlan, aiUsage: demoMode ? actions.filter((action) => action.actionType === 'response_generated').length + 38 : actions.filter((action) => action.actionType === 'response_generated').length,
    markProcessed, reopenReview, generateResponse, saveReplyDraft, translateReply, logAction, markNotificationRead, markAllNotificationsRead,
    resolveEstablishment, addEstablishment, retryEstablishmentImport, acknowledgeInitialImport, refreshInitialImports, refreshEstablishment, toggleMonitoring, removeEstablishment,
    injectNegativeReview, pushToast, retryData: loadRealData, updateMonitoringInterval, updatePreferredLanguage, completePasswordRecovery, signOut,
  }
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside AppProvider')
  return context
}
