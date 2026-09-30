import { CheckCircle2, Link2, LoaderCircle, MapPin, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp, type AddEstablishmentResult } from '../app/AppContext'
import { EstablishmentAvatar } from '../components/ui/EstablishmentAvatar'
import { PageHeader } from '../components/ui/PageHeader'
import { Stars } from '../components/ui/Stars'
import type { PlaceCandidate } from '../services/review-provider'
import { useI18n } from '../i18n'
import type { Messages } from '../i18n/fr'

type Step = 'input' | 'confirm' | 'import' | 'success'

interface AddWizardLocationState {
  addEstablishmentSuccess?: {
    query: string
    candidate: PlaceCandidate
    result: AddEstablishmentResult
  }
}

function messageFor(error: unknown, messages: Messages): string {
  const code = error instanceof Error ? error.message : 'UNKNOWN'
  const errors = messages.add.errors
  const errorMessages: Record<string, string> = {
    INVALID_GOOGLE_MAPS_LINK: errors.invalidLink,
    INVALID_INPUT: errors.invalidLink,
    ESTABLISHMENT_NOT_FOUND: errors.notFound,
    GOOGLE_MAPS_LINK_RESOLUTION_FAILED: errors.resolution,
    ESTABLISHMENT_ALREADY_ADDED: errors.duplicate,
    OUTSCRAPER_UNAVAILABLE: errors.unavailable,
    OUTSCRAPER_UPSTREAM_ERROR: errors.unavailable,
    APIFY_UNAVAILABLE: errors.unavailable,
    APIFY_RATE_LIMIT: errors.quota,
    OUTSCRAPER_QUOTA_EXCEEDED: errors.quota,
    OUTSCRAPER_BILLING_REQUIRED: errors.quota,
    OUTSCRAPER_TIMEOUT: errors.timeout,
    APIFY_TIMEOUT: errors.timeout,
    UNAUTHORIZED: errors.unauthorized,
    FORBIDDEN: errors.forbidden,
    ESTABLISHMENT_MISMATCH: errors.mismatch,
  }
  return errorMessages[code] ?? errors.generic
}

