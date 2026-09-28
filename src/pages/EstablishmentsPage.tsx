import { ChevronRight, MapPin, Star } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '../app/AppContext'
import { EstablishmentAvatar } from '../components/ui/EstablishmentAvatar'
import { BrandHeader } from '../components/ui/BrandHeader'
import { compactNumber } from '../lib/format'
import { isNegativeReview } from '../lib/review-list'

export function EstablishmentsPage() {
  const navigate = useNavigate()
  const { establishments, reviews } = useApp()
  return <>
    <BrandHeader title={<span className="establishments-title">Mes <strong>établissements</strong></span>} addAction={() => navigate('/etablissements/ajouter')} />
    <div className="establishment-list">{establishments.map((item) => {
      const pending = reviews.filter((review) => review.establishmentId === item.id && isNegativeReview(review)).length
      return <Link to={`/etablissements/${item.id}`} className="establishment-card card" key={item.id}>
        <EstablishmentAvatar id={item.id} name={item.name} large photoUrl={item.photoUrl} />
        <div className="est-info"><h2>{item.name}</h2><div className="rating-line"><Star fill="currentColor"/><strong>{item.currentRating.toFixed(1)}</strong><span>({compactNumber(item.currentReviewCount)} avis)</span></div><p>{item.category}</p><small><MapPin/> {item.city}</small></div>
        <div className={`pending-count ${pending ? 'has-pending' : ''}`} aria-label={`${pending} avis à traiter`}>{pending}</div><ChevronRight className="est-chevron" />
      </Link>
    })}</div>
  </>
}
