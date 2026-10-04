export type ReviewStatus = 'new' | 'to_process' | 'processed' | 'ignored'
export type AiStatus = 'pending' | 'processing' | 'completed' | 'failed'

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
  nextSyncAt?: string
  syncStatus: 'pending' | 'syncing' | 'ok' | 'warning' | 'error'
}

export interface Review {
  id: string
  organizationId: string
  establishmentId: string
  externalReviewId: string
  authorName: string
  rating: number
  reviewText: string
  originalText?: string
  translatedText?: string
  reviewLanguage: string
  publishedAt: string
  hasGooglePublicationDate?: boolean
  sourceUrl: string
  isHistoricalImport: boolean
  requiresAction: boolean
  hasNegativeFeedback?: boolean
  negativeFeedbackSummary?: string
  negativeFeedbackCheckedAt?: string
  status: ReviewStatus
  reviewDetailedRating?: Record<string, unknown> | null
  reviewContext?: Record<string, unknown> | null
  aiSuggestedReply?: string
  aiSuggestedReplyLanguage?: string
  replyDraftText?: string
  replyDraftLanguage?: string
  replyDraftUpdatedAt?: string
  replyDraftVersion?: number
  translatedReplyText?: string
  translatedReplyLanguage?: string
  translatedFromDraftUpdatedAt?: string
  translatedFromDraftVersion?: number
  translatedReplyAt?: string
  hasLocalizedReply?: boolean
  hasLegacyCompletedAnalysis?: boolean
  aiDetectedLanguage?: string
  aiAnalyzedAt?: string
  aiStatus?: AiStatus
  aiError?: string
}

export type PreferredLanguage = 'fr' | 'vi'

export interface AppNotification {
  id: string
  organizationId?: string
  userId?: string
  establishmentId?: string
  reviewId?: string
  type: string
  title: string
  body: string
  severity: 'info' | 'warning' | 'high' | 'critical'
  readAt?: string
  pushStatus?: 'pending' | 'sent' | 'failed' | 'skipped'
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
