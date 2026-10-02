import { Filter, Inbox } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../app/AppContext'
import { ReviewRow } from '../components/reviews/ReviewRow'
import { BrandHeader } from '../components/ui/BrandHeader'
import { EmptyState } from '../components/ui/Loading'
import type { Review } from '../types/domain'
import { attentionReviews, nextVisibleReviewCount, REVIEWS_PAGE_SIZE, visibleReviewBatch } from '../lib/review-list'
import { useI18n } from '../i18n'
import { readUiState, saveUiState } from '../lib/navigation-state'

export function ReviewsPage() {
  const { reviews, establishments, currentUser } = useApp()
  const { messages } = useI18n()
  const tabs = [{ key: 'to_process', label: messages.reviews.toProcess }, { key: 'processed', label: messages.reviews.processed }, { key: 'all', label: messages.reviews.all }] as const
  const [params, setParams] = useSearchParams()
  const userId = currentUser?.id
  useEffect(()=>{
    if(!userId) return
    if(params.size===0) {
      const saved=readUiState<string>(userId,'review-filters')
      if(typeof saved==='string' && saved) {setParams(new URLSearchParams(saved),{replace:true});return}
    }
    const saved=new URLSearchParams()
    for(const key of ['statut','etablissement','note']) {const value=params.get(key);if(value)saved.set(key,value)}
    saveUiState(userId,'review-filters',saved.toString())
  },[userId,params,setParams])
  const requestedStatus = params.get('statut')
  const tab = requestedStatus === 'processed' || requestedStatus === 'all' ? requestedStatus : 'to_process'
  const setFilter = (key: string, value: string) => { const next=new URLSearchParams(params);next.set(key,value);setParams(next,{replace:true}) }
  const setTab = (value: string) => setFilter('statut',value)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const candidate = params.get('etablissement') ?? 'all'
  const establishment = establishments.some(e=>e.id===candidate) ? candidate : 'all'
  const setEstablishment = (value: string) => setFilter('etablissement',value)
  const rating = ['1','2','3','4'].includes(params.get('note') ?? '') ? params.get('note')! : 'all'
  const setRating = (value: string) => setFilter('note',value)
  const [visibleCount, setVisibleCount] = useState(REVIEWS_PAGE_SIZE)
  const attention = useMemo(() => attentionReviews(reviews), [reviews])
  const displayed = useMemo(() => attention
    .filter((review) => (tab === 'all' || review.status === tab)
      && (establishment === 'all' || review.establishmentId === establishment)
      && (rating === 'all' || review.rating === Number(rating)))
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()),
  [attention, tab, establishment, rating])
  const pendingCount = attention.filter((review) => review.status === 'to_process').length
  const visibleReviews = visibleReviewBatch(displayed, visibleCount)

  return <><BrandHeader />
    <section className="reference-intro reviews-intro"><div><h1>{messages.reviews.title} ({pendingCount})</h1><p>{messages.reviews.intro}</p></div><button className={`bare-icon ${filtersOpen ? 'active-filter' : ''}`} onClick={() => setFiltersOpen(!filtersOpen)} aria-label={messages.reviews.filters}><Filter/></button></section>
    <div className="segmented-control" role="tablist">{tabs.map((item) => <button role="tab" aria-selected={tab===item.key} className={tab===item.key?'active':''} key={item.key} onClick={() => { setTab(item.key); setVisibleCount(REVIEWS_PAGE_SIZE) }}>{item.label}<span>{item.key === 'all' ? attention.length : attention.filter((review)=>review.status===item.key).length}</span></button>)}</div>
    {filtersOpen && <div className="filter-panel card"><label>{messages.reviews.establishment}<select value={establishment} onChange={(event) => { setEstablishment(event.target.value); setVisibleCount(REVIEWS_PAGE_SIZE) }}><option value="all">{messages.reviews.allEstablishments}</option>{establishments.map((item)=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>{messages.reviews.rating}<select value={rating} onChange={(event) => { setRating(event.target.value); setVisibleCount(REVIEWS_PAGE_SIZE) }}><option value="all">{messages.reviews.allRatings}</option>{[1,2,3,4].map((value)=><option key={value} value={value}>{value} {messages.reviews.star}</option>)}</select></label></div>}
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
