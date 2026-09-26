export type ReviewStatus = 'new' | 'to_process' | 'processed' | 'ignored'
export type Urgency = 'low' | 'medium' | 'high' | 'critical'
export type Category = 'waiting_time' | 'service' | 'staff' | 'product_quality' | 'cleanliness' | 'price' | 'reservation' | 'delivery' | 'availability' | 'billing' | 'other'

export interface Establishment {
  id: string
  organizationId: string
  name: string
  address: string
  city: string
  category: string
  googleMapsUrl: string
  photoUrl?: string
  currentRating: number
  currentReviewCount: number
  isActive: boolean
  syncEnabled: boolean
  lastSyncedAt: string
  syncStatus: 'pending' | 'syncing' | 'ok' | 'warning' | 'error'
}

export interface ReviewAnalysis {
  requiresAction: boolean
  sentiment: 'negative' | 'neutral' | 'positive'
  primaryCategory: Category
  secondaryCategories: Category[]
  urgency: Urgency
  summary: string
  keyPoints: string[]
  suggestedResponse?: string
  responseLanguage: string
  analysisStatus: 'pending' | 'ok' | 'error'
}

export interface Review {
  id: string
  organizationId: string
  establishmentId: string
  externalReviewId: string
  authorName: string
  rating: number
  reviewText: string
  reviewLanguage: string
  publishedAt: string
  sourceUrl: string
  isHistoricalImport: boolean
  requiresAction: boolean
  status: ReviewStatus
  analysis?: ReviewAnalysis
}

export interface AppNotification {
  id: string
  establishmentId?: string
  reviewId?: string
  type: string
  title: string
  body: string
  severity: 'info' | 'warning' | 'high' | 'critical'
  readAt?: string
  createdAt: string
}

export interface ReviewAction {
  id: string
  reviewId: string
  actionType: 'opened' | 'response_generated' | 'response_copied' | 'opened_google_maps' | 'marked_processed' | 'reopened' | 'ignored'
  createdAt: string
}

export interface PlanEntitlement {
  planKey: string
  maxEstablishments: number
  syncIntervalMinutes: number
  maxAiResponsesMonth: number
  maxMembers: number
}
