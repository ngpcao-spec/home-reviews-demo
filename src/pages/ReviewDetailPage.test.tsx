import userEvent from '@testing-library/user-event'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewDetailPage } from './ReviewDetailPage'
import { I18nProvider } from '../i18n'
import type { PreferredLanguage } from '../types/domain'

const appMocks = vi.hoisted(() => ({
  language: 'fr' as PreferredLanguage,
  generateResponse: vi.fn(async () => appMocks.language === 'vi' ? 'Cảm ơn bạn đã chia sẻ phản hồi.' : 'Merci pour votre retour.'),
  saveReplyDraft: vi.fn(async () => 2),
  translateReply: vi.fn(async () => undefined),
  logAction: vi.fn(),
  pushToast: vi.fn(),
}))

vi.mock('../app/AppContext', () => ({
  useApp: () => {
    const switchDraft = appMocks.language === 'vi'
      ? {
          aiStatus: 'completed', aiSummary: 'Tóm tắt tiếng Việt.', aiSuggestedReply: 'Bản nháp tiếng Việt.',
          replyDraftText: 'Bản nháp tiếng Việt.', replyDraftLanguage: 'vi', replyDraftVersion: 1,
          hasLocalizedReply: true, hasLegacyCompletedAnalysis: true,
        }
      : { aiStatus: 'pending', hasLocalizedReply: false, hasLegacyCompletedAnalysis: true }
    return ({
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
    }, {
      id: 'russian-vi', organizationId: 'organization', establishmentId: 'green-home', externalReviewId: 'russian-vi',
      authorName: 'Client', rating: 3, reviewText: 'Dịch vụ rất chậm.', translatedText: 'Dịch vụ rất chậm.',
      originalText: 'Очень медленное обслуживание.', reviewLanguage: 'ru', publishedAt: '2026-09-28T06:00:00.000Z',
      sourceUrl: 'https://maps.google.com', isHistoricalImport: false, requiresAction: true, status: 'to_process', aiStatus: 'completed',
      aiSummary: 'Khách hàng phàn nàn về dịch vụ chậm.', aiSuggestedReply: 'Cảm ơn bạn đã chia sẻ phản hồi.',
      replyDraftText: 'Cảm ơn bạn đã chia sẻ phản hồi.', replyDraftLanguage: 'vi', replyDraftVersion: 1,
      translatedReplyText: 'Спасибо, что поделились своим отзывом.', translatedReplyLanguage: 'ru', translatedFromDraftVersion: 1,
    }, {
      id: 'french-fr', organizationId: 'organization', establishmentId: 'green-home', externalReviewId: 'french-fr',
      authorName: 'Client', rating: 2, reviewText: 'Service très lent.', originalText: 'Service très lent.', reviewLanguage: 'fr',
      publishedAt: '2026-09-28T06:00:00.000Z', sourceUrl: 'https://maps.google.com', isHistoricalImport: false,
      requiresAction: true, status: 'to_process', aiStatus: 'completed', aiSummary: 'Le service était lent.',
      aiSuggestedReply: 'Merci pour votre retour.', replyDraftText: 'Merci pour votre retour.', replyDraftLanguage: 'fr', replyDraftVersion: 1,
    }, {
      id: 'legacy-russian', organizationId: 'organization', establishmentId: 'green-home', externalReviewId: 'legacy-russian',
      authorName: 'Client', rating: 3, reviewText: 'Dịch vụ rất chậm.', translatedText: 'Dịch vụ rất chậm.',
      originalText: 'Очень медленное обслуживание.', reviewLanguage: 'ru', publishedAt: '2026-09-28T06:00:00.000Z',
      sourceUrl: 'https://maps.google.com', isHistoricalImport: false, requiresAction: true, status: 'to_process', aiStatus: 'pending',
      hasLegacyCompletedAnalysis: true, hasLocalizedReply: false,
    }, {
      id: 'vietnamese-vi', organizationId: 'organization', establishmentId: 'green-home', externalReviewId: 'vietnamese-vi',
      authorName: 'Client', rating: 2, reviewText: 'Dịch vụ chậm.', originalText: 'Dịch vụ chậm.', reviewLanguage: 'vi',
      publishedAt: '2026-09-28T06:00:00.000Z', sourceUrl: 'https://maps.google.com', isHistoricalImport: false,
      requiresAction: true, status: 'to_process', aiStatus: 'completed', aiSummary: 'Khách hàng phàn nàn về dịch vụ chậm.',
      aiSuggestedReply: 'Cảm ơn bạn đã phản hồi.', replyDraftText: 'Cảm ơn bạn đã phản hồi.', replyDraftLanguage: 'vi', replyDraftVersion: 1,
      hasLocalizedReply: true, hasLegacyCompletedAnalysis: true,
    }, {
      id: 'switch-language', organizationId: 'organization', establishmentId: 'green-home', externalReviewId: 'switch-language',
      authorName: 'Client', rating: 2, reviewText: 'Service très lent.', originalText: 'Very slow service.', reviewLanguage: 'en',
      publishedAt: '2026-09-28T06:00:00.000Z', sourceUrl: 'https://maps.google.com', isHistoricalImport: false,
      requiresAction: true, status: 'to_process', ...switchDraft,
    }],
    notifications: [],
    preferredLanguage: appMocks.language,
    ...appMocks,
  })},
}))

