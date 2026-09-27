import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationOnboarding } from './NotificationOnboarding'

const mocks = vi.hoisted(() => ({
  loadPreference: vi.fn(),
  savePreference: vi.fn(),
  currentSubscription: vi.fn(),
  enablePush: vi.fn(),
  isIos: vi.fn(),
  isStandalone: vi.fn(),
  isSupported: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../app/AppContext', () => ({
  useApp: () => ({
    dataReady: true,
    demoMode: false,
    isAuthenticated: true,
    pushToast: mocks.toast,
  }),
}))

vi.mock('../lib/notification-preferences', async () => {
  const actual = await vi.importActual<typeof import('../lib/notification-preferences')>('../lib/notification-preferences')
  return {
    ...actual,
    loadNotificationPreference: mocks.loadPreference,
    saveNotificationPreference: mocks.savePreference,
  }
})

vi.mock('../lib/push-notifications', () => ({
  currentPushSubscription: mocks.currentSubscription,
  enablePushNotifications: mocks.enablePush,
  isIosDevice: mocks.isIos,
  isStandalonePwa: mocks.isStandalone,
  pushIsSupported: mocks.isSupported,
}))

afterEach(() => cleanup())

describe('onboarding notifications', () => {
  const requestPermission = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadPreference.mockResolvedValue({ seen: false, status: 'unknown' })
    mocks.savePreference.mockResolvedValue(undefined)
    mocks.currentSubscription.mockResolvedValue(null)
    mocks.enablePush.mockResolvedValue({})
    mocks.isIos.mockReturnValue(false)
    mocks.isStandalone.mockReturnValue(false)
    mocks.isSupported.mockReturnValue(true)
    requestPermission.mockResolvedValue('granted')
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })
  })

  it('s’affiche à la première connexion', async () => {
    render(<NotificationOnboarding />)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Restez informé des nouveaux avis')).toBeInTheDocument()
  })

  it('Plus tard enregistre le choix et ferme le modal', async () => {
    render(<NotificationOnboarding />)
    await userEvent.click(await screen.findByRole('button', { name: 'Plus tard' }))
    expect(mocks.savePreference).toHaveBeenCalledWith('unknown')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('demande la permission seulement après Activer et crée la subscription', async () => {
    render(<NotificationOnboarding />)
    await screen.findByRole('dialog')
    expect(requestPermission).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /Activer les notifications/ }))
    expect(requestPermission).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(mocks.enablePush).toHaveBeenCalledTimes(1))
    expect(mocks.savePreference).toHaveBeenCalledWith('granted')
  })

  it('conserve un refus sans créer de subscription', async () => {
    requestPermission.mockResolvedValue('denied')
    render(<NotificationOnboarding />)
    await userEvent.click(await screen.findByRole('button', { name: /Activer les notifications/ }))
    await waitFor(() => expect(mocks.savePreference).toHaveBeenCalledWith('denied'))
    expect(mocks.enablePush).not.toHaveBeenCalled()
  })

  it('ne revient pas après le choix Plus tard enregistré', async () => {
    mocks.loadPreference.mockResolvedValue({ seen: true, status: 'unknown' })
    render(<NotificationOnboarding />)
    await waitFor(() => expect(mocks.loadPreference).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('reste absent pour un utilisateur déjà activé', async () => {
    mocks.currentSubscription.mockResolvedValue({ endpoint: 'https://push.example/subscription' })
    render(<NotificationOnboarding />)
    await waitFor(() => expect(mocks.savePreference).toHaveBeenCalledWith('granted'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('explique l’installation PWA sur iPhone sans demander la permission', async () => {
    mocks.isIos.mockReturnValue(true)
    mocks.isStandalone.mockReturnValue(false)
    render(<NotificationOnboarding />)
    await userEvent.click(await screen.findByRole('button', { name: /Activer les notifications/ }))
    expect(await screen.findByText(/ajoutez HOME Reviews à votre écran d'accueil/)).toBeInTheDocument()
    expect(requestPermission).not.toHaveBeenCalled()
    expect(mocks.enablePush).not.toHaveBeenCalled()
  })
})
