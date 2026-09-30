import { BarChart3, Building2, Ellipsis, Home, Star, WifiOff } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useApp } from '../../app/AppContext'
import { useI18n } from '../../i18n'

export function AppShell() {
  const { toasts } = useApp()
  const { messages } = useI18n()
  const location = useLocation()
  const links = [
    { to: '/', label: messages.nav.home, icon: Home, end: true },
    { to: '/etablissements', label: messages.nav.establishments, icon: Building2 },
    { to: '/avis', label: messages.nav.reviews, icon: Star },
    { to: '/analyses', label: messages.nav.analytics, icon: BarChart3 },
    { to: '/plus', label: messages.nav.more, icon: Ellipsis },
  ]
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

  return <div className="app-shell">
    {!online && <div className="offline-banner"><WifiOff size={16} /> {messages.shell.offline}</div>}
    <main className={`page-frame${location.pathname === '/analyses' ? ' page-frame-analytics' : ''}`}><Outlet /></main>
    <nav className="bottom-nav" aria-label={messages.shell.navigation}>
      {links.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
        <span className="nav-icon"><Icon size={21} strokeWidth={2.2} /></span><span>{label}</span>
      </NavLink>)}
    </nav>
    <div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div className="toast" key={toast.id}>{toast.text}</div>)}</div>
  </div>
}
