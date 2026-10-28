import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ReviewCollectionAlert } from './ReviewCollectionAlert'
import { I18nProvider } from '../i18n'
import type { Establishment, PreferredLanguage } from '../types/domain'

const retry = vi.fn(), refresh = vi.fn()
vi.mock('../app/AppContext', () => ({ useApp: () => ({ retryEstablishmentImport: retry, refreshInitialImports: refresh }) }))
const place: Establishment = {
  id: 'existing-place', organizationId: 'org', name: 'Restaurant', address: '', city: '', category: '', googleMapsUrl: '',
  currentRating: 4.8, currentReviewCount: 1717, isActive: true, syncEnabled: true, lastSyncedAt: '', syncStatus: 'error',
  initialImportJobId: 'saved-job', reviewCollection: { status: 'partial', expected: 150, unique: 5 },
}
const ui = (language: PreferredLanguage, establishment = place) => <I18nProvider language={language}><ReviewCollectionAlert establishment={establishment} /></I18nProvider>
beforeEach(() => { retry.mockReset().mockResolvedValue(undefined); refresh.mockReset().mockResolvedValue(undefined) })
afterEach(() => { cleanup(); vi.useRealTimers() })

it.each([
  ['fr', 'Notre système a rencontré un problème pour récupérer les avis. Veuillez réessayer. Si le problème persiste, veuillez réessayer ultérieurement.', 'Réessayer'],
  ['vi', 'Hệ thống gặp sự cố khi thu thập đánh giá. Vui lòng thử lại. Nếu sự cố vẫn tiếp diễn, vui lòng thử lại sau.', 'Thử lại'],
] as const)('shows the saved partial alert in %s on an already imported restaurant and only retries on a click', async (language, message, button) => {
  render(ui(language))
  expect(screen.getByRole('alert')).toHaveTextContent(message)
  expect(retry).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: button }))
  expect(retry).toHaveBeenCalledExactlyOnceWith('saved-job')
})

it('does not warn for a real five-review restaurant with all five collected', () => {
  render(ui('fr', { ...place, currentReviewCount: 5, reviewCollection: { status: 'complete', expected: 5, unique: 5 } }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(retry).not.toHaveBeenCalled()
})

it('coalesces double clicks, keeps the same restaurant and waits for the server state', async () => {
  let finish: () => void = () => {}
  retry.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
  const mounted = render(ui('fr'))
  await userEvent.dblClick(screen.getByRole('button', { name: 'Réessayer' }))
  expect(retry).toHaveBeenCalledExactlyOnceWith('saved-job')
  await act(async () => finish())
  mounted.rerender(ui('fr', { ...place, reviewCollection: { ...place.reviewCollection!, status: 'retrying' } }))
  expect(screen.getByRole('status')).toHaveTextContent('Import en cours')
  expect(screen.getByRole('button')).toBeDisabled()
  mounted.rerender(ui('fr', { ...place, reviewCollection: { status: 'complete', expected: 150, unique: 150 } }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('polls an existing manual attempt without ever requesting another collection', async () => {
  vi.useFakeTimers()
  const mounted = render(ui('vi', { ...place, reviewCollection: { ...place.reviewCollection!, status: 'retrying' } }))
  await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
  expect(refresh).toHaveBeenCalledTimes(2)
  expect(retry).not.toHaveBeenCalled()
  mounted.unmount()
  await vi.advanceTimersByTimeAsync(3000)
  expect(refresh).toHaveBeenCalledTimes(2)
})

it('keeps the validated localized message on an unknown/rejected retry and changes language without showing native details', async () => {
  retry.mockRejectedValue(new Error('APIFY_START_OUTCOME_UNKNOWN: technical receipt'))
  const mounted = render(ui('fr'))
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
  mounted.rerender(ui('vi'))
  expect(screen.getByRole('alert')).toHaveTextContent('Hệ thống gặp sự cố khi thu thập đánh giá.')
  expect(document.body).not.toHaveTextContent(/apify|technical receipt|Notre système/i)
  expect(retry).toHaveBeenCalledTimes(1)
})
