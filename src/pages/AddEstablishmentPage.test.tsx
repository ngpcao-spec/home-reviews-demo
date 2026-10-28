import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AddEstablishmentPage } from './AddEstablishmentPage'
import { I18nProvider } from '../i18n'
import type { InitialImportJob } from '../app/AppContext'

const candidate = {
  placeRef: 'google-id',
  name: 'Restaurant Test',
  address: '1 rue du Test',
  rating: 4.6,
  reviewCount: 4430,
  googleMapsUrl: 'https://maps.google.com/test',
  photoUrl: 'https://images.example/test.jpg',
  confidence: 1,
}

const successResult = {
  status: 'completed' as const,
  establishmentId: 'establishment-123',
  inserted: 18,
  negativeReviewCount: 18,
  distribution: { '1': 5, '2': 6, '3': 7 },
  importStatus: 'completed' as const,
  nextSyncAt: new Date(Date.now() + 12 * 3_600_000).toISOString(),
}

const resolveEstablishment = vi.fn()
const addEstablishment = vi.fn()
const retryEstablishmentImport = vi.fn()
let establishmentCount = 0
let initialImportJobs: InitialImportJob[] = []

vi.mock('../app/AppContext', () => ({
  useApp: () => ({
    resolveEstablishment,
    addEstablishment,
    retryEstablishmentImport,
    acknowledgeInitialImport: vi.fn(),
    refreshInitialImports: vi.fn().mockResolvedValue(undefined),
    initialImportJobs,
    establishments: Array.from({ length: establishmentCount }, (_, index) => ({ id: `establishment-${index + 1}` })),
    notifications: [],
    plan: { maxEstablishments: 5 },
    monitoringIntervalHours: 12,
  }),
}))

function Destination({ label }: { label: string }) {
  const location = useLocation()
  return <div>{label}:{location.search}</div>
}

