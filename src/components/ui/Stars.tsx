import { Star } from 'lucide-react'

export function Stars({ rating, compact = false }: { rating: number; compact?: boolean }) {
  return <span className="stars" aria-label={`${rating} étoiles sur 5`}>
    {Array.from({ length: 5 }, (_, i) => <Star key={i} size={compact ? 13 : 16} fill={i < rating ? 'currentColor' : 'transparent'} />)}
  </span>
}
