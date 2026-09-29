import { useI18n } from '../../i18n'

export function SyncBadge({ status }: { status: 'pending' | 'syncing' | 'ok' | 'warning' | 'error' }) {
  const { messages } = useI18n()
  const labels = messages.status
  return <span className={`badge sync-${status}`}><span className="status-dot" />{labels[status]}</span>
}
