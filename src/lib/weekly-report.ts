import type { PreferredLanguage, Review } from '../types/domain'

export interface WeeklyReport {
  id: string
  organizationId: string
  establishmentId: string
  periodStart: string
  periodEnd: string
  preferredLanguage: PreferredLanguage
  googleRating: number | null
  googleTotalReviews: number | null
  snapshotCapturedAt: string | null
  newReviewsCount: number
  negativeReviewsCount: number
  negativeRate: number
  readyRepliesCount: number
  aiWeeklySummary: string | null
  aiStatus: 'generating' | 'completed' | 'failed'
  aiError: string | null
  generatedAt: string | null
}

export interface WeeklyReportRow {
  id: string
  organization_id: string
  establishment_id: string
  period_start: string
  period_end: string
  preferred_language: PreferredLanguage
  google_rating: number | string | null
  google_total_reviews: number | null
  snapshot_captured_at: string | null
  new_reviews_count: number
  negative_reviews_count: number
  negative_rate: number | string
  ready_replies_count: number
  ai_weekly_summary: string | null
  ai_status: 'generating' | 'completed' | 'failed'
  ai_error: string | null
  generated_at: string | null
}

function addUtcDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function vietnamDateKey(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

export function lastCompletedVietnamWeekStart(now = new Date()) {
  const today = vietnamDateKey(now)
  const [year, month, day] = today.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return addUtcDays(today, -((weekday + 6) % 7) - 7)
}

export function vietnamWeekBounds(periodStart: string) {
  return {
    startAt: `${periodStart}T00:00:00+07:00`,
    endAt: `${addUtcDays(periodStart, 7)}T00:00:00+07:00`,
  }
}

export function formatWeeklyPeriod(periodStart: string, periodEnd: string, language: PreferredLanguage) {
  const locale = language === 'vi' ? 'vi-VN' : 'fr-FR'
  const start = new Date(periodStart)
  const end = new Date(new Date(periodEnd).getTime() - 1)
  const startDay = new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric' }).format(start)
  const endParts = new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'long', year: 'numeric',
  }).format(end)
  return `${startDay}–${endParts}`
}

export function mapWeeklyReport(row: WeeklyReportRow): WeeklyReport {
  return {
    id: row.id,
    organizationId: row.organization_id,
    establishmentId: row.establishment_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    preferredLanguage: row.preferred_language,
    googleRating: row.google_rating === null ? null : Number(row.google_rating),
    googleTotalReviews: row.google_total_reviews,
    snapshotCapturedAt: row.snapshot_captured_at,
    newReviewsCount: row.new_reviews_count,
    negativeReviewsCount: row.negative_reviews_count,
    negativeRate: Number(row.negative_rate),
    readyRepliesCount: row.ready_replies_count,
    aiWeeklySummary: row.ai_weekly_summary,
    aiStatus: row.ai_status,
    aiError: row.ai_error,
    generatedAt: row.generated_at,
  }
}

export function buildDemoWeeklyReport(
  establishmentId: string,
  reviews: Review[],
  language: PreferredLanguage,
  rating: number,
  totalReviews: number,
  now = new Date(),
): WeeklyReport {
  const periodStartKey = lastCompletedVietnamWeekStart(now)
  const bounds = vietnamWeekBounds(periodStartKey)
  const periodReviews = reviews.filter((review) => review.establishmentId === establishmentId
    && new Date(review.publishedAt).getTime() >= new Date(bounds.startAt).getTime()
    && new Date(review.publishedAt).getTime() < new Date(bounds.endAt).getTime())
  const negative = periodReviews.filter((review) => review.rating <= 3)
  const ready = negative.filter((review) => review.aiStatus === 'completed' && Boolean(review.replyDraftText || review.aiSuggestedReply))
  const summary = negative.length === 0
    ? language === 'vi' ? 'Không phát hiện đánh giá tiêu cực mới nào trong tuần này.' : 'Aucun nouvel avis négatif n’a été détecté cette semaine.'
    : language === 'vi'
      ? `Tuần này có ${negative.length} đánh giá tiêu cực mới. Bản minh họa chỉ sử dụng dữ liệu đánh giá cục bộ hiện có.`
      : `Cette semaine, ${negative.length} nouvel${negative.length > 1 ? 's' : ''} avis négatif${negative.length > 1 ? 's ont' : ' a'} été reçu${negative.length > 1 ? 's' : ''}. Ce résumé de démonstration utilise uniquement les avis locaux disponibles.`
  return {
    id: `demo-${establishmentId}-${periodStartKey}`,
    organizationId: 'demo', establishmentId,
    periodStart: bounds.startAt, periodEnd: bounds.endAt, preferredLanguage: language,
    googleRating: rating, googleTotalReviews: totalReviews, snapshotCapturedAt: now.toISOString(),
    newReviewsCount: periodReviews.length, negativeReviewsCount: negative.length,
    negativeRate: periodReviews.length ? Math.round(negative.length / periodReviews.length * 1_000) / 10 : 0,
    readyRepliesCount: new Set(ready.map((review) => review.id)).size,
    aiWeeklySummary: summary, aiStatus: 'completed', aiError: null, generatedAt: now.toISOString(),
  }
}
