import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { EstablishmentDetailPage } from './EstablishmentDetailPage'

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
    reviews: [],
    notifications: [],
    monitoringIntervalHours: 3,
    refreshEstablishment: vi.fn(),
    toggleMonitoring: vi.fn(),
    removeEstablishment: vi.fn(),
  }),
}))

describe('EstablishmentDetailPage', () => {
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
  })
})
