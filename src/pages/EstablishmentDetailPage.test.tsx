import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EstablishmentDetailPage } from './EstablishmentDetailPage'

const removeEstablishment = vi.fn().mockResolvedValue(undefined)

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
    removeEstablishment,
  }),
}))

describe('EstablishmentDetailPage', () => {
  afterEach(() => cleanup())

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
})
