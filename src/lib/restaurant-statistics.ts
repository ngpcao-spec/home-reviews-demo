import { supabase } from './supabase'

export const periods = ['30d', '3m', '6m', '1y', 'all'] as const
export type StatisticsPeriod = typeof periods[number]
export type Topic = 'service' | 'quality' | 'price' | 'ambiance'
export type ReviewFilter = { ratings?: number[]; topic?: Topic; polarity?: 'positive' | 'negative' }
export interface Statistics {
  version: string; establishment_id: string; language: string; timezone: string; as_of: string; period: StatisticsPeriod
  start_date: string | null; end_date: string; bucket: 'week' | 'month'
  metrics: { count: number; average: number | null; low_count: number; low_percent: number | null }
  comparison: null | { reliable: boolean; previous_start: string; previous_end: string; count_change: number | null; average_change: number | null; low_percent_change: number | null }
  coverage: { stored: number; dated: number; excluded: number; google_total: number | null; complete: boolean; first_date: string | null; last_date: string | null; checked_at: string | null }
  series: { date: string; average: number; count: number }[]
  distribution: { rating: number; count: number }[]
  topics: { text_count: number; analyzed: number; items: { key: Topic; positive: number; negative: number }[] }
}
export interface StatisticsReview { source_id: string; review_id: string | null; published_at: string; rating: number; original_text: string; display_text: string; translated: boolean; author_name: string; review_url: string | null }
export interface ReviewPage { language: string; total: number; items: StatisticsReview[]; next: { before: string; id: string } | null }
export async function readStatistics(establishment: string, period: StatisticsPeriod, signal: AbortSignal): Promise<Statistics> {
  if (!supabase) throw new Error('UNAVAILABLE')
  const { data, error } = await supabase.rpc('read_restaurant_statistics', { p_establishment: establishment, p_period: period }).abortSignal(signal)
  if (error) throw error
  if (!data || data.version !== 'restaurant-statistics-v1') throw new Error('INVALID_RESPONSE')
  return data as Statistics
}
export async function readStatisticReviews(establishment: string, period: StatisticsPeriod, filter: ReviewFilter, cursor: ReviewPage['next'], signal: AbortSignal): Promise<ReviewPage> {
  if (!supabase) throw new Error('UNAVAILABLE')
  const { data, error } = await supabase.rpc('read_restaurant_statistic_reviews', {
    p_establishment: establishment, p_period: period, p_ratings: filter.ratings ?? null,
    p_topic: filter.topic ?? null, p_polarity: filter.polarity ?? null,
    p_before: cursor?.before ?? null, p_before_id: cursor?.id ?? null, p_limit: 30,
  }).abortSignal(signal)
  if (error) throw error
  if (!data || !Array.isArray(data.items)) throw new Error('INVALID_RESPONSE')
  return data as ReviewPage
}
// Missing buckets remain gaps: only genuinely adjacent observations are joined.
export function adjacentBuckets(a: string, b: string, bucket: Statistics['bucket']) {
  const date = new Date(a + 'T12:00:00Z')
  if (bucket === 'week') date.setUTCDate(date.getUTCDate() + 7)
  else date.setUTCMonth(date.getUTCMonth() + 1)
  return date.toISOString().slice(0, 10) === b
}
