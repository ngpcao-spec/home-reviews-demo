import { Bell, CheckCheck, Star } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../app/AppContext'
import { EmptyState } from '../components/ui/Loading'
import { PageHeader } from '../components/ui/PageHeader'
import { relativeTime } from '../lib/format'

export function NotificationsPage() {
  const { notifications, establishments, reviews, markNotificationRead, markAllNotificationsRead } = useApp()
  const navigate = useNavigate()
  const sorted = [...notifications].sort((a, b) => Number(Boolean(a.readAt)) - Number(Boolean(b.readAt))
    || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const openNotification = async (notificationId: string, reviewId?: string) => {
    await markNotificationRead(notificationId)
    if (reviewId) navigate(`/avis/${reviewId}`)
  }

  return <>
    <PageHeader
      title="Notifications"
      back
      action={<button className="icon-button" onClick={() => void markAllNotificationsRead()} aria-label="Tout marquer comme lu"><CheckCheck /></button>}
    />
    {sorted.length ? <div className="notification-list">{sorted.map((item) => {
      const review = reviews.find((entry) => entry.id === item.reviewId)
      const establishment = establishments.find((entry) => entry.id === item.establishmentId)
      return <button
        key={item.id}
        className={`notification-item card ${item.readAt ? 'read' : ''}`}
        onClick={() => void openNotification(item.id, item.reviewId)}
      >
        <span className={`notification-severity ${item.severity}`}><Bell size={18} /></span>
        <span>
          <strong>{establishment?.name ?? item.title}</strong>
          {review && <span className="notification-meta"><Star size={13} fill="currentColor" /> {review.rating}★ · {relativeTime(item.createdAt)}</span>}
          <p>{item.body}</p>
          {!review && <small>{relativeTime(item.createdAt)}</small>}
        </span>
        {!item.readAt && <i aria-label="Non lue" />}
      </button>
    })}</div> : <EmptyState icon={<Bell />} title="Aucune notification" body="Les nouveaux avis 1 à 3 étoiles apparaîtront ici après leur analyse." />}
  </>
}
