import { lazy, Suspense, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useApp } from './app/AppContext'
import { AppShell } from './components/ui/AppShell'
import { NotificationOnboarding } from './components/NotificationOnboarding'
import { LanguageSelection } from './components/LanguageSelection'
import { NavigationResume } from './components/NavigationResume'

const AddEstablishmentPage=lazy(()=>import('./pages/AddEstablishmentPage').then(m=>({default:m.AddEstablishmentPage})))
const AnalyticsPage=lazy(()=>import('./pages/AnalyticsPage').then(m=>({default:m.AnalyticsPage})))
const AuthPage=lazy(()=>import('./pages/AuthPage').then(m=>({default:m.AuthPage})))
const EstablishmentDetailPage=lazy(()=>import('./pages/EstablishmentDetailPage').then(m=>({default:m.EstablishmentDetailPage})))
const EstablishmentsPage=lazy(()=>import('./pages/EstablishmentsPage').then(m=>({default:m.EstablishmentsPage})))
const HomePage=lazy(()=>import('./pages/HomePage').then(m=>({default:m.HomePage})))
const NotificationOnboardingResetPage=lazy(()=>import('./pages/NotificationOnboardingResetPage').then(m=>({default:m.NotificationOnboardingResetPage})))
const NotificationsPage=lazy(()=>import('./pages/NotificationsPage').then(m=>({default:m.NotificationsPage})))
const NotFoundPage=lazy(()=>import('./pages/NotFoundPage').then(m=>({default:m.NotFoundPage})))
const ReviewDetailPage=lazy(()=>import('./pages/ReviewDetailPage').then(m=>({default:m.ReviewDetailPage})))
const ReviewsPage=lazy(()=>import('./pages/ReviewsPage').then(m=>({default:m.ReviewsPage})))
const SettingsPage=lazy(()=>import('./pages/SettingsPage').then(m=>({default:m.SettingsPage})))
const RepresentativeHumanPage=lazy(()=>import('./pages/RepresentativeHumanPage').then(m=>({default:m.RepresentativeHumanPage})))
const GoldAdjudicationPage=lazy(()=>import('./pages/GoldAdjudicationPage').then(m=>({default:m.GoldAdjudicationPage})))
const GoldSetPage=lazy(()=>import('./pages/GoldSetPage').then(m=>({default:m.GoldSetPage})))
const V9FindingAuditPage=lazy(()=>import('./pages/V9FindingAuditPage').then(m=>({default:m.V9FindingAuditPage})))
const JevV13Page=lazy(()=>import('./pages/JevV13Page').then(m=>({default:m.JevV13Page})))
const IndependentJevPage=lazy(()=>import('./pages/IndependentJevPage').then(m=>({default:m.IndependentJevPage})))
const JevV12TestPage=lazy(()=>import('./pages/JevV12TestPage').then(m=>({default:m.JevV12TestPage})))
const AiExploratoryBenchmarkPage=lazy(()=>import('./pages/AiExploratoryBenchmarkPage').then(m=>({default:m.AiExploratoryBenchmarkPage})))
const JevExploratoryPage=lazy(()=>import('./pages/JevExploratoryPage').then(m=>({default:m.JevExploratoryPage})))
const NegativeValidationPage=lazy(()=>import('./pages/NegativeValidationPage').then(m=>({default:m.NegativeValidationPage})))
const JevBenchmarkPage=lazy(()=>import('./pages/JevBenchmarkPage').then(m=>({default:m.JevBenchmarkPage})))


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
  const { authReady, dataReady, dataLoading, dataError, demoMode, isAuthenticated, preferredLanguage, retryData } = useApp()
  // Session/IndexedDB hydration is local: keep a branded shell, not a black spinner.
  if (!authReady || (isAuthenticated && !dataReady && !dataLoading)) return <main className="auth-page" aria-busy="true"><div className="auth-brand"><span>H</span><div><strong>HOME</strong><small>REVIEWS</small></div></div></main>
  if (isAuthenticated && !dataReady) return <div className="route-loading" aria-label="Chargement des données"><span/></div>
  if (dataError) return <main className="auth-page"><section className="auth-card card"><span className="eyebrow">Connexion aux données</span><h1>Données indisponibles</h1><p>{dataError}</p><button className="primary-button full-width" onClick={() => void retryData()}>Réessayer</button></section></main>
  if (!demoMode && !isAuthenticated) return <Navigate to="/connexion" replace />
  if (!demoMode && !preferredLanguage) return <LanguageSelection />
  return <><NavigationResume /><AppShell /><NotificationOnboarding /></>
}

export default function App(){const { passwordRecovery }=useApp();if(passwordRecovery)return <PasswordRecoveryScreen/>;return <Suspense fallback={<div className="route-loading" aria-label="Chargement"><span/></div>}><Routes><Route path="/connexion" element={<AuthPage/>}/><Route path="/test/notifications/reset" element={<NotificationOnboardingResetPage/>}/><Route element={<ProtectedApp/>}><Route index element={<HomePage/>}/><Route path="etablissements" element={<EstablishmentsPage/>}/><Route path="etablissements/ajouter" element={<AddEstablishmentPage/>}/><Route path="etablissements/:id" element={<EstablishmentDetailPage/>}/><Route path="avis" element={<ReviewsPage/>}/><Route path="avis/:id" element={<ReviewDetailPage/>}/><Route path="analyses" element={<AnalyticsPage/>}/><Route path="notifications" element={<NotificationsPage/>}/><Route path="plus" element={<SettingsPage/>}/><Route path="plus/jev-benchmark" element={<JevBenchmarkPage/>}/><Route path="plus/gold-set" element={<GoldSetPage/>}/><Route path="plus/representative-test" element={<RepresentativeHumanPage/>}/><Route path="plus/gold-check" element={<GoldAdjudicationPage/>}/><Route path="plus/v9-finding-audit" element={<V9FindingAuditPage/>}/><Route path="plus/jev-v13-test" element={<JevV13Page/>}/><Route path="plus/jev-independent-test" element={<IndependentJevPage/>}/><Route path="plus/jev-v12-test" element={<JevV12TestPage/>}/><Route path="plus/ai-exploratory-benchmark" element={<AiExploratoryBenchmarkPage/>}/><Route path="plus/jev-exploratory" element={<JevExploratoryPage/>}/><Route path="plus/negative-validation" element={<NegativeValidationPage/>}/><Route path="reglages" element={<Navigate to="/plus" replace/>}/><Route path="*" element={<NotFoundPage/>}/></Route></Routes></Suspense>}
