import { describe, expect, it } from 'vitest'
import type { NormalizedReview } from './outscraper.ts'
import { prepareInitialReviews } from './initial-import'
import { reviewPersistenceBatches } from './review-persistence'
import {
  configuredInteger,
  mapWithConcurrency,
  pageBeforeCheckpoint,
  retryPolicy,
} from './sync-queue.ts'

const review = (id: string): NormalizedReview => ({
  externalReviewId: id,
  establishmentGoogleId: 'place',
  authorName: 'Client',
  authorImage: null,
  rating: 2,
  text: id,
  publishedAt: '2026-09-28T00:00:00.000Z',
  reviewUrl: null,
  ownerResponse: null,
  language: 'fr',
  paginationId: id,
})

describe('scalable review sync queue helpers', () => {
  it.each([100, 350, 500])('keeps %i existing reviews and appends incremental reviews without the initial cap', (size) => {
    const existing = Array.from({ length: size }, (_, i) => review(`old-${i}`))
    const stored = new Map(existing.map(item => [item.externalReviewId, item]))
    const initial = prepareInitialReviews(existing)
    expect(initial).toHaveLength(100)
    expect(existing).toHaveLength(size)
    const next = { ...review('new-review'), rating: 5 }
    const page = pageBeforeCheckpoint([next, existing[0]], existing[0].externalReviewId)
    expect(page.caughtUp).toBe(true)
    for (const batch of reviewPersistenceBatches(page.reviews)) {
      for (const item of batch) stored.set(item.externalReviewId, item)
    }
    expect(stored.size).toBe(size + 1)
    expect(stored.get('new-review')?.rating).toBe(5)
    expect(existing.every(item => stored.has(item.externalReviewId))).toBe(true)
  })

  it.each([4, 100, 1_000, 10_000])(
    'deduplicates active jobs for %i due establishments',
    (size) => {
      const due = Array.from({ length: size }, (_, index) => `est-${index}`)
      const active = new Set<string>()
      const firstPass = due.filter((id) => {
        if (active.has(id)) return false
        active.add(id)
        return true
      })
      const secondPass = due.filter((id) => {
        if (active.has(id)) return false
        active.add(id)
        return true
      })
      expect(firstPass).toHaveLength(size)
      expect(secondPass).toHaveLength(0)
    },
  )

  it('keeps worker concurrency bounded', async () => {
    let running = 0
    let peak = 0
    await mapWithConcurrency(Array.from({ length: 100 }, (_, index) => index), 5, async () => {
      running += 1
      peak = Math.max(peak, running)
      await Promise.resolve()
      running -= 1
    })
    expect(peak).toBe(5)
  })

  it('gives concurrent workers disjoint claims and recovers an expired lease', () => {
    const jobs = Array.from({ length: 100 }, (_, id) => ({
      id,
      status: 'queued',
      lockedBy: null as string | null,
      leaseUntil: 0,
    }))
    const claim = (worker: string, now: number) => jobs
      .filter((job) => job.status === 'queued' || (job.status === 'running' && job.leaseUntil < now))
      .slice(0, 25)
      .map((job) => {
        job.status = 'running'
        job.lockedBy = worker
        job.leaseUntil = now + 240_000
        return job.id
      })
    const first = claim('a', 1_000)
    const second = claim('b', 1_000)
    expect(first.filter((id) => second.includes(id))).toHaveLength(0)
    jobs[first[0]].leaseUntil = 999
    expect(claim('c', 1_000)).toContain(first[0])
  })

  it('isolates a failed establishment from the remaining batch', async () => {
    const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      try {
        if (value === 2) throw new Error('OUTSCRAPER_TIMEOUT')
        return 'completed'
      } catch {
        return 'retry'
      }
    })
    expect(results).toEqual(['completed', 'retry', 'completed', 'completed'])
  })

  it('does not invoke the provider when no establishment is due', async () => {
    let providerCalls = 0
    await mapWithConcurrency([], 5, async () => {
      providerCalls += 1
    })
    expect(providerCalls).toBe(0)
  })

  it('continues through more than 100 reviews until the checkpoint', () => {
    const stream = Array.from({ length: 251 }, (_, index) => review(`r-${index}`))
    const collected: string[] = []
    for (let offset = 0; offset < stream.length; offset += 20) {
      const page = pageBeforeCheckpoint(stream.slice(offset, offset + 20), 'r-230')
      collected.push(...page.reviews.map((item) => item.externalReviewId))
      if (page.caughtUp) break
    }
    expect(collected).toHaveLength(230)
    expect(collected.at(-1)).toBe('r-229')
  })

  it('uses controlled retry and terminal provider errors', () => {
    expect(retryPolicy(new Error('OUTSCRAPER_TIMEOUT'), 2, 60)).toEqual({
      code: 'OUTSCRAPER_TIMEOUT',
      retryable: true,
      backoffSeconds: 240,
    })
    expect(retryPolicy(new Error('OUTSCRAPER_INVALID_QUERY'), 0, 60).retryable).toBe(false)
  })

  it('bounds server configuration values', () => {
    expect(configuredInteger('25', 10, 1, 100)).toBe(25)
    expect(configuredInteger('1000', 10, 1, 100)).toBe(100)
    expect(configuredInteger('bad', 10, 1, 100)).toBe(10)
  })
})
