import { Check, Clipboard, ExternalLink, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useApp } from '../app/AppContext'
import { EstablishmentAvatar } from '../components/ui/EstablishmentAvatar'
import { PageHeader } from '../components/ui/PageHeader'
import { relativeTime } from '../lib/format'

export function ReviewDetailPage() {
  const { id } = useParams()
  const { reviews, establishments, generateResponse, logAction, pushToast } = useApp()
  const review = reviews.find((item) => item.id === id)
  const establishment = establishments.find((item) => item.id === review?.establishmentId)
  const [response, setResponse] = useState(review?.aiSuggestedReply ?? '')
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setResponse(review?.aiSuggestedReply ?? '')
  }, [review?.aiSuggestedReply])

  useEffect(() => {
    if (review) logAction(review.id, 'opened')
  }, [review?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!review || !establishment) {
    return <><PageHeader title="Avis" back/><div className="empty-state"><h2>Avis introuvable</h2></div></>
  }

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      setResponse(await generateResponse(review.id))
      pushToast('Analyse IA terminée')
    } catch {
      pushToast('L’analyse IA a échoué. Vous pouvez réessayer.')
    } finally {
      setGenerating(false)
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(response)
    logAction(review.id, 'response_copied')
    setCopied(true)
    pushToast('Réponse copiée')
    window.setTimeout(() => setCopied(false), 1800)
  }

  const openMaps = () => {
    logAction(review.id, 'opened_google_maps')
    window.open(review.sourceUrl || establishment.googleMapsUrl, '_blank', 'noopener,noreferrer')
  }

  const completed = review.aiStatus === 'completed' && Boolean(review.aiSummary) && Boolean(review.aiSuggestedReply)
  const statusCopy = review.aiStatus === 'failed'
    ? 'L’analyse a échoué. L’avis est conservé et peut être analysé à nouveau.'
    : 'L’analyse est en attente. Vous pouvez la lancer maintenant.'

  return <><PageHeader title="Détail de l’avis" back action={<span/>}/>
    <section className="review-detail card">
      <div className="review-establishment">
        <EstablishmentAvatar id={establishment.id} name={establishment.name} large photoUrl={establishment.photoUrl}/>
        <div><strong>{establishment.name}</strong><span>{relativeTime(review.publishedAt)}</span><b className={`detail-rating rating-${review.rating}`}>{review.rating} ★</b></div>
      </div>
      <h2 className="review-section-label">Avis original</h2>
      <blockquote>{review.reviewText}</blockquote>
      <span className="author">— {review.authorName}</span>
    </section>

    <section className="ai-panel card">
      <div className="ai-heading"><span><Sparkles size={20}/>Résumé IA</span></div>
      {completed
        ? <div className="ai-summary-copy">{review.aiSummary}</div>
        : <div className="ai-empty"><p>{statusCopy}</p><button className="secondary-button" onClick={handleGenerate} disabled={generating}>{generating ? <LoaderCircle className="spin"/> : <RefreshCw size={17}/>} {generating ? 'Analyse…' : 'Relancer l’analyse'}</button></div>}
    </section>

    {response
      ? <section className="response-panel card">
          <div className="response-title"><h2><Sparkles size={18}/>Réponse proposée</h2><span>À relire avant publication</span></div>
          <textarea value={response} onChange={(event) => setResponse(event.target.value)} rows={9} aria-label="Réponse proposée"/>
          <div className="response-grid">
            <button className="primary-button" onClick={handleCopy}>{copied ? <Check/> : <Clipboard/>}{copied ? 'Copiée' : 'Copier la réponse'}</button>
            <button className="secondary-button" onClick={handleGenerate} disabled={generating}>{generating ? <LoaderCircle className="spin"/> : <RefreshCw size={17}/>}Régénérer</button>
            <button className="secondary-button response-map-button" onClick={openMaps}><ExternalLink size={17}/>Ouvrir dans Google Maps</button>
          </div>
        </section>
      : <div className="detail-actions"><button className="secondary-button full-width" onClick={openMaps}><ExternalLink size={18}/>Ouvrir dans Google Maps</button></div>}
  </>
}
