import type { Category, ReviewStatus, Urgency } from '../types/domain'

export const categoryLabels: Record<Category, string> = {
  waiting_time: 'Attente', service: 'Service', staff: 'Personnel', product_quality: 'Qualité',
  cleanliness: 'Propreté', price: 'Prix', reservation: 'Réservation', delivery: 'Livraison',
  availability: 'Disponibilité', billing: 'Facturation', other: 'Autre',
}

export const urgencyLabels: Record<Urgency, string> = {
  low: 'Faible', medium: 'Moyenne', high: 'Élevée', critical: 'Critique',
}

export function classifyByRating(rating: number, aiRequiresAction?: boolean): { requiresAction: boolean; status: ReviewStatus; needsAnalysis: boolean } {
  if (rating <= 2) return { requiresAction: true, status: 'to_process', needsAnalysis: true }
  if (rating === 3) {
    if (aiRequiresAction === undefined) return { requiresAction: false, status: 'new', needsAnalysis: true }
    return aiRequiresAction
      ? { requiresAction: true, status: 'to_process', needsAnalysis: true }
      : { requiresAction: false, status: 'ignored', needsAnalysis: true }
  }
  return { requiresAction: false, status: 'ignored', needsAnalysis: false }
}

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

export function normalizeCategory(input: string): Category {
  const normalized = input.trim().toLowerCase().replace(/[ -]+/g, '_')
  const aliases: Record<string, Category> = { wait: 'waiting_time', waiting: 'waiting_time', food: 'product_quality', quality: 'product_quality', hygiene: 'cleanliness', payment: 'billing' }
  if (normalized in categoryLabels) return normalized as Category
  return aliases[normalized] ?? 'other'
}
