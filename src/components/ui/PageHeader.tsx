import { ArrowLeft, Bell } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../app/AppContext'
import { useI18n } from '../../i18n'

export function PageHeader({ title, back = false, action }: { title: string; back?: boolean; action?: React.ReactNode }) {
  const navigate = useNavigate()
  const { notifications } = useApp()
  const { messages } = useI18n()
  const unread = notifications.filter((item) => !item.readAt).length
  return <header className="page-header">
    <div className="header-side">{back && <button className="icon-button" onClick={() => navigate(-1)} aria-label={messages.common.back}><ArrowLeft /></button>}</div>
    <h1>{title}</h1>
    <div className="header-side right">{action ?? <button className="icon-button notification-button" onClick={() => navigate('/notifications')} aria-label={`${unread} notifications non lues`}><Bell />{unread > 0 && <span className="notification-count">{unread > 99 ? '99+' : unread}</span>}</button>}</div>
  </header>
}
