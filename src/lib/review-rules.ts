import type { ReviewStatus } from '../types/domain'

export function transitionReview(status: ReviewStatus, action: 'process' | 'reopen' | 'ignore'): ReviewStatus {
  if (action === 'process' && status === 'to_process') return 'processed'
  if (action === 'reopen' && status === 'processed') return 'to_process'
  if (action === 'ignore' && ['new', 'to_process'].includes(status)) return 'ignored'
  return status
}

export function canAddEstablishment(current: number, max: number) {
  return current < max
}

export function deterministicReviewKey(establishmentId: string, provider: string, externalId?: string, fallbackFields?: string[]) {
  if (externalId) return `${establishmentId}:${provider}:${externalId}`
  let hash = 2166136261
  for (const char of fallbackFields?.join('|') ?? '') {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `${establishmentId}:${provider}:hash-${(hash >>> 0).toString(16)}`
}

export function previousPeriod(start: Date, end: Date) {
  const duration = end.getTime() - start.getTime()
  return { start: new Date(start.getTime() - duration), end: new Date(start.getTime()) }
}