function renderWizard(state?: unknown, language: 'fr' | 'vi' = 'fr') {
  return render(
    <I18nProvider language={language}>
      <MemoryRouter initialEntries={[{ pathname: '/etablissements/ajouter', state }]}>
        <Routes>
          <Route path="/etablissements/ajouter" element={<AddEstablishmentPage />} />
          <Route path="/avis" element={<Destination label="avis" />} />
          <Route path="/etablissements" element={<Destination label="établissements" />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  )
}

async function completeSuccessfulAdd() {
  const user = userEvent.setup()
  renderWizard()
  await user.type(screen.getByPlaceholderText('Lien Google Maps'), 'https://maps.app.goo.gl/test')
  await user.click(screen.getByRole('button', { name: 'Rechercher l’établissement' }))
  await screen.findByText('Confirmer l’établissement')
  await user.click(screen.getByRole('button', { name: 'Ajouter cet établissement' }))
  await screen.findByText('✓ Établissement ajouté')
  return user
}

describe('confirmation d’ajout d’un établissement', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    establishmentCount = 0
    initialImportJobs = []
    resolveEstablishment.mockReset().mockResolvedValue(candidate)
    addEstablishment.mockReset().mockResolvedValue(successResult)
    retryEstablishmentImport.mockReset().mockResolvedValue({
      negativeReviewCount: 18,
      nextSyncAt: successResult.nextSyncAt,
    })
  })

  it.each([4, 5, 6, 10])('permet l’ajout avec %i établissements existants', async (count) => {
    establishmentCount = count
    await completeSuccessfulAdd()

    expect(addEstablishment).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/quota d’établissements/i)).not.toBeInTheDocument()
  })

  it('conserve l’écran de succès et affiche toutes les informations attendues', async () => {
    await completeSuccessfulAdd()
    expect(screen.getByText('Restaurant Test')).toBeVisible()
    expect(screen.queryByText(/4430/)).not.toBeInTheDocument()
    expect(screen.getByText(/18 avis du corpus/)).toBeVisible()
    expect(screen.getByText(/18 avis négatifs importés/)).toBeVisible()
    expect(screen.getByText(/Surveillance toutes les 12 heures/)).toBeVisible()
    expect(screen.getByText(/Prochain contrôle dans environ 12 h/)).toBeVisible()
    expect(screen.queryByPlaceholderText('Lien Google Maps')).not.toBeInTheDocument()
  })

  it('ouvre tous les avis du bon établissement', async () => {
    const user = await completeSuccessfulAdd()
    await user.click(screen.getByRole('button', { name: 'Voir les avis' }))
    expect(await screen.findByText('avis:?etablissement=establishment-123&statut=all')).toBeVisible()
  })

  it('retourne à la liste des établissements', async () => {
    const user = await completeSuccessfulAdd()
    await user.click(screen.getByRole('button', { name: 'Retour aux établissements' }))
    expect(await screen.findByText('établissements:')).toBeVisible()
  })

  it('restaure le succès après refresh sans recréer l’établissement', () => {
    renderWizard({ addEstablishmentSuccess: { query: 'https://maps.app.goo.gl/test', candidate, result: successResult } })
    expect(screen.getByText('✓ Établissement ajouté')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Ajouter cet établissement' })).not.toBeInTheDocument()
    expect(addEstablishment).not.toHaveBeenCalled()
  })

  it('passe immédiatement en import serveur après la création du job', async () => {
    const user = userEvent.setup()
    addEstablishment.mockResolvedValue({
      importJobId: 'job-123',
      status: 'queued',
    })
    renderWizard()
    await user.type(screen.getByPlaceholderText('Lien Google Maps'), 'https://maps.app.goo.gl/test')
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher l’établissement' }))
    await user.click(await screen.findByRole('button', { name: 'Ajouter cet établissement' }))

    expect(await screen.findByText('Import en cours…')).toBeVisible()
    expect(screen.getByText(/fermer l’application/)).toBeVisible()
    expect(addEstablishment).toHaveBeenCalledTimes(1)
    expect(screen.queryByPlaceholderText('Lien Google Maps')).not.toBeInTheDocument()
  })

  it.each([
    ['fr', 'Notre système a rencontré un problème pour récupérer les avis. Veuillez réessayer. Si le problème persiste, veuillez réessayer ultérieurement.', 'Réessayer'],
    ['vi', 'Hệ thống gặp sự cố khi thu thập đánh giá. Vui lòng thử lại. Nếu sự cố vẫn tiếp diễn, vui lòng thử lại sau.', 'Thử lại'],
  ] as const)('restaure un échec en %s sans afficher le fournisseur ni annoncer un succès', async (language, message, retry) => {
    initialImportJobs = [{
      id: 'failed-job', organizationId: 'org', userId: 'user', query: 'https://maps.app.goo.gl/test',
      expectedGoogleId: candidate.placeRef, status: 'failed', reviewsTarget: 150,
      reviewsFetched: 5, reviewsInserted: 5, errorCode: 'APIFY_START_OUTCOME_UNKNOWN',
      candidate, createdAt: '2026-10-28T04:12:43Z', updatedAt: '2026-10-28T04:12:56Z',
    }]
    renderWizard(undefined, language)
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(document.body).not.toHaveTextContent(/apify|✓/i)
    expect(retryEstablishmentImport).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: retry }))
    expect(retryEstablishmentImport).toHaveBeenCalledExactlyOnceWith('failed-job')
    expect(addEstablishment).not.toHaveBeenCalled()
  })

  it('actualise une erreur déjà affichée lorsque la langue du compte change', async () => {
    const state = { addEstablishmentSuccess: { query: 'https://maps.app.goo.gl/test', candidate, result: { ...successResult, importJobId: 'failed-job', status: 'failed', importStatus: 'failed' } } }
    const view = (language: 'fr' | 'vi') => <I18nProvider language={language}><MemoryRouter initialEntries={[{ pathname: '/etablissements/ajouter', state }]}><AddEstablishmentPage /></MemoryRouter></I18nProvider>
    retryEstablishmentImport.mockRejectedValue(new Error('APIFY_RATE_LIMIT: upstream details'))
    const mounted = render(view('fr'))
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Notre système a rencontré un problème pour récupérer les avis.')
    mounted.rerender(view('vi'))
    expect(screen.getByRole('alert')).toHaveTextContent('Hệ thống gặp sự cố khi thu thập đánh giá.')
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeEnabled()
    expect(document.body).not.toHaveTextContent(/apify|upstream details|Notre système/i)
    expect(retryEstablishmentImport).toHaveBeenCalledTimes(1)
  })

  it('signale un import techniquement terminé mais partiel et propose une nouvelle tentative manuelle', async () => {
    initialImportJobs = [{
      id: 'partial-job', organizationId: 'org', userId: 'user', query: 'https://maps.app.goo.gl/test',
      expectedGoogleId: candidate.placeRef, status: 'completed', reviewsTarget: 150,
      reviewsFetched: 5, reviewsInserted: 5, candidate,
      result: { importStatus: 'partial', establishmentId: 'existing-place', inserted: 5 },
      createdAt: '2026-10-28T04:12:43Z', updatedAt: '2026-10-28T04:12:56Z',
    }]
    renderWizard()
    expect(await screen.findByRole('alert')).toHaveTextContent('Notre système a rencontré un problème pour récupérer les avis.')
    expect(screen.queryByText('✓ Établissement ajouté')).not.toBeInTheDocument()
    expect(retryEstablishmentImport).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(retryEstablishmentImport).toHaveBeenCalledExactlyOnceWith('partial-job')
    expect(addEstablishment).not.toHaveBeenCalled()
  })

  it('affiche les avis uniques reçus pendant une relance, pas le nombre total déjà stocké', async () => {
    initialImportJobs = [{
      id: 'running-job', organizationId: 'org', userId: 'user', query: 'https://maps.app.goo.gl/test',
      expectedGoogleId: candidate.placeRef, status: 'running', reviewsTarget: 150,
      reviewsFetched: 5, reviewsInserted: 150, candidate,
      createdAt: '2026-10-28T04:12:43Z', updatedAt: '2026-10-28T04:12:56Z',
    }]
    renderWizard()
    expect(await screen.findByText('5 / 150 avis importés')).toBeVisible()
    expect(screen.queryByText('150 / 150 avis importés')).not.toBeInTheDocument()
  })
})
