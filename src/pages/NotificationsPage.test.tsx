import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { NotificationsPage } from './NotificationsPage'
import type { AppNotification } from '../types/domain'

const markRead = vi.fn().mockResolvedValue(undefined)
let notifications: AppNotification[] = []
vi.mock('../app/AppContext', () => ({ useApp: () => ({
  notifications, establishments: [{ id: 'place-1', name: 'Canonical Restaurant' }],
  reviews: [], markNotificationRead: markRead, markAllNotificationsRead: vi.fn(),
}) }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

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
