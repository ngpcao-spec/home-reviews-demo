import type { Urgency } from '../../types/domain'
import { urgencyLabels } from '../../lib/review-rules'

export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  return <span className={`badge urgency-${urgency}`}><span className="status-dot" />{urgencyLabels[urgency]}</span>
}

export function SyncBadge({ status }: { status: 'pending' | 'syncing' | 'ok' | 'warning' | 'error' }) {
  const labels = { pending: 'En attente', syncing: 'Synchronisation…', ok: 'À jour', warning: 'À vérifier', error: 'Erreur' }
  return <span className={`badge sync-${status}`}><span className="status-dot" />{labels[status]}</span>
}
