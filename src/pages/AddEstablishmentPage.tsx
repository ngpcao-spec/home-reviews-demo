import { CheckCircle2, Link2, LoaderCircle, MapPin, Search } from 'lucide-react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp, type AddEstablishmentResult } from '../app/AppContext'
import { EstablishmentAvatar } from '../components/ui/EstablishmentAvatar'
import { PageHeader } from '../components/ui/PageHeader'
import { Stars } from '../components/ui/Stars'
import type { PlaceCandidate } from '../services/review-provider'

type Step = 'input' | 'confirm' | 'import' | 'success'

interface AddWizardLocationState {
  addEstablishmentSuccess?: {
    query: string
    candidate: PlaceCandidate
    result: AddEstablishmentResult
  }
}

const errorMessages: Record<string, string> = {
  INVALID_GOOGLE_MAPS_LINK: 'Ce lien Google Maps n’est pas valide.',
  INVALID_INPUT: 'Ce lien Google Maps n’est pas valide.',
  ESTABLISHMENT_NOT_FOUND: 'Aucun établissement n’a été trouvé avec ce lien.',
  GOOGLE_MAPS_LINK_RESOLUTION_FAILED: 'Le lien court Google Maps n’a pas pu être résolu.',
  ESTABLISHMENT_ALREADY_ADDED: 'Cet établissement est déjà ajouté à HOME Reviews.',
  OUTSCRAPER_UNAVAILABLE: 'Le service Google Maps est momentanément indisponible.',
  OUTSCRAPER_UPSTREAM_ERROR: 'Le service Google Maps est momentanément indisponible.',
  OUTSCRAPER_QUOTA_EXCEEDED: 'Le quota de recherche est temporairement atteint.',
  OUTSCRAPER_BILLING_REQUIRED: 'Le quota de recherche est temporairement atteint.',
  OUTSCRAPER_TIMEOUT: 'La recherche a pris trop de temps. Réessayez.',
  UNAUTHORIZED: 'Votre session a expiré. Reconnectez-vous.',
  FORBIDDEN: 'Vous n’avez pas l’autorisation d’ajouter un établissement.',
  ESTABLISHMENT_MISMATCH: 'La fiche Google Maps a changé. Relancez la recherche.',
}

function messageFor(error: unknown): string {
  const code = error instanceof Error ? error.message : 'UNKNOWN'
  return errorMessages[code] ?? 'Une erreur est survenue. Réessayez dans quelques instants.'
}

