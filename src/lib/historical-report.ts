import type { PreferredLanguage, Review } from '../types/domain'

export interface HistoricalReport {
  id: string
  organizationId: string
  establishmentId: string
  preferredLanguage: PreferredLanguage
  periodStart: string
  periodEnd: string
  googleRating: number | null
  googleTotalReviews: number | null
  storedReviewsCount: number
  negativeReviewsCount: number
  negativeRate: number
  readyRepliesCount: number
  ratingCounts: Record<1 | 2 | 3 | 4 | 5, number>
  dataComplete: boolean
  aiHistoricalSummary: string | null
  aiStatus: 'generating' | 'completed' | 'failed'
  aiError: string | null
  generatedAt: string | null
}

export interface HistoricalReportRow {
  id: string
  organization_id: string
  establishment_id: string
  preferred_language: PreferredLanguage
  period_start: string
  period_end: string
  google_rating: number | string | null
  google_total_reviews: number | null
  stored_reviews_count: number
  negative_reviews_count: number
  negative_rate: number | string
  ready_replies_count: number
  rating_1_count: number
  rating_2_count: number
  rating_3_count: number
  rating_4_count: number
  rating_5_count: number
  data_complete: boolean
  ai_historical_summary: string | null
  ai_status: 'generating' | 'completed' | 'failed'
  ai_error: string | null
  generated_at: string | null
}

export function mapHistoricalReport(row: HistoricalReportRow): HistoricalReport {
  return {
    id: row.id,
    organizationId: row.organization_id,
    establishmentId: row.establishment_id,
    preferredLanguage: row.preferred_language,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    googleRating: row.google_rating === null ? null : Number(row.google_rating),
    googleTotalReviews: row.google_total_reviews,
    storedReviewsCount: row.stored_reviews_count,
    negativeReviewsCount: row.negative_reviews_count,
    negativeRate: Number(row.negative_rate),
    readyRepliesCount: row.ready_replies_count,
    ratingCounts: {
      1: row.rating_1_count,
      2: row.rating_2_count,
      3: row.rating_3_count,
      4: row.rating_4_count,
      5: row.rating_5_count,
    },
    dataComplete: row.data_complete,
    aiHistoricalSummary: row.ai_historical_summary,
    aiStatus: row.ai_status,
    aiError: row.ai_error,
    generatedAt: row.generated_at,
  }
}

export function formatHistoricalPeriodStart(periodStart: string, language: PreferredLanguage) {
  const formatted = new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'fr-FR', {
    timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(periodStart))
  return language === 'vi' ? `Từ ${formatted}` : `Depuis le ${formatted}`
}

export function formatHistoricalGeneratedAt(generatedAt: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(generatedAt))
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('day')}/${value('month')}/${value('year')} ${value('hour')}:${value('minute')}`
}

export function buildDemoHistoricalReport(
  establishmentId: string,
  reviews: Review[],
  language: PreferredLanguage,
  rating: number,
  totalReviews: number,
  now = new Date(),
): HistoricalReport {
  const stored = reviews.filter((review) => review.establishmentId === establishmentId && review.rating >= 1 && review.rating <= 5)
  const negative = stored.filter((review) => review.rating <= 3)
  const oldest = stored.reduce<string | null>((current, review) => !current || review.publishedAt < current ? review.publishedAt : current, null)
  const ready = negative.filter((review) => review.aiStatus === 'completed' && Boolean(review.replyDraftText || review.aiSuggestedReply))
  const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>
  stored.forEach((review) => { ratingCounts[review.rating as 1 | 2 | 3 | 4 | 5] += 1 })
  const summary = negative.length === 0
    ? language === 'vi'
      ? 'Không có đánh giá tiêu cực nào trong dữ liệu hiện có của giai đoạn này.'
      : 'Aucun avis négatif n’est présent dans les données disponibles pour cette période.'
    : language === 'vi'
      ? `Phân tích lịch sử dựa trên ${negative.length} đánh giá tiêu cực hiện có trong HOME Reviews.`
      : `L’analyse historique repose sur les ${negative.length} avis négatifs actuellement disponibles dans HOME Reviews.`
  return {
    id: `demo-historical-${establishmentId}`,
    organizationId: 'demo', establishmentId, preferredLanguage: language,
    periodStart: oldest ?? now.toISOString(), periodEnd: now.toISOString(),
    googleRating: rating, googleTotalReviews: totalReviews,
    storedReviewsCount: stored.length, negativeReviewsCount: negative.length,
    negativeRate: stored.length ? Math.round(negative.length / stored.length * 1_000) / 10 : 0,
    readyRepliesCount: new Set(ready.map((review) => review.id)).size,
    ratingCounts, dataComplete: false,
    aiHistoricalSummary: summary, aiStatus: 'completed', aiError: null, generatedAt: now.toISOString(),
  }
}
