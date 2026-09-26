/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { demoPlan, seedEstablishments, seedNotifications, seedReviews } from '../data/mock-data'
import type { AppNotification, Establishment, Review, ReviewAction } from '../types/domain'
import type { PlaceCandidate } from '../services/review-provider'

interface ToastMessage { id: number; text: string }

interface AppContextValue {
  establishments: Establishment[]
  reviews: Review[]
  notifications: AppNotification[]
  actions: ReviewAction[]
  toasts: ToastMessage[]
  demoMode: boolean
  currentUser: { name: string; email: string }
  plan: typeof demoPlan
  aiUsage: number
  markProcessed: (reviewId: string) => void
  reopenReview: (reviewId: string) => void
  generateResponse: (reviewId: string) => Promise<string>
  logAction: (reviewId: string, actionType: ReviewAction['actionType']) => void
  markNotificationRead: (notificationId: string) => void
  markAllNotificationsRead: () => void
  addEstablishment: (candidate: PlaceCandidate) => Establishment
  refreshEstablishment: (id: string) => Promise<void>
  toggleMonitoring: (id: string) => void
  removeEstablishment: (id: string) => void
  injectNegativeReview: () => string
  pushToast: (text: string) => void
}

const AppContext = createContext<AppContextValue | null>(null)

const STORAGE_KEY = 'home-reviews-demo-v1'
type StoredState = { establishments: Establishment[]; reviews: Review[]; notifications: AppNotification[]; actions: ReviewAction[] }

function getInitialState(): StoredState {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) return JSON.parse(stored) as StoredState
    } catch { /* use seed */ }
  }
  return { establishments: seedEstablishments, reviews: seedReviews, notifications: seedNotifications, actions: [] }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(() => getInitialState())
  const [establishments, setEstablishments] = useState(initial.establishments)
  const [reviews, setReviews] = useState(initial.reviews)
  const [notifications, setNotifications] = useState(initial.notifications)
  const [actions, setActions] = useState(initial.actions)
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ establishments, reviews, notifications, actions }))
  }, [establishments, reviews, notifications, actions])

  const pushToast = (text: string) => {
    const id = Date.now()
    setToasts((items) => [...items, { id, text }])
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 2800)
  }

  const logAction = (reviewId: string, actionType: ReviewAction['actionType']) => {
    setActions((items) => [...items, { id: crypto.randomUUID(), reviewId, actionType, createdAt: new Date().toISOString() }])
  }

  const markProcessed = (reviewId: string) => {
    setReviews((items) => items.map((review) => review.id === reviewId ? { ...review, status: 'processed', requiresAction: false } : review))
    logAction(reviewId, 'marked_processed')
    pushToast('Avis marqué comme traité')
  }

  const reopenReview = (reviewId: string) => {
    setReviews((items) => items.map((review) => review.id === reviewId ? { ...review, status: 'to_process', requiresAction: true } : review))
    logAction(reviewId, 'reopened')
    pushToast('Avis rouvert')
  }

  const generateResponse = async (reviewId: string) => {
    await new Promise((resolve) => setTimeout(resolve, 650))
    const review = reviews.find((item) => item.id === reviewId)
    if (!review) throw new Error('REVIEW_NOT_FOUND')
    const response = `Bonjour ${review.authorName.split(' ')[0]}, merci d’avoir pris le temps de partager votre expérience. Nous sommes désolés qu’elle n’ait pas été à la hauteur de vos attentes. Votre retour a été transmis à notre équipe afin que nous puissions comprendre la situation et nous améliorer. Nous espérons avoir l’occasion de vous accueillir à nouveau dans de meilleures conditions.`
    setReviews((items) => items.map((item) => item.id === reviewId && item.analysis ? { ...item, analysis: { ...item.analysis, suggestedResponse: response } } : item))
    logAction(reviewId, 'response_generated')
    return response
  }

  const markNotificationRead = (id: string) => setNotifications((items) => items.map((item) => item.id === id ? { ...item, readAt: new Date().toISOString() } : item))
  const markAllNotificationsRead = () => setNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })))

  const addEstablishment = (candidate: PlaceCandidate) => {
    const establishment: Establishment = {
      id: crypto.randomUUID(), organizationId: seedEstablishments[0].organizationId, name: candidate.name, address: candidate.address,
      city: candidate.address.split(',').at(-1)?.trim() ?? '', category: 'Établissement', googleMapsUrl: candidate.googleMapsUrl,
      photoUrl: candidate.photoUrl, currentRating: candidate.rating, currentReviewCount: candidate.reviewCount,
      isActive: true, syncEnabled: true, lastSyncedAt: new Date().toISOString(), syncStatus: 'ok',
    }
    setEstablishments((items) => [...items, establishment])
    pushToast('Surveillance activée')
    return establishment
  }

  const refreshEstablishment = async (id: string) => {
    setEstablishments((items) => items.map((item) => item.id === id ? { ...item, syncStatus: 'syncing' } : item))
    await new Promise((resolve) => setTimeout(resolve, 700))
    setEstablishments((items) => items.map((item) => item.id === id ? { ...item, syncStatus: 'ok', lastSyncedAt: new Date().toISOString() } : item))
    pushToast('Avis actualisés')
  }

  const toggleMonitoring = (id: string) => setEstablishments((items) => items.map((item) => item.id === id ? { ...item, syncEnabled: !item.syncEnabled } : item))
  const removeEstablishment = (id: string) => {
    setEstablishments((items) => items.filter((item) => item.id !== id))
    setReviews((items) => items.filter((item) => item.establishmentId !== id))
    pushToast('Établissement supprimé')
  }

  const injectNegativeReview = () => {
    const establishment = establishments[0]
    const id = crypto.randomUUID()
    const review: Review = {
      id, organizationId: establishment.organizationId, establishmentId: establishment.id, externalReviewId: `mock-${id}`,
      authorName: 'Alex M.', rating: 1, reviewText: "Nous avons attendu une heure et personne n'est venu nous expliquer la situation.",
      reviewLanguage: 'fr', publishedAt: new Date().toISOString(), sourceUrl: establishment.googleMapsUrl, isHistoricalImport: false,
      requiresAction: true, status: 'to_process', analysis: { requiresAction: true, sentiment: 'negative', primaryCategory: 'waiting_time', secondaryCategories: ['service'], urgency: 'high', summary: "Le client signale une attente d'une heure sans information de l'équipe.", keyPoints: ["Attente d'une heure", "Manque d'information"], responseLanguage: 'fr', analysisStatus: 'ok' },
    }
    setReviews((items) => [review, ...items])
    setNotifications((items) => [{ id: crypto.randomUUID(), establishmentId: establishment.id, reviewId: id, type: 'new_negative_review', title: `Nouvel avis 1★ — ${establishment.name}`, body: "Le client signale un problème d'attente.", severity: 'high', createdAt: new Date().toISOString() }, ...items])
    pushToast('Nouvel avis négatif injecté')
    return id
  }

  const value: AppContextValue = {
    establishments, reviews, notifications, actions, toasts,
    demoMode: import.meta.env.VITE_DEMO_MODE !== 'false', currentUser: { name: 'Linh Nguyen', email: 'linh@home-reviews.fr' },
    plan: demoPlan, aiUsage: actions.filter((action) => action.actionType === 'response_generated').length + 38,
    markProcessed, reopenReview, generateResponse, logAction, markNotificationRead, markAllNotificationsRead,
    addEstablishment, refreshEstablishment, toggleMonitoring, removeEstablishment, injectNegativeReview, pushToast,
  }
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside AppProvider')
  return context
}
