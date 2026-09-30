import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AddEstablishmentPage } from './AddEstablishmentPage'

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

vi.mock('../app/AppContext', () => ({
  useApp: () => ({
    resolveEstablishment,
    addEstablishment,
    retryEstablishmentImport,
    acknowledgeInitialImport: vi.fn(),
    refreshInitialImports: vi.fn().mockResolvedValue(undefined),
    initialImportJobs: [],
    establishments: [],
    notifications: [],
    plan: { maxEstablishments: 5 },
    monitoringIntervalHours: 12,
  }),
}))

function Destination({ label }: { label: string }) {
  const location = useLocation()
  return <div>{label}:{location.search}</div>
}

function renderWizard(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/etablissements/ajouter', state }]}>
      <Routes>
        <Route path="/etablissements/ajouter" element={<AddEstablishmentPage />} />
        <Route path="/avis" element={<Destination label="avis" />} />
        <Route path="/etablissements" element={<Destination label="établissements" />} />
      </Routes>
    </MemoryRouter>,
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
    resolveEstablishment.mockReset().mockResolvedValue(candidate)
    addEstablishment.mockReset().mockResolvedValue(successResult)
    retryEstablishmentImport.mockReset().mockResolvedValue({
      negativeReviewCount: 18,
      nextSyncAt: successResult.nextSyncAt,
    })
  })

  it('conserve l’écran de succès et affiche toutes les informations attendues', async () => {
    await completeSuccessfulAdd()
    expect(screen.getByText('Restaurant Test')).toBeVisible()
    expect(screen.getByText(/4.6/)).toBeVisible()
    expect(screen.getByText(/4430 avis Google/)).toBeVisible()
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
})
