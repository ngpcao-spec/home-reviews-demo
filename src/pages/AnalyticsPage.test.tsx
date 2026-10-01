import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '../i18n'
import { AnalyticsPage } from './AnalyticsPage'
import { resetAnalyticsCache } from '../lib/analytics-cache'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  maybeSingle: vi.fn(),
  language: 'vi' as 'vi'|'fr',
}))

vi.mock('../app/AppContext', () => ({
  useApp: () => ({
    reviews: [],
    establishments: [{
      id: 'est-1', organizationId: 'org-1', name: 'Green Home Dining', address: 'Nha Trang',
      city: 'Nha Trang', category: 'Restaurant', googleMapsUrl: 'https://maps.google.test',
      currentRating: 4.9, currentReviewCount: 345, isActive: true, syncEnabled: true,
      lastSyncedAt: '2026-09-30T00:00:00Z', syncStatus: 'ok',
    }, {
      id:'est-2',organizationId:'org-1',name:'Artisan Cafe & Eatery',currentRating:4.8,currentReviewCount:1615,
    }],
    demoMode: false,
    preferredLanguage: mocks.language,
    notifications: [],
    currentUser: { name: 'Test', email: 'test@example.com', initials: 'T' },
  }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: { invoke: mocks.invoke },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: mocks.maybeSingle }),
        }),
      }),
    }),
  },
}))

function LocationLabel(){const location=useLocation();return <output data-testid="location">{location.pathname}{location.search}</output>}
function renderPage(path='/analyses') {
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[path]}><I18nProvider language={mocks.language}>
    <Link to="/etablissements">test-leave</Link><Link to="/analyses">test-return</Link><LocationLabel/>
    <Routes><Route path="/analyses" element={<AnalyticsPage/>}/><Route path="/etablissements" element={<div>establishments screen</div>}/></Routes>
  </I18nProvider></MemoryRouter></QueryClientProvider>)
}

const reportRow=(id='est-2',language='vi')=>({
  id:`report-${id}-${language}`,organization_id:'org-1',establishment_id:id,preferred_language:language,
  period_start:'2026-09-01T00:00:00Z',period_end:'2026-10-01T00:00:00Z',google_rating:4.8,google_total_reviews:1615,
  stored_reviews_count:500,negative_reviews_count:40,negative_rate:8,ready_replies_count:0,
  rating_1_count:11,rating_2_count:13,rating_3_count:16,rating_4_count:18,rating_5_count:442,
  data_complete:false,ai_historical_summary:'summary',ai_status:'completed',ai_error:null,generated_at:'2026-10-01T01:00:00Z',
  analysis_version:2,sample_reviews_count:500,sample_average_rating:4.734,positive_rate:92,attention_reviews_count:40,
  processed_reviews_count:0,remaining_replies_count:40,food_average:4.73,food_review_count:453,service_average:4.85,service_review_count:452,
  atmosphere_average:4.9,atmosphere_review_count:451,positive_themes:[],negative_themes:[],representative_positive_review_ids:[],representative_attention_review_ids:[],
  ai_overall_summary:`summary-${id}-${language}`,source_undated_count:0,
})

async function selectHistoricalMode() {
  fireEvent.change(screen.getByLabelText('Khoảng thời gian'), { target: { value: 'historical' } })
  await waitFor(() => expect(mocks.maybeSingle).toHaveBeenCalledTimes(1))
}

