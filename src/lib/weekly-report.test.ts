import { describe, expect, it } from 'vitest'
import { formatWeeklyPeriod, lastCompletedVietnamWeekStart, mapWeeklyReport, vietnamWeekBounds } from './weekly-report'

describe('weekly report client helpers', () => {
  it('uses the last completed Vietnam calendar week', () => {
    expect(lastCompletedVietnamWeekStart(new Date('2026-09-29T06:00:00Z'))).toBe('2026-09-21')
    expect(vietnamWeekBounds('2026-09-21')).toEqual({
      startAt: '2026-09-21T00:00:00+07:00', endAt: '2026-09-28T00:00:00+07:00',
    })
  })

  it('formats the inclusive display range in the selected language', () => {
    expect(formatWeeklyPeriod('2026-09-20T17:00:00Z', '2026-09-27T17:00:00Z', 'fr')).toBe('21–27 septembre 2026')
    expect(formatWeeklyPeriod('2026-09-20T17:00:00Z', '2026-09-27T17:00:00Z', 'vi')).toContain('27 tháng 9, 2026')
  })

  it('maps nullable snapshot values honestly', () => {
    const report = mapWeeklyReport({
      id: 'report', organization_id: 'org', establishment_id: 'est',
      period_start: '2026-09-20T17:00:00Z', period_end: '2026-09-27T17:00:00Z', preferred_language: 'fr',
      google_rating: null, google_total_reviews: null, snapshot_captured_at: null,
      new_reviews_count: 0, negative_reviews_count: 0, negative_rate: '0.0', ready_replies_count: 0,
      ai_weekly_summary: 'Aucun avis négatif.', ai_status: 'completed', ai_error: null, generated_at: null,
    })
    expect(report.googleRating).toBeNull()
    expect(report.googleTotalReviews).toBeNull()
  })
})
