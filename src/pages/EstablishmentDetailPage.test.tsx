import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EstablishmentDetailPage } from './EstablishmentDetailPage'

const removeEstablishment = vi.fn().mockResolvedValue(undefined)
const menuApi = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke: menuApi.invoke }, rpc: menuApi.rpc } }))

vi.mock('../app/AppContext', () => ({
  useApp: () => ({
    establishments: [{
      id: 'green-home',
      organizationId: 'organization',
      name: 'Green Home Restaurant',
      address: '42/17 Hùng Vương',
      city: 'Nha Trang',
      category: 'Établissement',
      googleMapsUrl: 'https://maps.google.com/green-home',
      photoUrl: 'https://lh3.googleusercontent.com/green-home-photo',
      currentRating: 4.9,
      currentReviewCount: 1641,
      isActive: true,
      syncEnabled: true,
      lastSyncedAt: '2026-09-28T05:00:00.000Z',
      nextSyncAt: '2026-09-28T08:00:00.000Z',
      syncStatus: 'ok',
    }],
    reviews: [{
      id: 'negative-review', organizationId: 'organization', establishmentId: 'green-home', externalReviewId: 'negative-review',
      authorName: 'Client négatif', rating: 2, reviewText: 'Service lent.', reviewLanguage: 'fr',
      publishedAt: '2026-09-28T06:00:00.000Z', sourceUrl: '', isHistoricalImport: true,
      requiresAction: true, status: 'to_process',
    }, {
      id: 'positive-review', organizationId: 'organization', establishmentId: 'green-home', externalReviewId: 'positive-review',
      authorName: 'Client positif', rating: 5, reviewText: 'Excellent restaurant.', reviewLanguage: 'fr',
      publishedAt: '2026-09-28T07:00:00.000Z', sourceUrl: '', isHistoricalImport: false,
      requiresAction: false, status: 'to_process',
    }],
    notifications: [],
    monitoringIntervalHours: 3,
    currentUser: { id: 'test-user' },
    reloadEstablishmentReviews: vi.fn(),
    refreshInitialImports: vi.fn(),
    demoMode: false,
    removeEstablishment,
  }),
}))

describe('EstablishmentDetailPage', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    menuApi.invoke.mockReset()
    menuApi.rpc.mockReset()
  })

  it('affiche la photo enregistrée de l’établissement', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/etablissements/green-home']}>
        <Routes>
          <Route path="/etablissements/:id" element={<EstablishmentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Green Home Restaurant', level: 2 })).toBeVisible()
    expect(container.querySelector('.est-detail-hero img')).toHaveAttribute(
      'src',
      'https://lh3.googleusercontent.com/green-home-photo',
    )
    expect(screen.queryByRole('button', { name: 'Actualiser' })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Avis négatifs récents', level: 2 })).toBeVisible()
    expect(screen.getByText('Service lent.')).toBeVisible()
    expect(screen.queryByText('Excellent restaurant.')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Google Maps' })).toBeVisible()
  })

  it('supprime après confirmation puis revient à la liste', async () => {
    removeEstablishment.mockClear()
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/etablissements/green-home']}>
        <Routes>
          <Route path="/etablissements/:id" element={<EstablishmentDetailPage />} />
          <Route path="/etablissements" element={<div>Liste des établissements</div>} />
        </Routes>
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Supprimer de HOME Reviews' }))
    const dialog = screen.getByRole('dialog', { name: 'Supprimer cet établissement ?' })
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }))

    expect(removeEstablishment).toHaveBeenCalledWith('green-home')
    expect(await screen.findByText('Liste des établissements')).toBeVisible()
  })

  it('affiche la spécialité sur la fiche ouverte dès que le menu est terminé', async () => {
    vi.useFakeTimers()
    menuApi.invoke.mockResolvedValue({ data: { job: { id: 'menu', status: 'running' }, result: null }, error: null })
    menuApi.rpc.mockResolvedValue({ data: { revision: 0, associations: [], unresolved: [] }, error: null })
    await act(async () => {
      render(<MemoryRouter initialEntries={['/etablissements/green-home']}>
        <Routes><Route path="/etablissements/:id" element={<EstablishmentDetailPage />} /></Routes>
      </MemoryRouter>)
    })
    expect(screen.getByText('Extraction en cours…')).toBeVisible()
    expect(screen.queryByText('Spécialité : Bánh căn')).not.toBeInTheDocument()
    const reads = () => menuApi.rpc.mock.calls.filter(([name]) => name === 'read_restaurant_dishes')
    expect(reads()).toHaveLength(1)

    menuApi.invoke.mockResolvedValue({ data: {
      job: { id: 'menu', status: 'completed' },
      result: { provenance: { runId: 'saved-menu' }, counts: { received: 1, excludedDrinks: 0, retained: 1 }, references: [] },
    }, error: null })
    menuApi.rpc.mockResolvedValue({ data: {
      revision: 1, specialty: { name: 'Bánh căn', status: 'proposed' }, associations: [], unresolved: [],
    }, error: null })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(screen.getByText('Menu disponible')).toBeVisible()
    expect(within(screen.getByRole('region', { name: 'Spécialité et plats' })).getByText('Spécialité : Bánh căn')).toBeVisible()
    expect(screen.getByText('Proposée')).toBeVisible()

    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(reads()).toHaveLength(2)
    expect(menuApi.invoke.mock.calls.every(([, request]) => request.body.action === 'status')).toBe(true)
  })
})
