import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { NotificationsPage } from './NotificationsPage'
import type { AppNotification, Review } from '../types/domain'
import { localizedReviewText } from '../lib/review-translation'
import { ReviewRow } from '../components/reviews/ReviewRow'

const markRead = vi.fn().mockResolvedValue(undefined)
let notifications: AppNotification[] = []
let reviews: Review[] = []
vi.mock('../app/AppContext', () => ({ useApp: () => ({
  notifications, establishments: [{ id: 'place-1', name: 'Canonical Restaurant' }],
  reviews, markNotificationRead: markRead, markAllNotificationsRead: vi.fn(),
}) }))
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); reviews=[]; document.documentElement.lang='fr' })

function openPage() {
  render(<MemoryRouter initialEntries={['/notifications']}><Routes>
    <Route path="/notifications" element={<NotificationsPage />} />
    <Route path="/etablissements/:id" element={<p>Fiche établissement</p>} />
    <Route path="/avis/:id" element={<p>Détail avis</p>} />
  </Routes></MemoryRouter>)
}
const imported: AppNotification = {
  id: 'notice-1', establishmentId: 'place-1', type: 'initial_import_completed',
  title: 'Nhập dữ liệu hoàn tất', body: 'Canonical Restaurant — Đã nhập 100 đánh giá',
  severity: 'info', createdAt: new Date().toISOString(),
}
describe('notifications navigation', () => {
  it('shows import completion and opens the establishment rather than an absent review', async () => {
    notifications = [imported]
    openPage()
    fireEvent.click(screen.getByText(imported.title))
    expect(await screen.findByText('Fiche établissement')).toBeInTheDocument()
    expect(markRead).toHaveBeenCalledWith('notice-1')
  })
  it('preserves the review deep-link', async () => {
    notifications = [{ ...imported, type: 'new_negative_review', reviewId: 'review-1' }]
    openPage()
    fireEvent.click(screen.getByText('Canonical Restaurant'))
    expect(await screen.findByText('Détail avis')).toBeInTheDocument()
  })
})

describe('review notification reading consistency',()=>{
  const original='服务很慢'
  const translations=[{language:'vi' as const,translated_text:'Phục vụ rất chậm'},{language:'fr' as const,translated_text:'Service très lent'}]
  function setup(language:'fr'|'vi'='vi',translated=true) {
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-04T10:00:00Z'))
    document.documentElement.lang=language
    const localized=localizedReviewText(original,translated?translations:[],language)
    reviews=[{id:'49e820e0-99ec-4ce7-946b-b646a7cc8f51',establishmentId:'place-1',rating:2,
      reviewText:localized.displayText,originalText:original,publishedAt:'2026-10-04T03:00:00Z'} as Review]
    notifications=[{...imported,type:'new_negative_review',reviewId:reviews[0].id,body:original,createdAt:'2026-10-04T08:00:00Z'}]
    return localized.displayText
  }
  it.each(['fr','vi'] as const)('uses the same localized text and publication age as ReviewRow in %s',language=>{
    const text=setup(language),before=structuredClone(notifications)
    openPage()
    render(<MemoryRouter><ReviewRow review={reviews[0]}/></MemoryRouter>)
    expect(screen.getAllByText(text)).toHaveLength(2)
    expect(document.querySelector('.notification-meta')).toHaveTextContent(language==='vi'?'2★ · 7 giờ trước':'2★ · il y a 7 h')
    expect(document.querySelector('.review-meta')).toHaveTextContent(language==='vi'?'7 giờ trước':'il y a 7 h')
    expect(notifications).toEqual(before)
  })
  it('falls back to creation time when publication date is absent',()=>{
    setup();reviews[0].publishedAt='';openPage()
    expect(document.querySelector('.notification-meta')).toHaveTextContent('2 giờ trước')
  })
  it('does not mistake the mapper import-date fallback for a Google publication date',()=>{
    setup();reviews[0].hasGooglePublicationDate=false;openPage()
    expect(document.querySelector('.notification-meta')).toHaveTextContent('2 giờ trước')
  })
  it('uses the original when no translation is available',()=>{
    setup('fr',false);openPage();expect(screen.getByText(original)).toBeInTheDocument()
  })
  it('falls back from empty display text to original, then to notification body',()=>{
    setup();reviews[0].reviewText='  ';notifications[0].body='Notification fallback';openPage()
    expect(screen.getByText(original)).toBeInTheDocument()
    cleanup();reviews[0].originalText='';openPage()
    expect(screen.getByText('Notification fallback')).toBeInTheDocument()
  })
  it.each([undefined,'missing-review'])('keeps body and creation age without an available review (%s)',reviewId=>{
    setup();notifications[0].reviewId=reviewId;openPage()
    expect(screen.getByText(original)).toBeInTheDocument()
    expect(screen.getByText('2 giờ trước')).toBeInTheDocument()
    expect(document.querySelector('.notification-meta')).toBeNull()
  })
  it('keeps unread/read then notification creation sorting regardless of publication date',()=>{
    setup()
    reviews.push({...reviews[0],id:'newer-review',reviewText:'Newer review',publishedAt:'2026-10-04T09:00:00Z'})
    notifications=[{...notifications[0],id:'older-notification',reviewId:'newer-review',createdAt:'2026-10-04T07:00:00Z'},
      {...notifications[0],id:'read',readAt:'2026-10-04T09:30:00Z',createdAt:'2026-10-04T09:00:00Z',body:'Read notification',reviewId:undefined},notifications[0]]
    openPage()
    expect([...document.querySelectorAll('.notification-item p')].map(e=>e.textContent)).toEqual(['Phục vụ rất chậm','Newer review','Read notification'])
  })
})
