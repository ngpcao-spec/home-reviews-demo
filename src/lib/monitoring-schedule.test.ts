import { describe, expect, it } from 'vitest'
import { timeUntil } from './format'
import { MONITORING_INTERVALS, nextSyncAtFromLastSync } from './monitoring-schedule'

describe('monitoring schedule', () => {
  const now = Date.parse('2026-09-28T12:00:00.000Z')

  it.each(MONITORING_INTERVALS)('calcule la prochaine synchronisation pour %d h', (hours) => {
    const lastSync = '2026-09-28T11:50:00.000Z'
    expect(Date.parse(nextSyncAtFromLastSync(lastSync, hours, now)))
      .toBe(Date.parse(lastSync) + hours * 60 * 60 * 1_000)
  })

  it('affiche environ 2 h 50 après une dernière synchronisation vieille de 10 min à fréquence 3 h', () => {
    const nextSyncAt = nextSyncAtFromLastSync('2026-09-28T11:50:00.000Z', 3, now)
    expect(timeUntil(nextSyncAt, now)).toBe('Dans environ 2 h 50 min')
  })

  it('reste immédiatement éligible lorsque last_sync_at + fréquence est déjà passé', () => {
    const nextSyncAt = nextSyncAtFromLastSync('2026-09-28T07:00:00.000Z', 3, now)
    expect(timeUntil(nextSyncAt, now)).toBe('Éligible au prochain contrôle')
  })

  it('repousse le contrôle lors du passage de 3 h à 12 h', () => {
    const lastSync = '2026-09-28T11:50:00.000Z'
    expect(Date.parse(nextSyncAtFromLastSync(lastSync, 12, now)))
      .toBeGreaterThan(Date.parse(nextSyncAtFromLastSync(lastSync, 3, now)))
  })

  it('rapproche le contrôle lors du passage de 12 h à 3 h', () => {
    const lastSync = '2026-09-28T11:50:00.000Z'
    expect(Date.parse(nextSyncAtFromLastSync(lastSync, 3, now)))
      .toBeLessThan(Date.parse(nextSyncAtFromLastSync(lastSync, 12, now)))
  })
})
