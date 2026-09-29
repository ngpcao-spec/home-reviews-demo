import { Filter, Inbox } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useApp } from '../app/AppContext'
import { ReviewRow } from '../components/reviews/ReviewRow'
import { BrandHeader } from '../components/ui/BrandHeader'
import { EmptyState } from '../components/ui/Loading'
import type { Review } from '../types/domain'
import { negativeReviews, nextVisibleReviewCount, REVIEWS_PAGE_SIZE, visibleReviewBatch } from '../lib/review-list'
import { useI18n } from '../i18n'

export function ReviewsPage() {
  const { reviews, establishments } = useApp()
  const { messages } = useI18n()
  const tabs = [{ key: 'to_process', label: messages.reviews.toProcess }, { key: 'processed', label: messages.reviews.processed }, { key: 'all', label: messages.reviews.all }] as const
  const [params] = useSearchParams()
  const requestedStatus = params.get('statut')
  const [tab, setTab] = useState<'to_process'|'processed'|'all'>(
    requestedStatus === 'processed' || requestedStatus === 'all' ? requestedStatus : 'to_process',
  )
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [establishment, setEstablishment] = useState(params.get('etablissement') ?? 'all')
  const [rating, setRating] = useState('all')
  const [visibleCount, setVisibleCount] = useState(REVIEWS_PAGE_SIZE)
  const negative = useMemo(() => negativeReviews(reviews), [reviews])
  const displayed = useMemo(() => negative
    .filter((review) => (tab === 'all' || review.status === tab)
      && (establishment === 'all' || review.establishmentId === establishment)
      && (rating === 'all' || review.rating === Number(rating)))
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()),
  [negative, tab, establishment, rating])
  const pendingCount = negative.filter((review) => review.status === 'to_process').length
  const visibleReviews = visibleReviewBatch(displayed, visibleCount)

  return <><BrandHeader />
    <section className="reference-intro reviews-intro"><div><h1>{messages.reviews.title} ({pendingCount})</h1><p>{messages.reviews.intro}</p></div><button className={`bare-icon ${filtersOpen ? 'active-filter' : ''}`} onClick={() => setFiltersOpen(!filtersOpen)} aria-label={messages.reviews.filters}><Filter/></button></section>
    <div className="segmented-control" role="tablist">{tabs.map((item) => <button role="tab" aria-selected={tab===item.key} className={tab===item.key?'active':''} key={item.key} onClick={() => { setTab(item.key); setVisibleCount(REVIEWS_PAGE_SIZE) }}>{item.label}<span>{item.key === 'all' ? negative.length : negative.filter((review)=>review.status===item.key).length}</span></button>)}</div>
    {filtersOpen && <div className="filter-panel card"><label>{messages.reviews.establishment}<select value={establishment} onChange={(event) => { setEstablishment(event.target.value); setVisibleCount(REVIEWS_PAGE_SIZE) }}><option value="all">{messages.reviews.allEstablishments}</option>{establishments.map((item)=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>{messages.reviews.rating}<select value={rating} onChange={(event) => { setRating(event.target.value); setVisibleCount(REVIEWS_PAGE_SIZE) }}><option value="all">{messages.reviews.allRatings}</option>{[1,2,3].map((value)=><option key={value} value={value}>{value} {messages.reviews.star}</option>)}</select></label></div>}
    {displayed.length ? <>
      {visibleReviews.map((review: Review) => <ReviewRow review={review} key={review.id}/>)}
      {visibleCount < displayed.length && <button
        className="secondary-button full-width"
        onClick={() => setVisibleCount((current) => nextVisibleReviewCount(displayed.length, current))}
      >
        {messages.reviews.loadMore}
      </button>}
    </> : <EmptyState icon={<Inbox/>} title={messages.reviews.empty} body={tab === 'to_process' ? messages.reviews.emptyPending : messages.reviews.emptyFilters}/>}
  </>
}
