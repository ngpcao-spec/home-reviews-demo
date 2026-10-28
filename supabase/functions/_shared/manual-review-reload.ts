import { normalizeApifyDataset } from './apify.ts'
import { prepareInitialReviews } from './initial-import.ts'
import { normalizeReviewLanguage, type PreferredLanguage } from './review-language.ts'
import { reviewRow } from './sync-service.ts'

export interface ReviewReloadScope {
  id: string
  organization_id: string
  google_id: string
  place_id: string | null
  language: PreferredLanguage
  requested_at: string
}

export class ReviewReloadValidationError extends Error {
  constructor(code: string, public readonly summary: Record<string, unknown> = {}) { super(code) }
}

/** No translation, persistence, deletion, or provider call. Full strings are retained. */
export function prepareManualReviewReload(items: Record<string, unknown>[], scope: ReviewReloadScope) {
  if (!items.length) throw new ReviewReloadValidationError('RELOAD_COLLECTION_UNVERIFIED', { uniqueCount: 0 })
  if (!['fr', 'vi'].includes(scope.language)) throw new ReviewReloadValidationError('RELOAD_LANGUAGE_INVALID')
  const totals = new Set<number>()
  for (const item of items) {
    if (String(item.cid ?? '') !== scope.google_id && (!scope.place_id || item.placeId !== scope.place_id)) {
      throw new ReviewReloadValidationError('RELOAD_RESTAURANT_MISMATCH')
    }
    const requested = normalizeReviewLanguage(typeof item.language === 'string' ? item.language : null)
    const translated = normalizeReviewLanguage(typeof item.translatedLanguage === 'string' ? item.translatedLanguage : null)
    if (requested && requested !== scope.language || typeof item.textTranslated === 'string' && item.textTranslated.trim() && translated !== scope.language) {
      throw new ReviewReloadValidationError('RELOAD_LANGUAGE_MISMATCH')
    }
    const rawTotal = item.reviewsCount ?? item.reviewsNumber
    if (typeof rawTotal === 'number' && Number.isSafeInteger(rawTotal) && rawTotal >= 0) totals.add(rawTotal)
    else if (typeof rawTotal === 'string' && /^\d+$/.test(rawTotal) && Number.isSafeInteger(Number(rawTotal))) totals.add(Number(rawTotal))
    if (!Number.isFinite(Date.parse(String(item.scrapedAt ?? ''))) || Date.parse(String(item.scrapedAt)) < Date.parse(scope.requested_at)) {
      throw new ReviewReloadValidationError('RELOAD_FRESHNESS_UNVERIFIED')
    }
  }
  if (totals.size > 1) throw new ReviewReloadValidationError('RELOAD_GOOGLE_TOTAL_INCONSISTENT')
  const total = totals.size ? [...totals][0] : null
  const normalized = normalizeApifyDataset(items, `https://www.google.com/maps?cid=${scope.google_id}`)
  const reviews = prepareInitialReviews(normalized.reviews, 150)
  const expected = total === null ? 150 : Math.min(150, total)
  const summary = { uniqueCount: reviews.length, expectedCount: expected, googleTotal: total, rawCount: items.length, language: scope.language,
    ...(total === 0 ? { emptyProof: { cid: items[0].cid, placeId: items[0].placeId, language: items[0].language, scrapedAt: items[0].scrapedAt, reviewsCount: 0 } } : {}) }
  const uniqueReceived = new Set(normalized.reviews.map(review => review.externalReviewId.trim()).filter(Boolean)).size
  if (reviews.length !== expected || !reviews.length && total !== 0 || total !== null && uniqueReceived > total
    || total === 0 && items.some(item => String(item.reviewId ?? '').trim())) {
    throw new ReviewReloadValidationError('RELOAD_COLLECTION_INCOMPLETE', summary)
  }
  const bundle = reviews.map(review => ({
    row: { ...reviewRow(scope, review, true, 'apify'), requires_ai_analysis: false },
    translations: review.translatedText?.trim() ? [{ language: scope.language, translated_text: String(review.rawPayload?.textTranslated) }] : [],
    raw_payload: review.rawPayload ?? {},
  }))
  return { bundle, summary, place: normalized.establishment }
}
