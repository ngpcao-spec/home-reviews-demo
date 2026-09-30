import { describe, expect, it } from 'vitest'
import { formatHistoricalPeriodStart, mapHistoricalReport } from './historical-report'

describe('historical report client helpers', () => {
  it('formats the real coverage start in French and Vietnamese', () => {
    const start = '2026-09-23T17:00:00Z'
    expect(formatHistoricalPeriodStart(start, 'fr')).toBe('Depuis le 24 septembre 2026')
    expect(formatHistoricalPeriodStart(start, 'vi')).toBe('Từ 24 tháng 9, 2026')
  })

  it('maps all five rating buckets without changing the stored denominator', () => {
    const report = mapHistoricalReport({
      id: 'report', organization_id: 'org', establishment_id: 'est', preferred_language: 'fr',
      period_start: '2026-09-01T00:00:00Z', period_end: '2026-09-30T00:00:00Z',
      google_rating: '4.9', google_total_reviews: 1641,
      stored_reviews_count: 10, negative_reviews_count: 4, negative_rate: '40.0', ready_replies_count: 3,
      rating_1_count: 1, rating_2_count: 1, rating_3_count: 2, rating_4_count: 3, rating_5_count: 3,
      data_complete: false, ai_historical_summary: 'Résumé', ai_status: 'completed', ai_error: null, generated_at: null,
    })
    expect(report.ratingCounts).toEqual({ 1: 1, 2: 1, 3: 2, 4: 3, 5: 3 })
    expect(report.storedReviewsCount).toBe(10)
    expect(report.negativeRate).toBe(40)
  })
})