describe('manual historical report generation', () => {
  afterEach(() => {cleanup();vi.restoreAllMocks()})

  beforeEach(() => {
    resetAnalyticsCache()
    mocks.language='vi'
    vi.spyOn(window,'scrollTo').mockImplementation(()=>{})
    mocks.invoke.mockReset().mockResolvedValue({ data: { error: 'WEEKLY_TEST_RESPONSE' }, error: null })
    mocks.maybeSingle.mockReset().mockResolvedValue({ data: null, error: null })
  })

  it('does not generate an AI report when the historical view opens', async () => {
    renderPage()
    await selectHistoricalMode()
    expect(screen.getByRole('button', { name: 'Tạo báo cáo AI' })).toBeVisible()
    expect(mocks.invoke.mock.calls.filter(([name]) => name === 'generate-historical-report')).toHaveLength(0)
  })

  it('prevents two simultaneous requests after a double click', async () => {
    let resolveRequest: (value: unknown) => void = () => undefined
    const pendingRequest = new Promise((resolve) => { resolveRequest = resolve })
    mocks.invoke.mockImplementation((name: string) => name === 'generate-historical-report'
      ? pendingRequest
      : Promise.resolve({ data: { error: 'WEEKLY_TEST_RESPONSE' }, error: null }))
    renderPage()
    await selectHistoricalMode()
    const button = screen.getByRole('button', { name: 'Tạo báo cáo AI' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(mocks.invoke.mock.calls.filter(([name]) => name === 'generate-historical-report')).toHaveLength(1)
    resolveRequest({ data: { error: 'NO_REVIEWS_AVAILABLE' }, error: null })
    expect(await screen.findByText('Chưa có đủ dữ liệu để tạo báo cáo.')).toBeVisible()
  })

  it('continues the same server generation without starting another report', async () => {
    let steps = 0
    mocks.invoke.mockImplementation((name: string) => Promise.resolve(name !== 'generate-historical-report'
      ? { data: { error: 'WEEKLY_TEST_RESPONSE' }, error: null }
      : ++steps === 1
        ? { data: { pending: true, generation_id: 'generation-1', progress: 1, total_steps: 3 }, error: null }
        : { data: { error: 'NO_REVIEWS_AVAILABLE' }, error: null }))
    renderPage()
    await selectHistoricalMode()
    fireEvent.click(screen.getByRole('button', { name: 'Tạo báo cáo AI' }))
    expect(await screen.findByText('Phân tích theo nhóm: 1 / 3')).toBeVisible()
    expect(await screen.findByText('Chưa có đủ dữ liệu để tạo báo cáo.', {}, {timeout:3000})).toBeVisible()
    const calls=mocks.invoke.mock.calls.filter(([name])=>name==='generate-historical-report')
    expect(calls).toHaveLength(2)
    expect(calls[0][1].body).toEqual({establishment_id:'est-1',force:true})
    expect(calls[1][1].body).toEqual({establishment_id:'est-1',generation_id:'generation-1'})
  })

  it('restores Artisan/historical and the cached V2 immediately after visiting another tab',async()=>{
    mocks.maybeSingle.mockResolvedValue({data:reportRow(),error:null})
    renderPage('/analyses?establishment=est-2&mode=historical')
    expect(await screen.findByText('summary-est-2-vi')).toBeVisible()
    expect(screen.getByRole('button',{name:'Tạo lại phân tích'})).toBeVisible()
    fireEvent.click(screen.getByText('test-leave'))
    fireEvent.click(screen.getByText('test-return'))
    expect(screen.getByText('summary-est-2-vi')).toBeVisible()
    expect(screen.queryByTestId('analytics-initial-loading')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Khoảng thời gian')).toHaveValue('historical')
    expect(screen.getByTestId('location')).toHaveTextContent('establishment=est-2&mode=historical')
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('switches the URL without showing the previous establishment report',async()=>{
    mocks.maybeSingle.mockResolvedValueOnce({data:reportRow(),error:null}).mockImplementation(()=>new Promise(()=>{}))
    renderPage('/analyses?establishment=est-2&mode=historical')
    await screen.findByText('summary-est-2-vi')
    fireEvent.change(screen.getByLabelText('Cơ sở'),{target:{value:'est-1'}})
    expect(screen.queryByText('summary-est-2-vi')).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('establishment=est-1&mode=historical')
  })

  it('restores scroll on tab return but not when the establishment changes',async()=>{
    mocks.maybeSingle.mockResolvedValue({data:reportRow(),error:null})
    let scrollY=0
    vi.spyOn(window,'scrollY','get').mockImplementation(()=>scrollY)
    renderPage('/analyses?establishment=est-2&mode=historical')
    await screen.findByText('summary-est-2-vi')
    await waitFor(()=>expect(window.scrollTo).toHaveBeenCalledWith({top:0,behavior:'instant'}))
    scrollY=777;fireEvent.scroll(window)
    fireEvent.click(screen.getByText('test-leave'));scrollY=0
    fireEvent.click(screen.getByText('test-return'))
    await waitFor(()=>expect(window.scrollTo).toHaveBeenCalledWith({top:777,behavior:'instant'}))
    fireEvent.change(screen.getByLabelText('Cơ sở'),{target:{value:'est-1'}})
    await waitFor(()=>expect(window.scrollTo).toHaveBeenLastCalledWith({top:0,behavior:'instant'}))
  })

  it('never displays a cached VI report in the FR view',async()=>{
    mocks.maybeSingle.mockResolvedValueOnce({data:reportRow(),error:null})
    const first=renderPage('/analyses?establishment=est-2&mode=historical')
    await screen.findByText('summary-est-2-vi')
    first.unmount();mocks.language='fr'
    mocks.maybeSingle.mockImplementation(()=>new Promise(()=>{}))
    renderPage('/analyses?establishment=est-2&mode=historical')
    expect(screen.queryByText('summary-est-2-vi')).not.toBeInTheDocument()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})
