import type { AppNotification, Establishment, PreferredLanguage, Review } from '../types/domain'
import type { InitialImportJob } from '../app/AppContext'

export interface CachedAppData {
  establishments: Establishment[]
  reviews: Review[]
  notifications: AppNotification[]
  initialImportJobs: InitialImportJob[]
  monitoringIntervalHours: number
  preferredLanguage: PreferredLanguage | null
}
export interface AppCacheRecord {
  version: 1
  userId: string
  organizationIds: string[]
  cachedAt: number
  data: CachedAppData
  analytics?: unknown
}
const DB_NAME = 'home-reviews-display-cache'
const STORE = 'accounts'
const MAX_AGE = 7 * 24 * 60 * 60 * 1000
const generations = new Map<string, number>()
export const cacheGeneration = (userId: string) => generations.get(userId) ?? 0

// Cache failures (Safari private mode, quota, eviction) must never block login.
async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T | undefined> {
  if (typeof indexedDB === 'undefined') return undefined
  return new Promise(resolve => {
    let db: IDBDatabase | undefined
    let settled = false
    const finish = (value?: T) => { if (!settled) { settled = true; clearTimeout(timer); db?.close(); resolve(value) } }
    const timer = setTimeout(() => finish(), 1500)
    try {
      const open = indexedDB.open(DB_NAME, 1)
      open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: 'userId' })
      open.onerror = () => finish()
      open.onblocked = () => finish()
      open.onsuccess = () => {
        db = open.result
        if (settled) { db.close(); return }
        const tx = db.transaction(STORE, mode)
        let value: T | undefined
        tx.oncomplete = () => finish(value)
        tx.onerror = tx.onabort = () => finish()
        try { run(tx.objectStore(STORE), next => { value = next }) } catch { tx.abort() }
      }
    } catch { finish() }
  })
}

export function validAppCache(value: unknown, userId: string, now = Date.now()): value is AppCacheRecord {
  if (!value || typeof value !== 'object') return false
  const cache = value as AppCacheRecord
  if (cache.version !== 1 || cache.userId !== userId || !Number.isFinite(cache.cachedAt)
    || now - cache.cachedAt > MAX_AGE || cache.cachedAt > now + 60_000
    || !Array.isArray(cache.organizationIds) || !cache.data) return false
  const { establishments, reviews, notifications, initialImportJobs, preferredLanguage } = cache.data
  if (![establishments, reviews, notifications, initialImportJobs].every(Array.isArray)
    || ![null, 'fr', 'vi'].includes(preferredLanguage)) return false
  return establishments.every(e => e && typeof e.id === 'string' && cache.organizationIds.includes(e.organizationId))
    && reviews.every(r => r && typeof r.id === 'string' && cache.organizationIds.includes(r.organizationId))
    && notifications.every(n => n && n.userId === userId && cache.organizationIds.includes(n.organizationId ?? ''))
    && initialImportJobs.every(j => j && j.userId === userId && cache.organizationIds.includes(j.organizationId))
}

export async function readAppCache(userId: string): Promise<AppCacheRecord | undefined> {
  const value = await transaction<unknown>('readonly', (store, result) => {
    const request = store.get(userId)
    request.onsuccess = () => result(request.result)
  })
  return validAppCache(value, userId) ? value : undefined
}

export async function writeAppCache(userId: string, organizationIds: string[], data: CachedAppData, generation = cacheGeneration(userId)) {
  await transaction('readwrite', store => {
    const request = store.get(userId)
    request.onsuccess = () => {
      if (cacheGeneration(userId) !== generation) return
      const previous = request.result as AppCacheRecord | undefined
      const sameScope = previous?.organizationIds.slice().sort().join() === [...organizationIds].sort().join()
      const next: AppCacheRecord = { version: 1, userId, organizationIds, cachedAt: Date.now(), data,
        analytics: sameScope ? previous?.analytics : undefined }
      if (validAppCache(next, userId)) store.put(next)
      else store.delete(userId)
    }
  })
}

export async function writeAnalyticsCache(userId: string, organizationIds: string[], analytics: unknown, generation: number) {
  await transaction('readwrite', store => {
    const request = store.get(userId)
    request.onsuccess = () => {
      const previous = request.result as AppCacheRecord | undefined
      if (cacheGeneration(userId) !== generation || !previous
        || previous.organizationIds.slice().sort().join() !== [...organizationIds].sort().join()) return
      store.put({ ...previous, analytics })
    }
  })
}

export async function purgeAppCache(userId: string) {
  generations.set(userId, cacheGeneration(userId) + 1)
  await transaction('readwrite', store => { store.delete(userId) })
}
