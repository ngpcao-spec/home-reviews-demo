import { Bell, Check, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useApp } from '../app/AppContext'
import {
  loadNotificationPreference,
  requiresIosInstallation,
  saveNotificationPreference,
  shouldShowNotificationOnboarding,
} from '../lib/notification-preferences'
import {
  currentPushSubscription,
  enablePushNotifications,
  isIosDevice,
  isStandalonePwa,
  pushIsSupported,
} from '../lib/push-notifications'

const IOS_INSTALL_MESSAGE = "Pour recevoir les notifications sur iPhone, ajoutez HOME Reviews à votre écran d'accueil, puis ouvrez l'application depuis son icône."

export function NotificationOnboarding() {
  const { dataReady, demoMode, isAuthenticated, pushToast } = useApp()
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showInstallSteps, setShowInstallSteps] = useState(false)
  const iosNeedsInstall = requiresIosInstallation(isIosDevice(), isStandalonePwa())

  useEffect(() => {
    if (!dataReady || demoMode || !isAuthenticated) return
    let active = true

    void (async () => {
      try {
        const preference = await loadNotificationPreference()
        if (!pushIsSupported() && !iosNeedsInstall) return

        const subscription = pushIsSupported() ? await currentPushSubscription() : null
        if (subscription) {
          if (!preference.seen || preference.status !== 'granted') {
            await saveNotificationPreference('granted')
          }
          return
        }

        if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
          if (!preference.seen || preference.status !== 'denied') {
            await saveNotificationPreference('denied')
          }
          return
        }

        if (active) setVisible(shouldShowNotificationOnboarding(preference, false))
      } catch {
        // A preference loading failure must never block access to HOME Reviews.
      }
    })()

    return () => { active = false }
  }, [dataReady, demoMode, isAuthenticated])

  const postpone = async () => {
    setBusy(true)
    try {
      await saveNotificationPreference('unknown')
      setVisible(false)
    } catch {
      pushToast('Impossible d’enregistrer votre choix')
    } finally {
      setBusy(false)
    }
  }

  const activate = async () => {
    if (requiresIosInstallation(isIosDevice(), isStandalonePwa())) {
      setShowInstallSteps(true)
      return
    }
    if (!pushIsSupported()) {
      pushToast('Notifications push non prises en charge')
      return
    }

    setBusy(true)
    try {
      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission()

      if (permission === 'denied') {
        await saveNotificationPreference('denied')
        setVisible(false)
        pushToast('Permission refusée — vous pourrez réessayer dans Paramètres')
        return
      }
      if (permission !== 'granted') {
        await saveNotificationPreference('unknown')
        setVisible(false)
        return
      }

      await enablePushNotifications()
      await saveNotificationPreference('granted')
      setVisible(false)
      pushToast('Notifications activées')
    } catch {
      pushToast('Impossible d’activer les notifications')
    } finally {
      setBusy(false)
    }
  }

  if (!visible) return null

  return <div className="notification-onboarding-backdrop" role="presentation">
    <section className="notification-onboarding card" role="dialog" aria-modal="true" aria-labelledby="notification-onboarding-title">
      <div className="notification-onboarding-icon"><Bell aria-hidden="true" /></div>
      <h2 id="notification-onboarding-title">Restez informé des nouveaux avis</h2>
      <p>HOME Reviews peut vous prévenir lorsqu'un nouvel avis 1★ à 3★ arrive et que votre réponse est prête.</p>
      {iosNeedsInstall && <div className="notification-onboarding-info" role="status">
        <span>{IOS_INSTALL_MESSAGE}</span>
        {showInstallSteps && <ol>
          <li>Appuyez sur le bouton Partager de Safari.</li>
          <li>Choisissez « Sur l'écran d'accueil ».</li>
          <li>Appuyez sur « Ajouter ».</li>
          <li>Ouvrez ensuite HOME Reviews depuis la nouvelle icône.</li>
        </ol>}
      </div>}
      <div className="notification-onboarding-actions">
        <button
          className="primary-button full-width"
          onClick={iosNeedsInstall ? () => setShowInstallSteps(true) : () => void activate()}
          disabled={busy}
        >
          {iosNeedsInstall ? <Share2 size={18} /> : <Check size={18} />}
          {iosNeedsInstall ? "Comment l'installer" : 'Activer les notifications'}
        </button>
        <button className="text-button full-width" onClick={() => void postpone()} disabled={busy}>Plus tard</button>
      </div>
    </section>
  </div>
}
