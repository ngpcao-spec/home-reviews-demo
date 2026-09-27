import { lazy, Suspense, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useApp } from './app/AppContext'
import { AppShell } from './components/ui/AppShell'

const AddEstablishmentPage=lazy(()=>import('./pages/AddEstablishmentPage').then(m=>({default:m.AddEstablishmentPage})))
const AnalyticsPage=lazy(()=>import('./pages/AnalyticsPage').then(m=>({default:m.AnalyticsPage})))
const AuthPage=lazy(()=>import('./pages/AuthPage').then(m=>({default:m.AuthPage})))
const EstablishmentDetailPage=lazy(()=>import('./pages/EstablishmentDetailPage').then(m=>({default:m.EstablishmentDetailPage})))
const EstablishmentsPage=lazy(()=>import('./pages/EstablishmentsPage').then(m=>({default:m.EstablishmentsPage})))
const HomePage=lazy(()=>import('./pages/HomePage').then(m=>({default:m.HomePage})))
const NotificationsPage=lazy(()=>import('./pages/NotificationsPage').then(m=>({default:m.NotificationsPage})))
const NotFoundPage=lazy(()=>import('./pages/NotFoundPage').then(m=>({default:m.NotFoundPage})))
const ReviewDetailPage=lazy(()=>import('./pages/ReviewDetailPage').then(m=>({default:m.ReviewDetailPage})))
const ReviewsPage=lazy(()=>import('./pages/ReviewsPage').then(m=>({default:m.ReviewsPage})))
const SettingsPage=lazy(()=>import('./pages/SettingsPage').then(m=>({default:m.SettingsPage})))


function PasswordRecoveryScreen() {
  const { completePasswordRecovery } = useApp()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (password.length < 8) return setError('Le mot de passe doit contenir au moins 8 caractères.')
    if (password !== confirmation) return setError('Les deux mots de passe ne correspondent pas.')
    setSaving(true)
    try {
      await completePasswordRecovery(password)
    } catch {
      setError('Le lien est invalide ou expiré. Demandez un nouveau lien de réinitialisation.')
    } finally {
      setSaving(false)
    }
  }
  return <main className="auth-page"><div className="auth-brand"><span>H</span><div><strong>HOME</strong><small>REVIEWS</small></div></div><section className="auth-card card"><span className="eyebrow">Sécurité</span><h1>Nouveau mot de passe</h1><p>Choisissez un nouveau mot de passe pour votre compte HOME Reviews.</p><form onSubmit={submit}><label><span>Nouveau mot de passe</span><div><input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password"/></div></label><label><span>Confirmer le mot de passe</span><div><input required minLength={8} type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password"/></div></label>{error&&<p className="field-error">{error}</p>}<button className="primary-button full-width" type="submit" disabled={saving}>{saving?'Enregistrement…':'Enregistrer le mot de passe'}</button></form></section></main>
}

function ProtectedApp() {
  const { authReady, dataReady, dataLoading, dataError, demoMode, isAuthenticated, retryData } = useApp()
  if (!authReady || dataLoading || (isAuthenticated && !dataReady)) return <div className="route-loading" aria-label="Chargement des données"><span/></div>
  if (dataError) return <main className="auth-page"><section className="auth-card card"><span className="eyebrow">Connexion aux données</span><h1>Données indisponibles</h1><p>{dataError}</p><button className="primary-button full-width" onClick={() => void retryData()}>Réessayer</button></section></main>
  if (!demoMode && !isAuthenticated) return <Navigate to="/connexion" replace />
  return <AppShell />
}

export default function App(){const { passwordRecovery }=useApp();if(passwordRecovery)return <PasswordRecoveryScreen/>;return <Suspense fallback={<div className="route-loading" aria-label="Chargement"><span/></div>}><Routes><Route path="/connexion" element={<AuthPage/>}/><Route element={<ProtectedApp/>}><Route index element={<HomePage/>}/><Route path="etablissements" element={<EstablishmentsPage/>}/><Route path="etablissements/ajouter" element={<AddEstablishmentPage/>}/><Route path="etablissements/:id" element={<EstablishmentDetailPage/>}/><Route path="avis" element={<ReviewsPage/>}/><Route path="avis/:id" element={<ReviewDetailPage/>}/><Route path="analyses" element={<AnalyticsPage/>}/><Route path="notifications" element={<NotificationsPage/>}/><Route path="plus" element={<SettingsPage/>}/><Route path="reglages" element={<Navigate to="/plus" replace/>}/><Route path="*" element={<NotFoundPage/>}/></Route></Routes></Suspense>}
