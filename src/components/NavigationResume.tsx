import { useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../app/AppContext'
import { savedRoute, saveRoute } from '../lib/navigation-state'

export function NavigationResume() {
  const { currentUser, establishments, reviews } = useApp()
  const location = useLocation(), navigate = useNavigate()
  const initialized = useRef<string | undefined>(undefined)
  useLayoutEffect(() => {
    const userId = currentUser.id
    if (!userId) return
    const route = location.pathname + location.search
    if (initialized.current !== userId) {
      initialized.current = userId
      const saved = savedRoute(userId)
      // Explicit notification links and auth recovery URLs always win.
      if (route === '/' && !location.hash && saved && saved !== '/') {
        const place = saved.match(/^\/etablissements\/([^?]+)/)?.[1]
        const review = saved.match(/^\/avis\/([^?]+)/)?.[1]
        if ((!place || establishments.some(e => e.id === place)) && (!review || reviews.some(r => r.id === review))) {
          navigate(saved, { replace: true }); return
        }
      }
    }
    saveRoute(userId, route)
  }, [currentUser.id, establishments, reviews, location, navigate])
  return null
}
