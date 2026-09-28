import { ArrowRight, BarChart3, Building2, ChevronRight, MessageSquareText, Plus, Sparkles, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../app/AppContext'
import { ReviewRow } from '../components/reviews/ReviewRow'
import { BrandHeader } from '../components/ui/BrandHeader'
import { PageHeader } from '../components/ui/PageHeader'
import { timeUntil } from '../lib/format'
import { isNegativeReview, recentNegativeReviews } from '../lib/review-list'

export function HomePage() {
  const navigate = useNavigate()
  const { establishments, reviews, demoMode, injectNegativeReview } = useApp()
  const active = establishments.filter((item) => item.isActive)
  const pending = reviews.filter((item) => isNegativeReview(item) && item.status === 'to_process')
  const latestNegative = recentNegativeReviews(reviews)
  const weightedRating = active.length ? active.reduce((sum, item) => sum + item.currentRating * item.currentReviewCount, 0) / active.reduce((sum, item) => sum + item.currentReviewCount, 0) : 0
  const featured = active[0]
  const [clock, setClock] = useState(() => Date.now())

  useEffect(() => {
    if (!featured?.nextSyncAt) return
    const refresh = () => setClock(Date.now())
    let intervalId: number | undefined
    const timeoutId = window.setTimeout(() => {
      refresh()
      intervalId = window.setInterval(refresh, 60_000)
    }, 60_000 - (Date.now() % 60_000))
    return () => {
      window.clearTimeout(timeoutId)
      if (intervalId !== undefined) window.clearInterval(intervalId)
    }
  }, [featured?.nextSyncAt])

  const syncStatus = featured?.syncStatus === 'ok' ? 'À jour'
    : featured?.syncStatus === 'syncing' ? 'En cours'
      : featured?.syncStatus === 'error' ? 'Erreur'
        : featured?.syncStatus === 'pending' ? 'En attente'
          : 'Statut inconnu'

  if (!establishments.length) return <><PageHeader title="HOME Reviews" /><div className="empty-state"><div className="empty-icon"><Building2 /></div><h2>Ajoutez votre premier établissement</h2><p>Surveillez les nouveaux avis et identifiez immédiatement ceux qui demandent une action.</p><button className="primary-button" onClick={() => navigate('/etablissements/ajouter')}><Plus size={18}/>Ajouter un établissement</button></div></>

  return <>
    <BrandHeader />
    {featured && <section className="home-feature-grid">
      <button className="featured-establishment" onClick={() => navigate(`/etablissements/${featured.id}`)}>
        {featured.photoUrl && <img src={featured.photoUrl.startsWith('/') ? `${import.meta.env.BASE_URL}${featured.photoUrl.replace(/^\/+/, '')}` : featured.photoUrl} alt="" />}
        <span className="featured-overlay" />
        <span className="featured-copy"><strong>{featured.name}</strong><span><Star fill="currentColor" /> {featured.currentRating.toFixed(1)} <small>({featured.currentReviewCount} avis)</small></span><em>{pending.filter((item) => item.establishmentId === featured.id).length} avis à traiter</em></span>
        <span className="featured-arrow"><ArrowRight /></span>
      </button>
      <div className="home-sync-card card"><Sparkles/><strong>Surveillance</strong><span className={`home-sync-state ${featured.syncStatus}`}>● {syncStatus}</span><small>Prochain contrôle</small><span className="home-sync-next">{featured.nextSyncAt ? timeUntil(featured.nextSyncAt, clock) : 'Non planifié'}</span></div>
    </section>}
    <div className="home-summary" aria-label="Résumé"><span>{active.length} établissement{active.length > 1 ? 's' : ''}</span><span>{pending.length} avis à traiter</span><span>Note {weightedRating.toFixed(1)}</span></div>
    <div className="section-heading home-section-heading"><h2>Accès rapides</h2><button className="text-button" onClick={() => navigate('/etablissements')}>Voir tout <ChevronRight /></button></div>
    <div className="quick-actions">
      <button className="quick-action card" onClick={() => navigate('/etablissements')}><Building2/><span><strong>Établissements</strong><small>Gérer vos lieux</small></span><ArrowRight/></button>
      <button className="quick-action card" onClick={() => navigate('/avis')}><MessageSquareText/><span><strong>Réponses IA</strong><small>{pending.length} avis à traiter</small></span><ArrowRight/></button>
      <button className="quick-action card" onClick={() => navigate('/analyses')}><BarChart3/><span><strong>Analyses</strong><small>Suivre les tendances</small></span><ArrowRight/></button>
      <button className="quick-action card" onClick={() => navigate('/etablissements/ajouter')}><Plus/><span><strong>Ajouter</strong><small>Un établissement</small></span><ArrowRight/></button>
    </div>
    <div className="section-heading"><h2>Avis négatifs récents</h2><button className="text-button" onClick={() => navigate('/avis')}>Voir tout <ChevronRight /></button></div>
    {latestNegative.length ? latestNegative.map((review) => <ReviewRow compact key={review.id} review={review} />) : <div className="positive-state"><Sparkles/><div><strong>Tout est sous contrôle</strong><span>Aucun avis négatif récent.</span></div></div>}
    {demoMode && <button className="demo-button" onClick={injectNegativeReview}><Sparkles size={16}/>Injecter un nouvel avis négatif</button>}
  </>
}