export function AddEstablishmentPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const restored = (location.state as AddWizardLocationState | null)?.addEstablishmentSuccess
  const {
    resolveEstablishment,
    addEstablishment,
    retryEstablishmentImport,
    establishments,
    plan,
    monitoringIntervalHours,
  } = useApp()
  const [step, setStep] = useState<Step>(restored ? 'success' : 'input')
  const [query, setQuery] = useState(restored?.query ?? '')
  const [candidate, setCandidate] = useState<PlaceCandidate | undefined>(restored?.candidate)
  const [result, setResult] = useState<AddEstablishmentResult | undefined>(restored?.result)
  const [loading, setLoading] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState('')
  const quotaReached = establishments.length >= plan.maxEstablishments

  const search = async () => {
    setError('')
    if (!query.trim()) {
      setError('Collez un lien Google Maps.')
      return
    }
    setLoading(true)
    try {
      const found = await resolveEstablishment(query.trim())
      setCandidate(found)
      setStep('confirm')
    } catch (searchError) {
      setError(messageFor(searchError))
    } finally {
      setLoading(false)
    }
  }

  const confirm = async () => {
    if (!candidate) return
    setError('')
    setStep('import')
    try {
      const imported = await addEstablishment(query.trim(), candidate)
      setResult(imported)
      setStep('success')
      navigate('/etablissements/ajouter', {
        replace: true,
        state: { addEstablishmentSuccess: { query: query.trim(), candidate, result: imported } },
      })
    } catch (importError) {
      setError(messageFor(importError))
      setStep('confirm')
    }
  }

  const retryImport = async () => {
    if (!candidate || !result) return
    setRetrying(true)
    setError('')
    try {
      const retried = await retryEstablishmentImport(result.establishmentId)
      const updated: AddEstablishmentResult = {
        ...result,
        importStatus: 'completed',
        retryable: false,
        negativeReviewCount: retried.negativeReviewCount,
        inserted: retried.negativeReviewCount,
        nextSyncAt: retried.nextSyncAt ?? result.nextSyncAt,
      }
      setResult(updated)
      navigate('/etablissements/ajouter', {
        replace: true,
        state: { addEstablishmentSuccess: { query, candidate, result: updated } },
      })
    } catch (retryError) {
      setError(messageFor(retryError))
    } finally {
      setRetrying(false)
    }
  }

  const nextCheckHours = result?.nextSyncAt
    ? Math.max(1, Math.round((new Date(result.nextSyncAt).getTime() - Date.now()) / 3_600_000))
    : monitoringIntervalHours
  const negativeReviewCount = result?.negativeReviewCount ?? result?.inserted ?? 0

  return <>
    <PageHeader title="Ajouter un établissement" back />
    <div className="stepper" aria-label="Progression">
      <i className="done" />
      <i className={step !== 'input' ? 'done' : ''} />
      <i className={step === 'import' || step === 'success' ? 'done' : ''} />
      <i className={step === 'success' ? 'done' : ''} />
    </div>

    {quotaReached && <div className="quota-alert"><MapPin /><div><strong>Quota atteint</strong><span>Votre plan autorise {plan.maxEstablishments} établissements.</span></div></div>}

    {step === 'input' && <section className="flow-card card">
      <span className="flow-icon"><MapPin /></span>
      <h2>Ajouter un établissement</h2>
      <p>Collez simplement le lien Google Maps de votre établissement.</p>
      <label className="search-field">
        <Link2 />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void search() }}
          placeholder="Lien Google Maps"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          autoFocus
        />
      </label>
      <div className="input-hint">Exemple : https://maps.app.goo.gl/...</div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button className="primary-button full-width" onClick={() => void search()} disabled={loading || quotaReached}>
        {loading ? <LoaderCircle className="spin" /> : <Search />}
        {loading ? 'Recherche…' : "Rechercher l’établissement"}
      </button>
    </section>}

    {step === 'confirm' && candidate && <section className="flow-card card">
      <span className="flow-icon success"><CheckCircle2 /></span>
      <h2>Confirmer l’établissement</h2>
      <div className="confirm-place">
        <EstablishmentAvatar id={candidate.placeRef} name={candidate.name} photoUrl={candidate.photoUrl} large />
        <div>
          <strong>{candidate.name}</strong>
          <p>{candidate.address}</p>
          <span className="rating-line"><b>{candidate.rating.toFixed(1)}</b><Stars rating={Math.round(candidate.rating)} compact /><em>{candidate.reviewCount} avis</em></span>
        </div>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="button-row">
        <button className="secondary-button" onClick={() => { setStep('input'); setCandidate(undefined); setError(''); navigate('/etablissements/ajouter', { replace: true, state: null }) }}>Annuler</button>
        <button className="primary-button" onClick={() => void confirm()}>Ajouter cet établissement</button>
      </div>
    </section>}

    {step === 'import' && <section className="flow-card import-card card" aria-live="polite">
      <span className="flow-icon"><LoaderCircle className="spin" /></span>
      <h2>Import en cours…</h2>
      <p>Nous récupérons vos avis récents et préparons votre espace.</p>
    </section>}

    {step === 'success' && candidate && result && <section className="flow-card import-card card" aria-live="polite">
      <span className="flow-icon success"><CheckCircle2 /></span>
      <h2>✓ Établissement ajouté</h2>
      <div className="confirm-place">
        <EstablishmentAvatar id={candidate.placeRef} name={candidate.name} photoUrl={candidate.photoUrl} large />
        <div>
          <strong>{candidate.name}</strong>
          <span className="rating-line"><b>{candidate.rating.toFixed(1)}</b><Stars rating={Math.round(candidate.rating)} compact /><em>{candidate.reviewCount} avis Google</em></span>
        </div>
      </div>
      {result.importStatus === 'failed'
        ? <p><strong>Certains avis n’ont pas encore pu être importés.</strong></p>
        : <p><strong>{negativeReviewCount} avis négatifs importés</strong> dans HOME Reviews.</p>}
      {result.importStatus !== 'failed' && <p>
        Surveillance activée.<br />
        Surveillance toutes les {monitoringIntervalHours} heures.<br />
        Prochain contrôle dans environ {nextCheckHours} h.
      </p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      {result.importStatus === 'failed' ? <button className="primary-button full-width" disabled={retrying} onClick={() => void retryImport()}>
        {retrying ? <LoaderCircle className="spin" /> : null}
        {retrying ? 'Nouvelle tentative…' : 'Réessayer l’import'}
      </button> : <div className="button-row">
        <button className="primary-button" onClick={() => navigate(`/avis?etablissement=${result.establishmentId}&statut=all`)}>Voir les avis</button>
        <button className="secondary-button" onClick={() => navigate('/etablissements')}>Retour aux établissements</button>
      </div>}
    </section>}
  </>
}
