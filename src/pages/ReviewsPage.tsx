import { Filter, Inbox } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useApp } from '../app/AppContext'
import { ReviewRow } from '../components/reviews/ReviewRow'
import { BrandHeader } from '../components/ui/BrandHeader'
import { EmptyState } from '../components/ui/Loading'
import type { Review, Urgency } from '../types/domain'

const urgencyOrder: Record<Urgency, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const tabs = [{ key: 'to_process', label: 'À traiter' }, { key: 'processed', label: 'Traités' }, { key: 'all', label: 'Tous' }] as const

export function ReviewsPage() {
  const { reviews, establishments } = useApp(); const [params] = useSearchParams()
  const [tab, setTab] = useState<'to_process'|'processed'|'all'>(params.get('statut') === 'to_process' ? 'to_process' : 'to_process')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [establishment, setEstablishment] = useState(params.get('etablissement') ?? 'all')
  const [rating, setRating] = useState('all')
  const displayed = useMemo(() => reviews.filter((review) => (tab === 'all' || review.status === tab) && (establishment === 'all' || review.establishmentId === establishment) && (rating === 'all' || review.rating === Number(rating))).sort((a,b) => {
    if (tab === 'to_process') {
      const urgencyDiff = urgencyOrder[a.analysis?.urgency ?? 'low'] - urgencyOrder[b.analysis?.urgency ?? 'low']
      if (urgencyDiff) return urgencyDiff
    }
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  }), [reviews, tab, establishment, rating])
  const pendingCount = reviews.filter((review) => review.status === 'to_process').length
  return <><BrandHeader />
    <section className="reference-intro reviews-intro"><div><h1>Avis à traiter ({pendingCount})</h1><p>Répondez aux avis de vos clients rapidement<br/>pour améliorer votre réputation.</p></div><button className={`bare-icon ${filtersOpen ? 'active-filter' : ''}`} onClick={() => setFiltersOpen(!filtersOpen)} aria-label="Filtres"><Filter/></button></section>
    <div className="segmented-control" role="tablist">{tabs.map((item) => <button role="tab" aria-selected={tab===item.key} className={tab===item.key?'active':''} key={item.key} onClick={() => setTab(item.key)}>{item.label}<span>{item.key === 'all' ? reviews.length : reviews.filter((review)=>review.status===item.key).length}</span></button>)}</div>
    {filtersOpen && <div className="filter-panel card"><label>Établissement<select value={establishment} onChange={(e) => setEstablishment(e.target.value)}><option value="all">Tous les établissements</option>{establishments.map((item)=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Note<select value={rating} onChange={(e) => setRating(e.target.value)}><option value="all">Toutes les notes</option>{[1,2,3,4,5].map((value)=><option key={value} value={value}>{value} étoile{value>1?'s':''}</option>)}</select></label></div>}
    {displayed.length ? displayed.map((review: Review) => <ReviewRow review={review} key={review.id}/>) : <EmptyState icon={<Inbox/>} title="Rien à afficher" body={tab === 'to_process' ? 'Aucun avis ne demande une action pour le moment.' : 'Aucun avis ne correspond à ces filtres.'}/>} 
  </>
}
