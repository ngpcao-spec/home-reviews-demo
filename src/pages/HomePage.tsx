import { Building2, ChevronRight, CircleAlert, Frown, Plus, Sparkles, Star, Store } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../app/AppContext'
import { ReviewRow } from '../components/reviews/ReviewRow'
import { BrandHeader } from '../components/ui/BrandHeader'
import { PageHeader } from '../components/ui/PageHeader'

const pageLoadedAt = Date.now()

export function HomePage() {
  const navigate = useNavigate()
  const { establishments, reviews, demoMode, injectNegativeReview } = useApp()
  const active = establishments.filter((item) => item.isActive)
  const pending = reviews.filter((item) => item.status === 'to_process')
  const weightedRating = active.length ? active.reduce((sum, item) => sum + item.currentRating * item.currentReviewCount, 0) / active.reduce((sum, item) => sum + item.currentReviewCount, 0) : 0

  if (!establishments.length) return <><PageHeader title="HOME Reviews" /><div className="home-greeting"><span className="eyebrow">Votre réputation, en clair</span><h2>Bonjour Linh</h2></div><div className="empty-state"><div className="empty-icon"><Building2 /></div><h2>Ajoutez votre premier établissement</h2><p>Surveillez les nouveaux avis et identifiez immédiatement ceux qui demandent une action.</p><button className="primary-button" onClick={() => navigate('/etablissements/ajouter')}><Plus size={18}/>Ajouter un établissement</button></div></>

  return <>
    <BrandHeader />
    <section className="reference-intro home-intro"><h1>Bonjour !</h1><p>Voici la situation de vos établissements.</p></section>
    <button className="attention-card" onClick={() => navigate('/avis?statut=to_process')}>
      <span className="attention-symbol"><CircleAlert /></span><span><strong>{pending.length} avis nécessitent votre attention</strong><em>+{pending.filter((item) => pageLoadedAt - new Date(item.publishedAt).getTime() < 86_400_000).length} depuis hier</em></span><ChevronRight />
    </button>
    <div className="kpi-grid">
      <div className="kpi-card card"><span className="kpi-icon purple"><Store /></span><strong>{active.length}</strong><small>Établissements</small></div>
      <div className="kpi-card card"><span className="kpi-icon red"><Frown /></span><strong>{pending.length}</strong><small>Avis négatifs</small></div>
      <div className="kpi-card card kpi-positive"><span className="kpi-icon green"><Star /></span><strong>{weightedRating.toFixed(1)}</strong><small>Note moyenne</small></div>
    </div>
    <div className="section-heading"><h2>Avis récents</h2><button className="text-button" onClick={() => navigate('/avis')}>Voir tout <ChevronRight /></button></div>
    {pending.length ? pending.slice(0, 3).map((review) => <ReviewRow compact key={review.id} review={review} />) : <div className="positive-state"><Sparkles/><div><strong>Tout est sous contrôle</strong><span>Aucun avis négatif en attente.</span></div></div>}
    {demoMode && <button className="demo-button" onClick={injectNegativeReview}><Sparkles size={16}/>Injecter un nouvel avis négatif</button>}
  </>
}
