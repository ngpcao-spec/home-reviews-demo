import { BarChart3, Building2, Ellipsis, Home, Star, WifiOff } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useApp } from '../../app/AppContext'

const links = [
  { to: '/', label: 'Accueil', icon: Home, end: true },
  { to: '/etablissements', label: 'Établissements', icon: Building2 },
  { to: '/avis', label: 'Avis', icon: Star },
  { to: '/analyses', label: 'Analyses', icon: BarChart3 },
  { to: '/plus', label: 'Plus', icon: Ellipsis },
]

export function AppShell() {
  const { toasts } = useApp()
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

  return <div className="app-shell">
    {!online && <div className="offline-banner"><WifiOff size={16} /> Hors ligne · dernières données disponibles</div>}
    <main className="page-frame"><Outlet /></main>
    <nav className="bottom-nav" aria-label="Navigation principale">
      {links.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
        <span className="nav-icon"><Icon size={21} strokeWidth={2.2} /></span><span>{label}</span>
      </NavLink>)}
    </nav>
    <div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div className="toast" key={toast.id}>{toast.text}</div>)}</div>
  </div>
}