export function AddEstablishmentPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const restored = (location.state as AddWizardLocationState | null)?.addEstablishmentSuccess
  const {
    resolveEstablishment,
    addEstablishment,
    retryEstablishmentImport,
    acknowledgeInitialImport,
    refreshInitialImports,
    initialImportJobs,
    establishments,
    plan,
    monitoringIntervalHours,
  } = useApp()
  const { messages } = useI18n()
  const [step, setStep] = useState<Step>(restored ? 'success' : 'input')
  const [query, setQuery] = useState(restored?.query ?? '')
  const [candidate, setCandidate] = useState<PlaceCandidate | undefined>(restored?.candidate)
  const [result, setResult] = useState<AddEstablishmentResult | undefined>(restored?.result)
  const [loading, setLoading] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState('')
  const quotaReached = establishments.length >= plan.maxEstablishments
  const currentJob = result?.importJobId
    ? initialImportJobs.find((job) => job.id === result.importJobId)
    : initialImportJobs[0]

  useEffect(() => {
    const job = initialImportJobs[0]
    if (!job) return
    const restoredCandidate: PlaceCandidate = {
      placeRef: job.expectedGoogleId,
      name: job.candidate.name ?? messages.add.importing,
      address: job.candidate.address ?? '',
      rating: job.candidate.rating ?? 0,
      reviewCount: job.candidate.reviewCount ?? 0,
      googleMapsUrl: job.candidate.googleMapsUrl ?? job.query,
      photoUrl: job.candidate.photoUrl,
      confidence: 1,
    }
    setQuery(job.query)
    setCandidate(restoredCandidate)
    const jobResult: AddEstablishmentResult = {
      importJobId: job.id,
      status: job.status,
      establishmentId: job.establishmentId ?? job.result?.establishmentId,
      inserted: job.result?.inserted ?? job.reviewsInserted,
      negativeReviewCount: job.result?.negativeReviewCount,
      distribution: job.result?.distribution ?? { '1': 0, '2': 0, '3': 0 },
      importStatus: job.status === 'completed' ? 'completed' : job.status === 'failed' ? 'failed' : undefined,
      retryable: job.status === 'failed',
      nextSyncAt: job.result?.nextSyncAt,
    }
    setResult(jobResult)
    setError(job.status === 'failed' ? messageFor(new Error(job.errorCode ?? 'UNKNOWN'), messages) : '')
    setStep(job.status === 'completed' || job.status === 'failed' ? 'success' : 'import')
  }, [initialImportJobs, messages])

  useEffect(() => {
    if (step !== 'import' || !currentJob || !['queued', 'running', 'retry'].includes(currentJob.status)) return
    const timer = window.setInterval(() => { void refreshInitialImports() }, 3_000)
    return () => window.clearInterval(timer)
  }, [currentJob, refreshInitialImports, step])

  const search = async () => {
    setError('')
    if (!query.trim()) {
      setError(messages.add.pasteLink)
      return
    }
    setLoading(true)
    try {
      const found = await resolveEstablishment(query.trim())
      setCandidate(found)
      setStep('confirm')
    } catch (searchError) {
      setError(messageFor(searchError, messages))
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
      setStep(imported.status === 'completed' ? 'success' : 'import')
    } catch (importError) {
      setError(messageFor(importError, messages))
      setStep('confirm')
    }
  }

  const retryImport = async () => {
    if (!result?.importJobId) return
    setRetrying(true)
    setError('')
    try {
      await retryEstablishmentImport(result.importJobId)
      setResult((current) => current ? { ...current, status: 'queued', importStatus: undefined, retryable: false } : current)
      setStep('import')
      await refreshInitialImports()
    } catch (retryError) {
      setError(messageFor(retryError, messages))
    } finally {
      setRetrying(false)
    }
  }

  const leaveSuccess = async (destination: string) => {
    if (result?.importJobId) {
      try { await acknowledgeInitialImport(result.importJobId) } catch { /* keep server state restorable */ }
    }
    navigate(destination)
  }

  const nextCheckHours = result?.nextSyncAt
    ? Math.max(1, Math.round((new Date(result.nextSyncAt).getTime() - Date.now()) / 3_600_000))
    : monitoringIntervalHours
  const negativeReviewCount = result?.negativeReviewCount ?? result?.inserted ?? 0

  return <>
    <PageHeader title={messages.add.title} back />
    <div className="stepper" aria-label="Progression">
      <i className="done" />
      <i className={step !== 'input' ? 'done' : ''} />
      <i className={step === 'import' || step === 'success' ? 'done' : ''} />
      <i className={step === 'success' ? 'done' : ''} />
    </div>

    {quotaReached && <div className="quota-alert"><MapPin /><div><strong>{messages.add.quota}</strong><span>{messages.add.quotaDetail.replace('{count}', String(plan.maxEstablishments))}</span></div></div>}

    {step === 'input' && <section className="flow-card card">
      <span className="flow-icon"><MapPin /></span>
      <h2>{messages.add.title}</h2>
      <p>{messages.add.paste}</p>
      <label className="search-field">
        <Link2 />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void search() }}
          placeholder={messages.add.mapLink}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          autoFocus
        />
      </label>
      <div className="input-hint">{messages.add.example}</div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button className="primary-button full-width" onClick={() => void search()} disabled={loading || quotaReached}>
        {loading ? <LoaderCircle className="spin" /> : <Search />}
        {loading ? messages.add.searching : messages.add.search}
      </button>
    </section>}

    {step === 'confirm' && candidate && <section className="flow-card card">
      <span className="flow-icon success"><CheckCircle2 /></span>
      <h2>{messages.add.confirmPlace}</h2>
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
        <button className="secondary-button" onClick={() => { setStep('input'); setCandidate(undefined); setError(''); navigate('/etablissements/ajouter', { replace: true, state: null }) }}>{messages.common.cancel}</button>
        <button className="primary-button" onClick={() => void confirm()}>{messages.add.addPlace}</button>
      </div>
    </section>}

    {step === 'import' && <section className="flow-card import-card card" aria-live="polite">
      <span className="flow-icon"><LoaderCircle className="spin" /></span>
      <h2>{messages.add.importing}</h2>
      <p>{messages.add.importingBody}</p>
      <p className="import-background-note">{messages.add.importContinues}</p>
      {currentJob && currentJob.reviewsFetched > 0 && <div className="import-progress-copy">{messages.add.importProgress.replace('{count}', String(currentJob.reviewsInserted)).replace('{target}', String(currentJob.reviewsTarget))}</div>}
    </section>}

    {step === 'success' && candidate && result && <section className="flow-card import-card card" aria-live="polite">
      <span className="flow-icon success"><CheckCircle2 /></span>
      <h2>✓ {messages.add.success}</h2>
      <div className="confirm-place">
        <EstablishmentAvatar id={candidate.placeRef} name={candidate.name} photoUrl={candidate.photoUrl} large />
        <div>
          <strong>{candidate.name}</strong>
          <span className="rating-line"><b>{candidate.rating.toFixed(1)}</b><Stars rating={Math.round(candidate.rating)} compact /><em>{candidate.reviewCount} {messages.add.googleReviews}</em></span>
        </div>
      </div>
      {result.importStatus === 'failed'
        ? <p><strong>{messages.add.partialImport}</strong></p>
        : <p><strong>{messages.add.imported.replace('{count}', String(negativeReviewCount))}</strong></p>}
      {result.importStatus !== 'failed' && <p>
        {messages.add.monitoringEnabled}<br />
        {messages.add.monitoringEvery.replace('{hours}', String(monitoringIntervalHours))}<br />
        {messages.add.nextControl.replace('{hours}', String(nextCheckHours))}
      </p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      {result.importStatus === 'failed' ? <button className="primary-button full-width" disabled={retrying} onClick={() => void retryImport()}>
        {retrying ? <LoaderCircle className="spin" /> : null}
        {retrying ? messages.add.retrying : messages.add.retryImport}
      </button> : <div className="button-row">
        <button className="primary-button" disabled={!result.establishmentId} onClick={() => void leaveSuccess(`/avis?etablissement=${result.establishmentId}&statut=all`)}>{messages.add.viewReviews}</button>
        <button className="secondary-button" onClick={() => void leaveSuccess('/etablissements')}>{messages.add.backPlaces}</button>
      </div>}
    </section>}
  </>
}
