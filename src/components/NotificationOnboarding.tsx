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
import { useI18n } from '../i18n'

export function NotificationOnboarding() {
  const { dataReady, demoMode, isAuthenticated, pushToast } = useApp()
  const { messages } = useI18n()
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
  }, [dataReady, demoMode, iosNeedsInstall, isAuthenticated])

  const postpone = async () => {
    setBusy(true)
    try {
      await saveNotificationPreference('unknown')
      setVisible(false)
    } catch {
      pushToast(messages.onboarding.saveFailed)
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
      pushToast(messages.onboarding.unsupported)
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
        pushToast(messages.onboarding.denied)
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
      pushToast(messages.onboarding.enabled)
    } catch {
      pushToast(messages.onboarding.enableFailed)
    } finally {
      setBusy(false)
    }
  }

  if (!visible) return null

  return <div className="notification-onboarding-backdrop" role="presentation">
    <section className="notification-onboarding card" role="dialog" aria-modal="true" aria-labelledby="notification-onboarding-title">
      <div className="notification-onboarding-icon"><Bell aria-hidden="true" /></div>
      <h2 id="notification-onboarding-title">{messages.onboarding.title}</h2>
      <p>{messages.onboarding.body}</p>
      {iosNeedsInstall && <div className="notification-onboarding-info" role="status">
        <span>{messages.onboarding.installMessage}</span>
        {showInstallSteps && <ol>
          <li>{messages.onboarding.installStep1}</li>
          <li>{messages.onboarding.installStep2}</li>
          <li>{messages.onboarding.installStep3}</li>
          <li>{messages.onboarding.installStep4}</li>
        </ol>}
      </div>}
      <div className="notification-onboarding-actions">
        <button
          className="primary-button full-width"
          onClick={iosNeedsInstall ? () => setShowInstallSteps(true) : () => void activate()}
          disabled={busy}
        >
          {iosNeedsInstall ? <Share2 size={18} /> : <Check size={18} />}
          {iosNeedsInstall ? messages.onboarding.install : messages.onboarding.activate}
        </button>
        <button className="text-button full-width" onClick={() => void postpone()} disabled={busy}>{messages.onboarding.later}</button>
      </div>
    </section>
  </div>
}
