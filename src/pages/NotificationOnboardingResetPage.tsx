import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { saveNotificationPreference } from '../lib/notification-preferences'

export function NotificationOnboardingResetPage() {
  const navigate = useNavigate()
  const started = useRef(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void saveNotificationPreference('unknown', false)
      .then(() => navigate('/', { replace: true }))
      .catch(() => setError(true))
  }, [navigate])

  if (error) {
    return <main className="auth-page"><section className="auth-card card"><h1>Réinitialisation impossible</h1><p>Connectez-vous à votre compte test HOME Reviews, puis ouvrez de nouveau l’URL de réinitialisation.</p></section></main>
  }

  return <div className="route-loading" aria-label="Réinitialisation de l’onboarding notifications"><span /></div>
}
