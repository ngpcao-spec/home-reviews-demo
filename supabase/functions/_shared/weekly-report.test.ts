import { describe, expect, it } from 'vitest'
import {
  calculateWeeklyMetrics,
  currentVietnamWeekStart,
  currentVietnamPeriod,
  emptyWeeklySummary,
  lastCompletedVietnamWeekStart,
  isReportingPeriodComplete,
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

  it('marks a period before reporting coverage as incomplete', () => {
    expect(isReportingPeriodComplete('2026-09-28T00:00:00+07:00', '2026-09-21T00:00:00+07:00')).toBe(false)
    expect(calculateWeeklyMetrics([{ rating: 3 }]).negativeReviewsCount).toBe(1)
  })

  it('keeps a covered zero-review period as a real zero', () => {
    expect(isReportingPeriodComplete('2026-09-28T00:00:00+07:00', '2026-09-28T00:00:00+07:00')).toBe(true)
    expect(calculateWeeklyMetrics([])).toEqual({ newReviewsCount: 0, negativeReviewsCount: 0, negativeRate: 0 })
  })

  it('calculates covered review metrics normally', () => {
    expect(calculateWeeklyMetrics([{ rating: 1 }, { rating: 4 }, { rating: 5 }])).toEqual({
      newReviewsCount: 3, negativeReviewsCount: 1, negativeRate: 33.3,
    })
  })

  it('builds the current Vietnam week as a provisional period', () => {
    expect(currentVietnamPeriod(new Date('2026-09-29T06:00:00Z'))).toEqual({
      periodStart: '2026-09-28', periodEnd: null,
      startAt: '2026-09-28T00:00:00+07:00', endAt: '2026-09-29T06:00:00.000Z', provisional: true,
    })
  })
})
