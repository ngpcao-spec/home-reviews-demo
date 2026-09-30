import { describe, expect, it } from 'vitest'
import { emptyHistoricalSummary, historicalDataComplete } from './historical-report.ts'

describe('historical report helpers', () => {
  it('marks imported history before complete 1-5 coverage as partial', () => {
    expect(historicalDataComplete('2026-09-28T00:00:00+07:00', '2026-02-07T13:38:43Z')).toBe(false)
    expect(historicalDataComplete('2026-09-28T00:00:00+07:00', '2026-09-28T00:00:00+07:00')).toBe(true)
    expect(historicalDataComplete(null, '2026-09-28T00:00:00+07:00')).toBe(false)
  })

  it('has honest localized summaries when no negative review is stored', () => {
    expect(emptyHistoricalSummary('fr')).toContain('Aucun avis négatif')
    expect(emptyHistoricalSummary('vi')).toContain('Không có đánh giá tiêu cực')
  })
})
