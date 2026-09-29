import { ChevronRight, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useApp } from '../../app/AppContext'
import { relativeTime } from '../../lib/format'
import type { Review } from '../../types/domain'
import { EstablishmentAvatar } from '../ui/EstablishmentAvatar'
import { useI18n } from '../../i18n'

export function ReviewRow({ review, compact = false }: { review: Review; compact?: boolean }) {
  const { establishments } = useApp()
  const { messages } = useI18n()
  const establishment = establishments.find((item) => item.id === review.establishmentId)
  if (!establishment) return null
  return <Link to={`/avis/${review.id}`} className={`review-row${compact ? ' review-row-compact' : ''}`}>
    <EstablishmentAvatar id={establishment.id} name={establishment.name} photoUrl={establishment.photoUrl} />
    <div className="review-row-content">
      <div className="review-meta"><strong className={`numeric-rating rating-${review.rating}`}>{review.rating} <span>★</span></strong><span>{relativeTime(review.publishedAt)}</span></div>
      <p>{review.reviewText}</p>
      <div className="review-foot"><strong>{establishment.name}</strong>{review.aiStatus === 'completed' && <span className="ai-ready"><Sparkles size={12}/>{messages.reviews.replyReady}</span>}</div>
    </div>
    <ChevronRight className="row-chevron" size={18} />
  </Link>
}
