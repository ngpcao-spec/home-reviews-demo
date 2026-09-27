import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationOnboardingResetPage } from './NotificationOnboardingResetPage'

const savePreference = vi.hoisted(() => vi.fn())

vi.mock('../lib/notification-preferences', () => ({
  saveNotificationPreference: savePreference,
}))

afterEach(() => cleanup())

function renderResetPage() {
  return render(<MemoryRouter initialEntries={['/test/notifications/reset']}><Routes>
    <Route path="/test/notifications/reset" element={<NotificationOnboardingResetPage />} />
    <Route path="/" element={<div>Accueil test</div>} />
  </Routes></MemoryRouter>)
}

describe('route interne de réinitialisation notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    savePreference.mockResolvedValue(undefined)
  })

  it('réinitialise uniquement les deux préférences puis revient à l’accueil', async () => {
    renderResetPage()
    await waitFor(() => expect(savePreference).toHaveBeenCalledWith('unknown', false))
    expect(await screen.findByText('Accueil test')).toBeInTheDocument()
  })

  it('affiche une erreur sans modifier autre chose si la session est absente', async () => {
    savePreference.mockRejectedValue(new Error('UNAUTHORIZED'))
    renderResetPage()
    expect(await screen.findByText('Réinitialisation impossible')).toBeInTheDocument()
  })
})
