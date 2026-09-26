import { Bell, CheckCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../app/AppContext'
import { EmptyState } from '../components/ui/Loading'
import { PageHeader } from '../components/ui/PageHeader'
import { relativeTime } from '../lib/format'

export function NotificationsPage(){const {notifications,markNotificationRead,markAllNotificationsRead}=useApp();const navigate=useNavigate();const sorted=[...notifications].sort((a,b)=>Number(Boolean(a.readAt))-Number(Boolean(b.readAt))||new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());return <><PageHeader title="Notifications" back action={<button className="icon-button" onClick={markAllNotificationsRead} aria-label="Tout marquer comme lu"><CheckCheck/></button>}/>{sorted.length? <div className="notification-list">{sorted.map((item)=><button key={item.id} className={`notification-item card ${item.readAt?'read':''}`} onClick={()=>{markNotificationRead(item.id);if(item.reviewId)navigate(`/avis/${item.reviewId}`)}}><span className={`notification-severity ${item.severity}`}><Bell size={18}/></span><span><strong>{item.title}</strong><p>{item.body}</p><small>{relativeTime(item.createdAt)}</small></span>{!item.readAt&&<i aria-label="Non lue"/>}</button>)}</div>:<EmptyState icon={<Bell/>} title="Aucune notification" body="Les alertes importantes apparaîtront ici."/>}</>}
