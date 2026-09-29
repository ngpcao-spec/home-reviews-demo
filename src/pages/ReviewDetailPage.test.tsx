import userEvent from '@testing-library/user-event'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewDetailPage } from './ReviewDetailPage'
import { I18nProvider } from '../i18n'
import type { PreferredLanguage } from '../types/domain'

vi.mock('../app/AppContext', () => ({
  useApp: () => ({
    establishments: [{
      id: 'green-home', organizationId: 'organization', name: 'Green Home Restaurant',
      address: '42/17 Hùng Vương', city: 'Nha Trang', category: 'Restaurant',
      googleMapsUrl: 'https://maps.google.com', currentRating: 4.9, currentReviewCount: 1641,
      isActive: true, syncEnabled: true, lastSyncedAt: '2026-09-28T06:00:00.000Z', syncStatus: 'ok',
    }],
    reviews: [{
      id: 'translated', organizationId: 'organization', establishmentId: 'green-home', externalReviewId: 'translated',
      authorName: 'Client', rating: 2, reviewText: 'Service très lent.', translatedText: 'Service très lent.',
      originalText: 'Очень медленное обслуживание.', reviewLanguage: 'ru', publishedAt: '2026-09-28T06:00:00.000Z',
      sourceUrl: 'https://maps.google.com', isHistoricalImport: true, requiresAction: true, status: 'to_process', aiStatus: 'pending',
    }, {
      id: 'translated-vi', organizationId: 'organization', establishmentId: 'green-home', externalReviewId: 'translated-vi',
      authorName: 'Client', rating: 2, reviewText: 'Dịch vụ rất chậm.', translatedText: 'Dịch vụ rất chậm.',
      originalText: 'Очень медленное обслуживание.', reviewLanguage: 'ru', publishedAt: '2026-09-28T06:00:00.000Z',
      sourceUrl: 'https://maps.google.com', isHistoricalImport: true, requiresAction: true, status: 'to_process', aiStatus: 'pending',
    }, {
      id: 'original-only', organizationId: 'organization', establishmentId: 'green-home', externalReviewId: 'original-only',
      authorName: 'Client', rating: 3, reviewText: 'Original text only.', originalText: 'Original text only.',
      reviewLanguage: 'en', publishedAt: '2026-09-28T06:00:00.000Z', sourceUrl: 'https://maps.google.com',
      isHistoricalImport: true, requiresAction: true, status: 'to_process', aiStatus: 'pending',
    }],
    notifications: [],
    generateResponse: vi.fn(), logAction: vi.fn(), pushToast: vi.fn(),
  }),
}))

afterEach(cleanup)

function renderReview(id: string, language: PreferredLanguage = 'fr') {
  return render(<I18nProvider language={language}><MemoryRouter initialEntries={[`/avis/${id}`]}><Routes><Route path="/avis/:id" element={<ReviewDetailPage />} /></Routes></MemoryRouter></I18nProvider>)
}

describe('ReviewDetailPage translation toggle', () => {
  it('affiche la traduction par défaut puis bascule localement vers l’original', async () => {
    const user = userEvent.setup()
    renderReview('translated')

    expect(screen.getByRole('heading', { name: "Détail de l’avis" })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Avis', level: 2 })).toBeVisible()
    expect(screen.getByText('Service très lent.')).toBeVisible()
    expect(screen.queryByText('Очень медленное обслуживание.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: "Voir l’avis original" }))
    expect(screen.getByText('Очень медленное обслуживание.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Voir la traduction' })).toBeVisible()
  })

  it('n’affiche aucune bascule lorsqu’aucune traduction distincte n’existe', () => {
    renderReview('original-only')
    expect(screen.getByText('Original text only.')).toBeVisible()
    expect(screen.queryByRole('button', { name: /Voir (l’avis original|la traduction)/ })).not.toBeInTheDocument()
  })

  it('bascule en vietnamien sans traduire le nom de l’établissement', async () => {
    const user = userEvent.setup()
    renderReview('translated-vi', 'vi')

    expect(screen.getByText('Green Home Restaurant')).toBeVisible()
    expect(screen.queryByText('Nhà hàng Green Home')).not.toBeInTheDocument()
    expect(screen.getByText('Dịch vụ rất chậm.')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Xem bản gốc' }))
    expect(screen.getByText('Очень медленное обслуживание.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Xem bản dịch' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Xem bản dịch' }))
    expect(screen.getByText('Dịch vụ rất chậm.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Xem bản gốc' })).toBeVisible()
  })
})
