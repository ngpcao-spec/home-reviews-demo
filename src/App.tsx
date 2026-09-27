import { lazy, Suspense } from 'react'
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

function ProtectedApp() {
  const { authReady, dataReady, dataLoading, dataError, demoMode, isAuthenticated, retryData } = useApp()
  if (!authReady || dataLoading || (isAuthenticated && !dataReady)) return <div className="route-loading" aria-label="Chargement des données"><span/></div>
  if (dataError) return <main className="auth-page"><section className="auth-card card"><span className="eyebrow">Connexion aux données</span><h1>Données indisponibles</h1><p>{dataError}</p><button className="primary-button full-width" onClick={() => void retryData()}>Réessayer</button></section></main>
  if (!demoMode && !isAuthenticated) return <Navigate to="/connexion" replace />
  return <AppShell />
}

export default function App(){return <Suspense fallback={<div className="route-loading" aria-label="Chargement"><span/></div>}><Routes><Route path="/connexion" element={<AuthPage/>}/><Route element={<ProtectedApp/>}><Route index element={<HomePage/>}/><Route path="etablissements" element={<EstablishmentsPage/>}/><Route path="etablissements/ajouter" element={<AddEstablishmentPage/>}/><Route path="etablissements/:id" element={<EstablishmentDetailPage/>}/><Route path="avis" element={<ReviewsPage/>}/><Route path="avis/:id" element={<ReviewDetailPage/>}/><Route path="analyses" element={<AnalyticsPage/>}/><Route path="notifications" element={<NotificationsPage/>}/><Route path="plus" element={<SettingsPage/>}/><Route path="reglages" element={<Navigate to="/plus" replace/>}/><Route path="*" element={<NotFoundPage/>}/></Route></Routes></Suspense>}
