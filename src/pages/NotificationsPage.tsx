import { Bell, CheckCheck, Star } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../app/AppContext'
import { EmptyState } from '../components/ui/Loading'
import { PageHeader } from '../components/ui/PageHeader'
import { relativeTime } from '../lib/format'
import { useI18n } from '../i18n'

export function NotificationsPage() {
  const { notifications, establishments, reviews, markNotificationRead, markAllNotificationsRead } = useApp()
  const navigate = useNavigate()
  const { messages } = useI18n()
  const sorted = [...notifications].sort((a, b) => Number(Boolean(a.readAt)) - Number(Boolean(b.readAt))
    || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const openNotification = async (notificationId: string, reviewId?: string, establishmentId?: string) => {
    await markNotificationRead(notificationId)
    if (reviewId) navigate(`/avis/${reviewId}`)
    else if (establishmentId) navigate(`/etablissements/${establishmentId}`)
  }

  return <>
    <PageHeader
      title={messages.notifications.title}
      back
      action={<button className="icon-button" onClick={() => void markAllNotificationsRead()} aria-label={messages.notifications.markAll}><CheckCheck /></button>}
    />
    {sorted.length ? <div className="notification-list">{sorted.map((item) => {
      const review = reviews.find((entry) => entry.id === item.reviewId)
      const establishment = establishments.find((entry) => entry.id === item.establishmentId)
      return <button
        key={item.id}
        className={`notification-item card ${item.readAt ? 'read' : ''}`}
        onClick={() => void openNotification(item.id, item.reviewId, item.establishmentId)}
      >
        <span className={`notification-severity ${item.severity}`}><Bell size={18} /></span>
        <span>
          <strong>{item.type === 'initial_import_completed' ? item.title : establishment?.name ?? item.title}</strong>
          {review && <span className="notification-meta"><Star size={13} fill="currentColor" /> {review.rating}★ · {relativeTime(review.publishedAt || item.createdAt)}</span>}
          <p>{review?.reviewText?.trim() || review?.originalText?.trim() || item.body}</p>
          {!review && <small>{relativeTime(item.createdAt)}</small>}
        </span>
        {!item.readAt && <i aria-label={messages.notifications.unread} />}
      </button>
    })}</div> : <EmptyState icon={<Bell />} title={messages.notifications.none} body={messages.notifications.noneBody} />}
  </>
}
