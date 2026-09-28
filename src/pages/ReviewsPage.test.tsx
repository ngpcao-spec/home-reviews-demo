import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ReviewsPage } from './ReviewsPage'

vi.mock('../app/AppContext', () => ({
  useApp: () => ({
    establishments: [{
      id: 'green-home',
      name: 'Green Home Restaurant',
      photoUrl: 'https://lh3.googleusercontent.com/green-home-photo',
    }],
    reviews: [{
      id: 'negative-review', organizationId: 'organization', establishmentId: 'green-home', externalReviewId: 'negative-review',
      authorName: 'Client négatif', rating: 2, reviewText: 'Avis négatif visible.', reviewLanguage: 'fr',
      publishedAt: '2026-09-28T06:00:00.000Z', sourceUrl: '', isHistoricalImport: true,
      requiresAction: true, status: 'processed',
    }, {
      id: 'positive-review', organizationId: 'organization', establishmentId: 'green-home', externalReviewId: 'positive-review',
      authorName: 'Client positif', rating: 5, reviewText: 'Avis positif masqué.', reviewLanguage: 'fr',
      publishedAt: '2026-09-28T07:00:00.000Z', sourceUrl: '', isHistoricalImport: false,
      requiresAction: false, status: 'to_process',
    }],
    notifications: [],
    currentUser: { initials: 'HR' },
  }),
}))

describe('ReviewsPage', () => {
  it('affiche uniquement les avis 1★ à 3★ dans Voir tout', () => {
    render(
      <MemoryRouter initialEntries={['/avis?etablissement=green-home&statut=all']}>
        <ReviewsPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('Avis négatif visible.')).toBeVisible()
    expect(screen.queryByText('Avis positif masqué.')).not.toBeInTheDocument()
    expect(screen.getByText('Avis à traiter (0)')).toBeVisible()
  })
})
