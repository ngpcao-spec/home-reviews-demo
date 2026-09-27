import { CheckCircle2, Link2, LoaderCircle, MapPin, Search } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp, type AddEstablishmentResult } from '../app/AppContext'
import { EstablishmentAvatar } from '../components/ui/EstablishmentAvatar'
import { PageHeader } from '../components/ui/PageHeader'
import { Stars } from '../components/ui/Stars'
import type { PlaceCandidate } from '../services/review-provider'

type Step = 'input' | 'confirm' | 'import' | 'success'

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
  const { resolveEstablishment, addEstablishment, establishments, plan } = useApp()
  const [step, setStep] = useState<Step>('input')
  const [query, setQuery] = useState('')
  const [candidate, setCandidate] = useState<PlaceCandidate>()
  const [result, setResult] = useState<AddEstablishmentResult>()
  const [loading, setLoading] = useState(false)
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
    } catch (importError) {
      setError(messageFor(importError))
      setStep('confirm')
    }
  }

  return <>
    <PageHeader title="Ajouter un établissement" back />
    <div className="stepper" aria-label="Progression">
      <i className="done" />
      <i className={step !== 'input' ? 'done' : ''} />
      <i className={step === 'import' || step === 'success' ? 'done' : ''} />
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
        <button className="secondary-button" onClick={() => { setStep('input'); setCandidate(undefined); setError('') }}>Annuler</button>
        <button className="primary-button" onClick={() => void confirm()}>Ajouter cet établissement</button>
      </div>
    </section>}

    {step === 'import' && <section className="flow-card import-card card" aria-live="polite">
      <span className="flow-icon"><LoaderCircle className="spin" /></span>
      <h2>Analyse de votre établissement…</h2>
      <p>Nous récupérons les avis Google nécessitant votre attention.</p>
    </section>}

    {step === 'success' && candidate && result && <section className="flow-card import-card card" aria-live="polite">
      <span className="flow-icon success"><CheckCircle2 /></span>
      <h2>Établissement ajouté</h2>
      {result.importStatus === 'failed'
        ? <p><strong>L’établissement est bien enregistré.</strong> L’import des avis a échoué temporairement et pourra être relancé.</p>
        : <p><strong>{result.inserted} avis nécessitant une attention</strong> ont été trouvés.</p>}
      <div className="import-summary">
        <span>1★ <b>{result.distribution['1']}</b></span>
        <span>2★ <b>{result.distribution['2']}</b></span>
        <span>3★ <b>{result.distribution['3']}</b></span>
      </div>
      <button className="primary-button full-width" onClick={() => navigate(
        result.importStatus === 'failed'
          ? `/etablissements/${result.establishmentId}`
          : `/avis?etablissement=${result.establishmentId}&statut=to_process`,
      )}>
        {result.importStatus === 'failed' ? 'Voir l’établissement' : 'Voir les avis'}
      </button>
    </section>}
  </>
}