afterEach(() => {
  cleanup()
  appMocks.generateResponse.mockClear()
})

function renderReview(id: string, language: PreferredLanguage = 'fr') {
  appMocks.language = language
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

  it('marque la traduction client comme obsolète dès que le draft vietnamien change', async () => {
    const user = userEvent.setup()
    renderReview('russian-vi', 'vi')

    expect(screen.getByText('Bản dịch đã sẵn sàng')).toBeVisible()
    await user.type(screen.getByRole('textbox', { name: 'Phản hồi đề xuất' }), ' Nội dung mới.')
    expect(screen.getByText('Cần cập nhật bản dịch')).toBeVisible()
    expect(screen.getAllByRole('button', { name: 'Dịch lại' }).length).toBeGreaterThan(0)
  })

  it('copie directement le draft lorsque la langue originale et la langue de travail sont françaises', () => {
    renderReview('french-fr')
    expect(screen.queryByText('Le service était lent.')).not.toBeInTheDocument()
    expect(screen.queryByText('Résumé IA')).not.toBeInTheDocument()
    expect(appMocks.generateResponse).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Copier la réponse' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Traduire pour le client' })).not.toBeInTheDocument()
  })

  it('n’affiche pas un ancien draft russe comme réponse vietnamienne et génère progressivement la version VI', async () => {
    renderReview('legacy-russian', 'vi')

    expect(screen.queryByDisplayValue('Очень медленное обслуживание.')).not.toBeInTheDocument()
    expect(await screen.findByDisplayValue('Cảm ơn bạn đã chia sẻ phản hồi.')).toBeVisible()
    expect(appMocks.generateResponse).toHaveBeenCalledTimes(1)
    expect(appMocks.generateResponse).toHaveBeenCalledWith('legacy-russian')
  })

  it('utilise un draft VI compatible pour un avis russe et propose la traduction client', () => {
    renderReview('russian-vi', 'vi')
    expect(screen.getByDisplayValue('Cảm ơn bạn đã chia sẻ phản hồi.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Dịch cho khách hàng' })).toBeVisible()
  })

  it('copie directement lorsque l’avis original et le draft sont vietnamiens', () => {
    renderReview('vietnamese-vi', 'vi')
    expect(screen.queryByText('Tóm tắt AI')).not.toBeInTheDocument()
    expect(screen.queryByText('Khách hàng phàn nàn về dịch vụ chậm.')).not.toBeInTheDocument()
    expect(appMocks.generateResponse).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Sao chép phản hồi' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Dịch cho khách hàng' })).not.toBeInTheDocument()
  })

  it('ne présente pas le draft VI comme draft FR après un changement de langue', async () => {
    renderReview('switch-language', 'fr')
    expect(screen.queryByDisplayValue('Bản nháp tiếng Việt.')).not.toBeInTheDocument()
    expect(await screen.findByDisplayValue('Merci pour votre retour.')).toBeVisible()
    expect(appMocks.generateResponse).toHaveBeenCalledTimes(1)
  })
})
