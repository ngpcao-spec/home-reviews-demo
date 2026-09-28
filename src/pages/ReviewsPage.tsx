import { Filter, Inbox } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useApp } from '../app/AppContext'
import { ReviewRow } from '../components/reviews/ReviewRow'
import { BrandHeader } from '../components/ui/BrandHeader'
import { EmptyState } from '../components/ui/Loading'
import type { Review } from '../types/domain'
import { nextVisibleReviewCount, REVIEWS_PAGE_SIZE, visibleReviewBatch } from '../lib/review-list'

const tabs = [{ key: 'to_process', label: 'À traiter' }, { key: 'processed', label: 'Traités' }, { key: 'all', label: 'Tous' }] as const

export function ReviewsPage() {
  const { reviews, establishments } = useApp()
  const [params] = useSearchParams()
  const requestedStatus = params.get('statut')
  const [tab, setTab] = useState<'to_process'|'processed'|'all'>(
    requestedStatus === 'processed' || requestedStatus === 'all' ? requestedStatus : 'to_process',
  )
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [establishment, setEstablishment] = useState(params.get('etablissement') ?? 'all')
  const [rating, setRating] = useState('all')
  const [visibleCount, setVisibleCount] = useState(REVIEWS_PAGE_SIZE)
  const displayed = useMemo(() => reviews
    .filter((review) => (tab === 'all' || review.status === tab)
      && (establishment === 'all' || review.establishmentId === establishment)
      && (rating === 'all' || review.rating === Number(rating)))
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()),
  [reviews, tab, establishment, rating])
  const pendingCount = reviews.filter((review) => review.status === 'to_process').length
  const visibleReviews = visibleReviewBatch(displayed, visibleCount)

  return <><BrandHeader />
    <section className="reference-intro reviews-intro"><div><h1>Avis à traiter ({pendingCount})</h1><p>Répondez aux avis de vos clients rapidement<br/>pour améliorer votre réputation.</p></div><button className={`bare-icon ${filtersOpen ? 'active-filter' : ''}`} onClick={() => setFiltersOpen(!filtersOpen)} aria-label="Filtres"><Filter/></button></section>
    <div className="segmented-control" role="tablist">{tabs.map((item) => <button role="tab" aria-selected={tab===item.key} className={tab===item.key?'active':''} key={item.key} onClick={() => { setTab(item.key); setVisibleCount(REVIEWS_PAGE_SIZE) }}>{item.label}<span>{item.key === 'all' ? reviews.length : reviews.filter((review)=>review.status===item.key).length}</span></button>)}</div>
    {filtersOpen && <div className="filter-panel card"><label>Établissement<select value={establishment} onChange={(event) => { setEstablishment(event.target.value); setVisibleCount(REVIEWS_PAGE_SIZE) }}><option value="all">Tous les établissements</option>{establishments.map((item)=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Note<select value={rating} onChange={(event) => { setRating(event.target.value); setVisibleCount(REVIEWS_PAGE_SIZE) }}><option value="all">Toutes les notes</option>{[1,2,3,4,5].map((value)=><option key={value} value={value}>{value} étoile{value>1?'s':''}</option>)}</select></label></div>}
    {displayed.length ? <>
      {visibleReviews.map((review: Review) => <ReviewRow review={review} key={review.id}/>)}
      {visibleCount < displayed.length && <button
        className="secondary-button full-width"
        onClick={() => setVisibleCount((current) => nextVisibleReviewCount(displayed.length, current))}
      >
        Charger plus d’avis
      </button>}
    </> : <EmptyState icon={<Inbox/>} title="Rien à afficher" body={tab === 'to_process' ? 'Aucun avis ne demande une action pour le moment.' : 'Aucun avis ne correspond à ces filtres.'}/>}
  </>
}
