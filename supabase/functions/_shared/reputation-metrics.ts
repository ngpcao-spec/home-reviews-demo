export const ANALYSIS_VERSION = 2

export type Category = 'food' | 'service' | 'atmosphere' | 'other'
export type Sentiment = 'positive' | 'negative'
export interface ReputationReview {
  id: string
  rating: number
  original_text: string | null
  text: string | null
  published_at: string | null
  historical_import: boolean
  has_negative_feedback: boolean | null
  status: string
  review_detailed_rating: Record<string, unknown> | null
  review_context: Record<string, unknown> | null
  ready?: boolean
}

const normalizeKey = (key: string) => key.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd').trim()
const categories: Record<string, Category> = {
  'do an': 'food', food: 'food', cuisine: 'food',
  'dich vu': 'service', service: 'service',
  'bau khong khi': 'atmosphere', atmosphere: 'atmosphere', ambiance: 'atmosphere', ambience: 'atmosphere',
}
export function normalizedSubratings(value: Record<string, unknown> | null) {
  const result: Partial<Record<Category, number>> = {}
  for (const [key, raw] of Object.entries(value ?? {})) {
    const category = categories[normalizeKey(key)]
    const number = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d(?:[.,]\d+)?(?:\s*\/\s*5)?$/.test(raw.trim()) ? Number(raw.split('/')[0].replace(',', '.')) : NaN
    if (category && number >= 1 && number <= 5 && Number.isFinite(number)) result[category] ??= number
  }
  return result
}

const contextKeys: Record<string, string> = {
  'thoi gian cho': 'wait_time', 'wait time': 'wait_time', 'waiting time': 'wait_time', "temps d’attente": 'wait_time', "temps d'attente": 'wait_time',
  'do on': 'noise_level', 'muc do on': 'noise_level', 'noise level': 'noise_level', 'niveau sonore': 'noise_level',
}
export function relevantContext(value: Record<string, unknown> | null) {
  return Object.fromEntries(Object.entries(value ?? {}).flatMap(([key, raw]) => {
    const normalized = contextKeys[normalizeKey(key)]
    return normalized && typeof raw === 'string' ? [[normalized, raw]] : []
  }))
}

export function needsAttention(review: ReputationReview) {
  return review.rating >= 1 && review.rating <= 3
    || review.rating === 4 && !review.historical_import && review.has_negative_feedback === true
}

export function reputationMetrics(reviews: ReputationReview[], googleTotal: number | null) {
  const counts = [0, 0, 0, 0, 0]
  const subratings = { food: [] as number[], service: [] as number[], atmosphere: [] as number[] }
  const valid = reviews.filter((r) => Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5)
  for (const review of valid) {
    counts[review.rating - 1]++
    const ratings = normalizedSubratings(review.review_detailed_rating)
    for (const key of ['food', 'service', 'atmosphere'] as const) if (ratings[key] !== undefined) subratings[key].push(ratings[key]!)
  }
  const count = valid.length
  const attention = valid.filter(needsAttention)
  const ready = attention.filter((r) => r.ready)
  const processed = attention.filter((r) => r.status === 'processed')
  const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
  return {
    sample_reviews_count: count, stored_reviews_count: count,
    sample_average_rating: average(valid.map((r) => r.rating)),
    positive_reviews_count: counts[3] + counts[4], positive_rate: count ? (counts[3] + counts[4]) / count * 100 : 0,
    negative_reviews_count: counts[0] + counts[1] + counts[2], negative_rate: count ? (counts[0] + counts[1] + counts[2]) / count * 100 : 0,
    attention_reviews_count: attention.length, ready_replies_count: ready.length,
    processed_reviews_count: processed.length,
    remaining_replies_count: attention.filter((r) => r.status !== 'processed' && !r.ready).length,
    rating_1_count: counts[0], rating_2_count: counts[1], rating_3_count: counts[2], rating_4_count: counts[3], rating_5_count: counts[4],
    food_average: average(subratings.food), food_review_count: subratings.food.length,
    service_average: average(subratings.service), service_review_count: subratings.service.length,
    atmosphere_average: average(subratings.atmosphere), atmosphere_review_count: subratings.atmosphere.length,
    data_complete: googleTotal !== null && googleTotal > 0 && count >= googleTotal,
  }
}

export function reviewBatches(reviews: ReputationReview[]) {
  const batches: ReputationReview[][] = []
  let batch: ReputationReview[] = [], size = 0
  for (const review of reviews) {
    const length = (review.original_text ?? review.text ?? '').length + JSON.stringify(relevantContext(review.review_context)).length
    if (!length || !(review.original_text?.trim() || review.text?.trim() || Object.keys(relevantContext(review.review_context)).length)) continue
    if (length > 100_000) throw new Error('REPORT_REVIEW_TOO_LARGE')
    if (batch.length && (batch.length >= 60 || size + length > 30_000)) { batches.push(batch); batch = []; size = 0 }
    batch.push(review); size += length
  }
  if (batch.length) batches.push(batch)
  return batches
}
