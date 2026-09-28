import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HISTORICAL_RECENT_WINDOW_DAYS,
  HISTORICAL_NEGATIVE_LIMIT,
  historicalRecentWindowDays,
  initialImportCutoffSeconds,
  mergeInitialReviewPasses,
} from './initial-import'

const day = 24 * 60 * 60 * 1_000
const now = Date.parse('2026-09-28T00:00:00.000Z')
const review = (id: string, rating: number, ageDays: number) => ({
  externalReviewId: id,
  rating,
  publishedAt: new Date(now - ageDays * day).toISOString(),
})

describe('import initial PASS A + PASS B', () => {
  it('utilise une fenêtre serveur de 30 jours par défaut', () => {
    expect(DEFAULT_HISTORICAL_RECENT_WINDOW_DAYS).toBe(30)
    expect(historicalRecentWindowDays(undefined)).toBe(30)
    expect(historicalRecentWindowDays('45')).toBe(45)
    expect(historicalRecentWindowDays('incorrect')).toBe(30)
  })

  it('retient un avis 2★ vieux de 14 jours dans la passe récente', () => {
    const cutoff = initialImportCutoffSeconds(now, 30) * 1_000
    const result = mergeInitialReviewPasses([review('recent-2', 2, 14)], [], cutoff)
    expect(result.reviews.map((item) => item.externalReviewId)).toEqual(['recent-2'])
    expect(result.recentNegative).toBe(1)
  })

  it('peut retenir un avis 2★ vieux de 45 jours via la passe historique', () => {
    const cutoff = initialImportCutoffSeconds(now, 30) * 1_000
    const oldReview = review('old-2', 2, 45)
    const result = mergeInitialReviewPasses([oldReview], [oldReview], cutoff)
    expect(result.recentNegative).toBe(0)
    expect(result.reviews.map((item) => item.externalReviewId)).toEqual(['old-2'])
  })

  it('déduplique un même avis présent dans les deux passes et trie par date décroissante', () => {
    const cutoff = initialImportCutoffSeconds(now, 30) * 1_000
    const duplicate = review('duplicate', 2, 14)
    const result = mergeInitialReviewPasses(
      [review('newest', 3, 2), duplicate, review('positive', 5, 1)],
      [duplicate, review('older', 1, 90)],
      cutoff,
    )
    expect(result.reviews.map((item) => item.externalReviewId)).toEqual(['newest', 'duplicate', 'older'])
  })

  it('limite la passe historique négative à 100 avis', () => {
    const cutoff = initialImportCutoffSeconds(now, 30) * 1_000
    const historical = Array.from({ length: 120 }, (_, index) => review(`history-${index}`, 1, 31 + index))
    expect(mergeInitialReviewPasses([], historical, cutoff).reviews).toHaveLength(HISTORICAL_NEGATIVE_LIMIT)
  })
})
