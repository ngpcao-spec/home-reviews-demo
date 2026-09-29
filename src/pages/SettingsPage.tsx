import { Bell, ChevronRight, Database, LogOut, Shield, Sparkles, User } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useApp } from '../app/AppContext'
import { PageHeader } from '../components/ui/PageHeader'
import { relativeTime, timeUntil } from '../lib/format'
import { saveNotificationPreference } from '../lib/notification-preferences'
import { useI18n } from '../i18n'
import type { PreferredLanguage } from '../types/domain'
import {
  currentPushSubscription,
  disablePushNotifications,
  enablePushNotifications,
  getPushUiState,
  isIosDevice,
  isStandalonePwa,
  pushIsSupported,
  type PushUiState,
} from '../lib/push-notifications'

type MonitoringIntervalHours = 1 | 3 | 6 | 12 | 24

const MONITORING_INTERVALS: MonitoringIntervalHours[] = [1, 3, 6, 12, 24]

const MONITORING_STORAGE_KEY = 'home-reviews-monitoring-interval-hours'

function isMonitoringInterval(value: number): value is MonitoringIntervalHours {
  return MONITORING_INTERVALS.includes(value as MonitoringIntervalHours)
}

function getStoredMonitoringInterval(): MonitoringIntervalHours {
  if (typeof window === 'undefined') return 12
  const value = Number(window.localStorage.getItem(MONITORING_STORAGE_KEY))
  return isMonitoringInterval(value) ? value : 12
}

