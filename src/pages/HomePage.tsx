import { ArrowLeft, ArrowRight, BarChart3, Building2, ChevronRight, MessageSquareText, Plus, Sparkles, Star } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../app/AppContext'
import { ReviewRow } from '../components/reviews/ReviewRow'
import { BrandHeader } from '../components/ui/BrandHeader'
import { PageHeader } from '../components/ui/PageHeader'
import { isNegativeReview, recentNegativeReviews } from '../lib/review-list'
import { useI18n } from '../i18n'

export function HomePage() {
  const navigate = useNavigate()
  const { establishments, reviews, demoMode, injectNegativeReview } = useApp()
  const { messages } = useI18n()
  const active = establishments.filter((item) => item.isActive)
  const pending = reviews.filter((item) => isNegativeReview(item) && item.status === 'to_process')
  const latestNegative = recentNegativeReviews(reviews)
  const weightedRating = active.length ? active.reduce((sum, item) => sum + item.currentRating * item.currentReviewCount, 0) / active.reduce((sum, item) => sum + item.currentReviewCount, 0) : 0
  const activeIds = active.map((item) => item.id).join('|')
  const [selectedEstablishmentId, setSelectedEstablishmentId] = useState<string | undefined>(() => active[0]?.id)
  const featuredId = active.some((item) => item.id === selectedEstablishmentId) ? selectedEstablishmentId : active[0]?.id
  const featuredIndex = Math.max(0, active.findIndex((item) => item.id === featuredId))
  const featured = active[featuredIndex]
  const carouselRef = useRef<HTMLDivElement>(null)
  const scrollTimerRef = useRef<number | undefined>(undefined)
  const gestureRef = useRef({ startX: 0, startY: 0, moved: false })

  useLayoutEffect(() => {
    const carousel = carouselRef.current
    if (!carousel) return
    const frame = window.requestAnimationFrame(() => carousel.scrollTo({ left: carousel.clientWidth * featuredIndex, behavior: 'auto' }))
    return () => window.cancelAnimationFrame(frame)
  }, [activeIds, featuredIndex])

  useEffect(() => () => {
    if (scrollTimerRef.current !== undefined) window.clearTimeout(scrollTimerRef.current)
  }, [])

  const selectEstablishment = (index: number) => {
    const carousel = carouselRef.current
    if (!carousel || index < 0 || index >= active.length) return
    carousel.scrollTo({ left: carousel.clientWidth * index, behavior: 'smooth' })
  }

  const updateSelectionAfterScroll = () => {
    if (scrollTimerRef.current !== undefined) window.clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = window.setTimeout(() => {
      const carousel = carouselRef.current
      if (!carousel?.clientWidth) return
      const index = Math.max(0, Math.min(active.length - 1, Math.round(carousel.scrollLeft / carousel.clientWidth)))
      setSelectedEstablishmentId(active[index]?.id)
    }, 90)
  }

  const startGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    gestureRef.current = { startX: event.clientX, startY: event.clientY, moved: false }
  }

  const trackGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const horizontal = Math.abs(event.clientX - gestureRef.current.startX)
    const vertical = Math.abs(event.clientY - gestureRef.current.startY)
    if (horizontal > 10 && horizontal > vertical) gestureRef.current.moved = true
  }

  const finishGesture = () => {
    window.setTimeout(() => { gestureRef.current.moved = false }, 0)
  }

  const openEstablishment = (event: ReactMouseEvent<HTMLButtonElement>, establishmentId: string) => {
    if (gestureRef.current.moved) {
      event.preventDefault()
      return
    }
    navigate(`/etablissements/${establishmentId}`)
  }

  if (!establishments.length) return <><PageHeader title="HOME Reviews" /><div className="empty-state"><div className="empty-icon"><Building2 /></div><h2>{messages.home.addFirst}</h2><p>{messages.home.addFirstBody}</p><button className="primary-button" onClick={() => navigate('/etablissements/ajouter')}><Plus size={18}/>{messages.home.add}</button></div></>

  return <>
    <BrandHeader />
    {featured && <section className="home-feature-grid">
      <div className="featured-carousel">
        <div
          className="featured-carousel-viewport"
          ref={carouselRef}
          role="region"
          aria-label={messages.home.featured}
          onScroll={updateSelectionAfterScroll}
          onPointerDown={startGesture}
          onPointerMove={trackGesture}
          onPointerUp={finishGesture}
          onPointerCancel={finishGesture}
        >
          <div className="featured-carousel-track">
            {active.map((establishment, index) => {
              const photo = establishment.photoUrl && Math.abs(index - featuredIndex) <= 1
                ? (establishment.photoUrl.startsWith('/') ? `${import.meta.env.BASE_URL}${establishment.photoUrl.replace(/^\/+/, '')}` : establishment.photoUrl)
                : undefined
              const isCurrent = establishment.id === featured.id
              return <div className="featured-slide" key={establishment.id} aria-current={isCurrent ? 'true' : undefined} aria-hidden={!isCurrent}>
                <button className="featured-establishment" tabIndex={isCurrent ? 0 : -1} onClick={(event) => openEstablishment(event, establishment.id)}>
                  {photo ? <img src={photo} alt="" loading={isCurrent ? 'eager' : 'lazy'} /> : <span className="featured-photo-placeholder" aria-hidden="true"><Building2 /></span>}
                  <span className="featured-overlay" />
                  {active.length > 1 && <span className="featured-position">{index + 1} / {active.length}</span>}
                  <span className="featured-copy"><strong>{establishment.name}</strong><span><Star fill="currentColor" /> {establishment.currentRating.toFixed(1)} <small>({establishment.currentReviewCount} {messages.common.reviews})</small></span><em>{pending.filter((item) => item.establishmentId === establishment.id).length} {messages.home.toProcess}</em></span>
                  <span className="featured-arrow"><ArrowRight /></span>
                </button>
              </div>
            })}
          </div>
        </div>
        {active.length > 1 && <>
          <button className="featured-carousel-control previous" type="button" disabled={featuredIndex === 0} onClick={() => selectEstablishment(featuredIndex - 1)} aria-label={messages.home.previous}><ArrowLeft /></button>
          <button className="featured-carousel-control next" type="button" disabled={featuredIndex === active.length - 1} onClick={() => selectEstablishment(featuredIndex + 1)} aria-label={messages.home.next}><ArrowRight /></button>
        </>}
      </div>
    </section>}
    <div className="home-summary"><span>{active.length} {messages.common.establishments}</span><span>{pending.length} {messages.home.toProcess}</span><span>{messages.home.rating} {weightedRating.toFixed(1)}</span></div>
    <div className="section-heading home-section-heading"><h2>{messages.home.quick}</h2><button className="text-button" onClick={() => navigate('/etablissements')}>{messages.common.viewAll} <ChevronRight /></button></div>
    <div className="quick-actions">
      <button className="quick-action card" onClick={() => navigate('/etablissements')}><Building2/><span><strong>{messages.nav.establishments}</strong><small>{messages.home.managePlaces}</small></span><ArrowRight/></button>
      <button className="quick-action card" onClick={() => navigate('/avis')}><MessageSquareText/><span><strong>{messages.home.aiReplies}</strong><small>{pending.length} {messages.home.toProcess}</small></span><ArrowRight/></button>
      <button className="quick-action card" onClick={() => navigate('/analyses')}><BarChart3/><span><strong>{messages.home.analytics}</strong><small>{messages.home.trends}</small></span><ArrowRight/></button>
      <button className="quick-action card" onClick={() => navigate('/etablissements/ajouter')}><Plus/><span><strong>{messages.home.addShort}</strong><small>{messages.home.onePlace}</small></span><ArrowRight/></button>
    </div>
    <div className="section-heading"><h2>{messages.home.recentNegative}</h2><button className="text-button" onClick={() => navigate('/avis')}>{messages.common.viewAll} <ChevronRight /></button></div>
    {latestNegative.length ? latestNegative.map((review) => <ReviewRow compact key={review.id} review={review} />) : <div className="positive-state"><Sparkles/><div><strong>{messages.home.underControl}</strong><span>{messages.home.noNegative}</span></div></div>}
    {demoMode && <button className="demo-button" onClick={injectNegativeReview}><Sparkles size={16}/>Injecter un nouvel avis négatif</button>}
  </>
}
