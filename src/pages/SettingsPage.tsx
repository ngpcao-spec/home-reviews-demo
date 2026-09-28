import { Bell, Building2, ChevronRight, CreditCard, Database, LogOut, Shield, Sparkles, User } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useApp } from '../app/AppContext'
import { PageHeader } from '../components/ui/PageHeader'
import { relativeTime, timeUntil } from '../lib/format'
import { saveNotificationPreference } from '../lib/notification-preferences'
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

const MONITORING_INTERVALS: Array<{ value: MonitoringIntervalHours; label: string }> = [
  { value: 1, label: '1 heure — Test' },
  { value: 3, label: '3 heures — Test' },
  { value: 6, label: '6 heures' },
  { value: 12, label: '12 heures — Recommandé' },
  { value: 24, label: '24 heures' },
]

const MONITORING_STORAGE_KEY = 'home-reviews-monitoring-interval-hours'

function isMonitoringInterval(value: number): value is MonitoringIntervalHours {
  return MONITORING_INTERVALS.some((interval) => interval.value === value)
}

function getStoredMonitoringInterval(): MonitoringIntervalHours {
  if (typeof window === 'undefined') return 12
  const value = Number(window.localStorage.getItem(MONITORING_STORAGE_KEY))
  return isMonitoringInterval(value) ? value : 12
}