export function SettingsPage() {
  const { currentUser, establishments, demoMode, pushToast, monitoringIntervalHours, preferredLanguage, updatePreferredLanguage, updateMonitoringInterval: persistMonitoringInterval, signOut } = useApp()
  const { messages, language } = useI18n()
  const [inApp, setInApp] = useState(true)
  const [signingOut, setSigningOut] = useState(false)
  const [pushState, setPushState] = useState<PushUiState>(() => getPushUiState(
    typeof window !== 'undefined' && pushIsSupported(),
    typeof Notification === 'undefined' ? 'default' : Notification.permission,
    false,
  ))
  const [pushBusy, setPushBusy] = useState(false)
  const [monitoringInterval, setMonitoringInterval] = useState<MonitoringIntervalHours>(() => demoMode ? getStoredMonitoringInterval() : (isMonitoringInterval(monitoringIntervalHours) ? monitoringIntervalHours : 12))
  const [savingMonitoring, setSavingMonitoring] = useState(false)
  const [savingLanguage, setSavingLanguage] = useState(false)
  const lastSyncTimestamp = Math.max(...establishments.map((item) => new Date(item.lastSyncedAt).getTime()))
  const lastSync = Number.isFinite(lastSyncTimestamp) ? new Date(lastSyncTimestamp).toISOString() : null
  const nextSyncTimestamp = Math.min(...establishments
    .filter((item) => item.isActive && item.nextSyncAt)
    .map((item) => new Date(item.nextSyncAt as string).getTime()))
  const nextSync = Number.isFinite(nextSyncTimestamp) ? new Date(nextSyncTimestamp).toISOString() : null

  useEffect(() => {
    if (isMonitoringInterval(monitoringIntervalHours)) setMonitoringInterval(monitoringIntervalHours)
  }, [monitoringIntervalHours])

  useEffect(() => {
    let active = true
    if (!pushIsSupported()) return
    void currentPushSubscription().then((subscription) => {
      if (active) setPushState(getPushUiState(true, Notification.permission, Boolean(subscription)))
    }).catch(() => {
      if (active) setPushState(getPushUiState(true, Notification.permission, false))
    })
    return () => { active = false }
  }, [])

  const togglePush = async () => {
    if (!pushIsSupported()) {
      pushToast(messages.settings.pushUnsupported)
      return
    }
    if (isIosDevice() && !isStandalonePwa()) {
      pushToast(messages.settings.pushIosInstall)
      return
    }
    if (Notification.permission === 'denied') {
      setPushState('denied')
      await saveNotificationPreference('denied')
      pushToast(messages.settings.pushDenied)
      return
    }

    setPushBusy(true)
    try {
      if (pushState === 'enabled') {
        await disablePushNotifications()
        await saveNotificationPreference('unknown')
        setPushState('disabled')
        pushToast(messages.settings.pushDisabled)
        return
      }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        await saveNotificationPreference(permission === 'denied' ? 'denied' : 'unknown')
        setPushState(permission === 'denied' ? 'denied' : 'disabled')
        return
      }
      await enablePushNotifications()
      await saveNotificationPreference('granted')
      setPushState('enabled')
      pushToast(messages.settings.pushEnabled)
    } catch {
      setPushState(getPushUiState(true, Notification.permission, false))
      pushToast(messages.settings.pushFailed)
    } finally {
      setPushBusy(false)
    }
  }

  const disconnect = async () => {
    setSigningOut(true)
    try {
      await signOut()
    } catch {
      pushToast(messages.settings.signOutFailed)
      setSigningOut(false)
    }
  }

  const updateMonitoringInterval = async (value: MonitoringIntervalHours) => {
    const previousValue = monitoringInterval
    setMonitoringInterval(value)
    setSavingMonitoring(true)

    try {
      await persistMonitoringInterval(value)
      if (demoMode) window.localStorage.setItem(MONITORING_STORAGE_KEY, String(value))
      pushToast(messages.settings.monitoringSaved.replace('{hours}', String(value)))
    } catch {
      setMonitoringInterval(previousValue)
      pushToast(messages.settings.monitoringFailed)
    } finally {
      setSavingMonitoring(false)
    }
  }

  const changeLanguage = async (language: PreferredLanguage) => {
    setSavingLanguage(true)
    try {
      await updatePreferredLanguage(language)
      pushToast(language === 'vi' ? 'Đã cập nhật ngôn ngữ' : 'Langue mise à jour')
    } catch {
      pushToast(language === 'vi' ? 'Không thể cập nhật ngôn ngữ' : 'Impossible de modifier la langue')
    } finally {
      setSavingLanguage(false)
    }
  }

  return <><PageHeader title={messages.settings.title}/>
  <section className="settings-intro"><h1>{messages.settings.heading}</h1><p>{messages.settings.intro}</p></section>
  <section className="profile-card card"><div className="profile-avatar">{currentUser.avatarUrl ? <img src={currentUser.avatarUrl} alt="" referrerPolicy="no-referrer" /> : currentUser.initials}</div><div><h2>{currentUser.name}</h2><p>{currentUser.email}</p><span>{messages.settings.googleAccount}</span></div></section>
  {demoMode&&<div className="demo-banner"><Sparkles/><div><strong>{messages.settings.demo}</strong><span>{messages.settings.demoDetail}</span></div></div>}
  <SettingsSection title={messages.settings.account}><SettingLink icon={<User/>} title={messages.settings.profile} detail={messages.settings.profileDetail}/><button className="setting-row"><div className="setting-icon google-setting-icon">G</div><div><strong>{messages.settings.googleLogin}</strong><span>{messages.settings.googleLoginDetail}</span></div></button><button className="setting-row clickable danger" onClick={() => void disconnect()} disabled={signingOut}><div className="setting-icon"><LogOut/></div><div><strong>{signingOut ? '…' : messages.settings.signOut}</strong><span>{messages.settings.signOutDetail}</span></div><ChevronRight/></button></SettingsSection>
  <SettingsSection title={messages.language.settingTitle}><div className="settings-info card"><label htmlFor="preferred-language">{messages.language.settingDetail}</label><select id="preferred-language" className="monitoring-select" value={preferredLanguage ?? 'fr'} disabled={savingLanguage} onChange={(event) => void changeLanguage(event.target.value as PreferredLanguage)}><option value="fr">Français</option><option value="vi">Tiếng Việt</option></select></div></SettingsSection>
  <SettingsSection title={messages.settings.notifications}><div className="setting-row"><div className="setting-icon"><Bell/></div><div><strong>{messages.settings.inApp}</strong><span>HOME Reviews</span></div><Switch value={inApp} onChange={()=>setInApp(!inApp)}/></div><button className="setting-row clickable" onClick={() => void togglePush()} disabled={pushBusy}><div className="setting-icon"><Bell/></div><div><strong>{pushState === 'enabled' ? messages.settings.disableNotifications : messages.settings.enableNotifications}</strong><span>{pushState}</span>{isIosDevice() && !isStandalonePwa() && <span>iPhone · PWA</span>}</div><ChevronRight/></button></SettingsSection>
  <SettingsSection title={messages.settings.monitoring}>
    <div className="settings-info card">
      <label htmlFor="monitoring-interval">{messages.settings.monitoringFrequency}</label>
      <select
        id="monitoring-interval"
        aria-label={messages.settings.monitoringFrequency}
        value={monitoringInterval}
        disabled={savingMonitoring}
        onChange={(event) => void updateMonitoringInterval(Number(event.target.value) as MonitoringIntervalHours)}
        className="monitoring-select"
      >
        {MONITORING_INTERVALS.map((interval) => <option key={interval} value={interval}>{interval} {language === 'vi' ? 'giờ' : `heure${interval > 1 ? 's' : ''}`}{interval <= 3 ? ` — ${language === 'vi' ? 'Thử nghiệm' : 'Test'}` : interval === 12 ? ` — ${language === 'vi' ? 'Khuyên dùng' : 'Recommandé'}` : ''}</option>)}
      </select>
      <span style={{ gridColumn: '1 / -1', lineHeight: 1.5 }}>{messages.settings.monitoringDetail}</span>
      {monitoringInterval <= 3 && <span style={{ gridColumn: '1 / -1', color: 'var(--orange)' }}>{messages.settings.higherUsage}</span>}
      <span>{messages.settings.lastGlobalSync}</span><strong>{lastSync ? relativeTime(lastSync) : '—'}</strong>
      <span>{messages.settings.nextCheck}</span><strong>{nextSync ? timeUntil(nextSync) : '—'}</strong>
    </div>
  </SettingsSection>
  <SettingsSection title={messages.settings.privacy}><SettingLink icon={<Shield/>} title={messages.settings.privacyLink} detail="HOME Reviews"/><SettingLink icon={<Database/>} title={messages.settings.deleteAccount} detail="HOME Reviews" danger/></SettingsSection>
  <p className="version">{messages.settings.version} · {demoMode ? messages.settings.demoData : messages.settings.secureData}</p>
  </>}

function SettingsSection({title,children}:{title:string;children:React.ReactNode}){return <section className="settings-section"><h2>{title}</h2><div className="settings-group card">{children}</div></section>}
function SettingLink({icon,title,detail,danger=false}:{icon:React.ReactNode;title:string;detail:string;danger?:boolean}){return <button className={`setting-row clickable${danger?' danger':''}`}><div className="setting-icon">{icon}</div><div><strong>{title}</strong><span>{detail}</span></div><ChevronRight/></button>}
function Switch({value,onChange}:{value:boolean;onChange:()=>void}){return <button role="switch" aria-checked={value} className={`switch ${value?'on':''}`} onClick={onChange}><span/></button>}
