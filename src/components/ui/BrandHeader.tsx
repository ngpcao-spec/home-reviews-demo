import { Bell, Menu, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../app/AppContext'

export function BrandMark() {
  return <span className="brand-mark"><b>HOME</b> <strong>Reviews</strong></span>
}

export function BrandHeader({ addAction, trailing, title }: { addAction?: () => void; trailing?: ReactNode; title?: ReactNode }) {
  const navigate = useNavigate()
  const { notifications, currentUser } = useApp()
  const unread = notifications.filter((item) => !item.readAt).length

  return <header className="brand-header">
    <button className="bare-icon" onClick={() => navigate('/plus')} aria-label="Ouvrir le menu"><Menu /></button>
    {title ?? <BrandMark />}
    <div className="brand-actions">
      {trailing ?? <>
        {addAction ? <button className="header-add" onClick={addAction}><Plus />Ajouter</button> : <button className="bare-icon notification-button" onClick={() => navigate('/notifications')} aria-label={`${unread} notifications non lues`}><Bell />{unread > 0 && <span className="notification-count">{unread > 99 ? '99+' : unread}</span>}</button>}
        {!addAction && <button className="mini-avatar" onClick={() => navigate('/plus')} aria-label="Ouvrir le profil">{currentUser.avatarUrl ? <img src={currentUser.avatarUrl} alt="" referrerPolicy="no-referrer" /> : currentUser.initials}</button>}
      </>}
    </div>
  </header>
}
