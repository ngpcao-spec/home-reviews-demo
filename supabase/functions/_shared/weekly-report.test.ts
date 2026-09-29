import { describe, expect, it } from 'vitest'
import {
  calculateWeeklyMetrics,
  currentVietnamWeekStart,
  emptyWeeklySummary,
  lastCompletedVietnamWeekStart,
  periodFromVietnamMonday,
} from './weekly-report.ts'

describe('weekly report calendar and metrics', () => {
  it('uses explicit Vietnam Monday boundaries', () => {
    expect(currentVietnamWeekStart(new Date('2026-09-29T05:00:00Z'))).toBe('2026-09-28')
    expect(lastCompletedVietnamWeekStart(new Date('2026-09-29T05:00:00Z'))).toBe('2026-09-21')
    expect(periodFromVietnamMonday('2026-09-21')).toEqual({
      periodStart: '2026-09-21',
      periodEnd: '2026-09-28',
      startAt: '2026-09-21T00:00:00+07:00',
      endAt: '2026-09-28T00:00:00+07:00',
    })
  })

  it('rejects a non-Monday boundary', () => {
    expect(() => periodFromVietnamMonday('2026-09-22')).toThrow('INVALID_PERIOD_START')
  })

  it('uses all 1-5 star reviews as the negative-rate denominator', () => {
    expect(calculateWeeklyMetrics([{ rating: 1 }, { rating: 2 }, { rating: 3 }, { rating: 4 }, { rating: 5 }])).toEqual({
      newReviewsCount: 5,
      negativeReviewsCount: 3,
      negativeRate: 60,
    })
    expect(calculateWeeklyMetrics([]).negativeRate).toBe(0)
  })

  it('has factual localized zero-negative summaries', () => {
    expect(emptyWeeklySummary('fr')).toContain('Aucun nouvel avis négatif')
    expect(emptyWeeklySummary('vi')).toContain('Không phát hiện')
  })
})