export function SettingsPage() {
  const { currentUser, plan, establishments, aiUsage, demoMode, pushToast, monitoringIntervalHours, updateMonitoringInterval: persistMonitoringInterval, signOut } = useApp()
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
      pushToast('Notifications push non prises en charge')
      return
    }
    if (isIosDevice() && !isStandalonePwa()) {
      pushToast('Sur iPhone, ajoutez HOME Reviews à l’écran d’accueil pour activer les notifications')
      return
    }
    if (Notification.permission === 'denied') {
      setPushState('denied')
      await saveNotificationPreference('denied')
      pushToast('Permission refusée dans les réglages du navigateur')
      return
    }

    setPushBusy(true)
    try {
      if (pushState === 'enabled') {
        await disablePushNotifications()
        await saveNotificationPreference('unknown')
        setPushState('disabled')
        pushToast('Notifications push désactivées')
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
      pushToast('Notifications push activées')
    } catch {
      setPushState(getPushUiState(true, Notification.permission, false))
      pushToast('Impossible d’activer les notifications push')
    } finally {
      setPushBusy(false)
    }
  }

  const disconnect = async () => {
    setSigningOut(true)
    try {
      await signOut()
    } catch {
      pushToast('Impossible de fermer la session')
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
      pushToast(`Surveillance réglée toutes les ${value} heure${value > 1 ? 's' : ''}`)
    } catch {
      setMonitoringInterval(previousValue)
      pushToast('Impossible de modifier la fréquence')
    } finally {
      setSavingMonitoring(false)
    }
  }

  return <><PageHeader title="Plus"/>
  <section className="profile-card card"><div className="profile-avatar">{currentUser.avatarUrl ? <img src={currentUser.avatarUrl} alt="" referrerPolicy="no-referrer" /> : currentUser.initials}</div><div><h2>{currentUser.name}</h2><p>{currentUser.email}</p><span>HOME France</span></div></section>
  {demoMode&&<div className="demo-banner"><Sparkles/><div><strong>Mode démonstration</strong><span>Données locales, aucun service externe requis.</span></div></div>}
  <SettingsSection title="Compte"><SettingLink icon={<User/>} title="Profil" detail="Nom et adresse email"/><SettingLink icon={<Building2/>} title="Organisation" detail="HOME France · Propriétaire"/><button className="setting-row clickable" onClick={() => void disconnect()} disabled={signingOut}><div className="setting-icon"><LogOut/></div><div><strong>{signingOut ? 'Déconnexion…' : 'Se déconnecter'}</strong><span>Fermer cette session uniquement</span></div><ChevronRight/></button></SettingsSection>
  <SettingsSection title="Notifications"><div className="setting-row"><div className="setting-icon"><Bell/></div><div><strong>Notifications in-app</strong><span>Alertes visibles dans l’application</span></div><Switch value={inApp} onChange={()=>setInApp(!inApp)}/></div><button className="setting-row clickable" onClick={() => void togglePush()} disabled={pushBusy}><div className="setting-icon"><Bell/></div><div><strong>{pushState === 'enabled' ? 'Désactiver les notifications' : 'Activer les notifications'}</strong><span>État : {pushState === 'enabled' ? 'Activées' : pushState === 'denied' ? 'Permission refusée par le navigateur' : pushState === 'unsupported' ? 'Non prises en charge' : 'Désactivées'}</span>{isIosDevice() && !isStandalonePwa() && <span>Sur iPhone : ajoutez d’abord l’app à l’écran d’accueil.</span>}</div><ChevronRight/></button></SettingsSection>
  <SettingsSection title="Surveillance des avis">
    <div className="settings-info card">
      <label htmlFor="monitoring-interval">Fréquence de vérification</label>
      <select
        id="monitoring-interval"
        aria-label="Fréquence de vérification des avis"
        value={monitoringInterval}
        disabled={savingMonitoring}
        onChange={(event) => void updateMonitoringInterval(Number(event.target.value) as MonitoringIntervalHours)}
        style={{ minWidth: 190, height: 42, border: '1px solid var(--border)', borderRadius: 11, background: '#0e1327', color: 'var(--text)', padding: '0 10px' }}
      >
        {MONITORING_INTERVALS.map((interval) => <option key={interval.value} value={interval.value}>{interval.label}</option>)}
      </select>
      <span style={{ gridColumn: '1 / -1', lineHeight: 1.5 }}>HOME Reviews vérifie automatiquement les nouveaux avis Google selon cette fréquence.</span>
      {monitoringInterval <= 3 && <span style={{ gridColumn: '1 / -1', color: 'var(--orange)' }}>Test / consommation API plus élevée</span>}
      <span>Dernière synchronisation globale</span><strong>{lastSync ? relativeTime(lastSync) : 'Jamais'}</strong>
      <span>Prochain contrôle</span><strong>{nextSync ? timeUntil(nextSync) : 'Non planifié'}</strong>
    </div>
  </SettingsSection>
  <SettingsSection title="Abonnement"><div className="subscription-card card"><div><span>Plan actuel</span><strong>Professionnel</strong><em>Statut actif</em></div><CreditCard/><div className="quota"><span>Établissements <b>{establishments.length} / {plan.maxEstablishments}</b></span><i><b style={{width:`${establishments.length/plan.maxEstablishments*100}%`}}/></i><span>Réponses IA <b>{aiUsage} / {plan.maxAiResponsesMonth}</b></span><i><b style={{width:`${aiUsage/plan.maxAiResponsesMonth*100}%`}}/></i></div><button className="secondary-button full-width" onClick={()=>pushToast('Gestion du plan simulée en mode démo')}>Changer de plan</button></div></SettingsSection>
  <SettingsSection title="Données & confidentialité"><SettingLink icon={<Shield/>} title="Confidentialité" detail="Politique et gestion des données"/><SettingLink icon={<Database/>} title="Supprimer mon compte" detail="Demande avec confirmation forte" danger/></SettingsSection>
  <p className="version">HOME Reviews v1.0 · {demoMode ? 'Données de démonstration' : 'Données Supabase sécurisées'}</p>
  </>}

function SettingsSection({title,children}:{title:string;children:React.ReactNode}){return <section className="settings-section"><h2>{title}</h2><div className="settings-group card">{children}</div></section>}
function SettingLink({icon,title,detail,danger=false}:{icon:React.ReactNode;title:string;detail:string;danger?:boolean}){return <button className={`setting-row clickable${danger?' danger':''}`}><div className="setting-icon">{icon}</div><div><strong>{title}</strong><span>{detail}</span></div><ChevronRight/></button>}
function Switch({value,onChange}:{value:boolean;onChange:()=>void}){return <button role="switch" aria-checked={value} className={`switch ${value?'on':''}`} onClick={onChange}><span/></button>}
