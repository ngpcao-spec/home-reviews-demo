import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '../i18n'
import { AnalyticsPage } from './AnalyticsPage'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock('../app/AppContext', () => ({
  useApp: () => ({
    reviews: [],
    establishments: [{
      id: 'est-1', organizationId: 'org-1', name: 'Green Home Dining', address: 'Nha Trang',
      city: 'Nha Trang', category: 'Restaurant', googleMapsUrl: 'https://maps.google.test',
      currentRating: 4.9, currentReviewCount: 345, isActive: true, syncEnabled: true,
      lastSyncedAt: '2026-09-30T00:00:00Z', syncStatus: 'ok',
    }],
    demoMode: false,
    preferredLanguage: 'vi',
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

function renderPage() {
  return render(<MemoryRouter><I18nProvider language="vi"><AnalyticsPage /></I18nProvider></MemoryRouter>)
}

async function selectHistoricalMode() {
  fireEvent.change(screen.getByLabelText('Khoảng thời gian'), { target: { value: 'historical' } })
  await waitFor(() => expect(mocks.maybeSingle).toHaveBeenCalledTimes(1))
}

describe('manual historical report generation', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
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
})
