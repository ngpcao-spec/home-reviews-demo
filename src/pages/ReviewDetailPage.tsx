import { Check, Clipboard, ExternalLink, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useApp } from '../app/AppContext'
import { EstablishmentAvatar } from '../components/ui/EstablishmentAvatar'
import { PageHeader } from '../components/ui/PageHeader'
import { relativeTime } from '../lib/format'
import { useI18n } from '../i18n'

export function ReviewDetailPage() {
  const { id } = useParams()
  const { reviews, establishments, generateResponse, logAction, pushToast } = useApp()
  const { messages } = useI18n()
  const review = reviews.find((item) => item.id === id)
  const establishment = establishments.find((item) => item.id === review?.establishmentId)
  const [response, setResponse] = useState(review?.aiSuggestedReply ?? '')
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)

  useEffect(() => {
    setResponse(review?.aiSuggestedReply ?? '')
  }, [review?.aiSuggestedReply])

  useEffect(() => {
    if (review) logAction(review.id, 'opened')
  }, [review?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!review || !establishment) {
    return <><PageHeader title={messages.nav.reviews} back/><div className="empty-state"><h2>{messages.reviews.notFound}</h2></div></>
  }

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      setResponse(await generateResponse(review.id))
      pushToast(messages.reviews.analysisCompleted)
    } catch {
      pushToast(messages.reviews.analysisRetryFailed)
    } finally {
      setGenerating(false)
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(response)
    logAction(review.id, 'response_copied')
    setCopied(true)
    pushToast(messages.reviews.replyCopied)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const openMaps = () => {
    logAction(review.id, 'opened_google_maps')
    window.open(review.sourceUrl || establishment.googleMapsUrl, '_blank', 'noopener,noreferrer')
  }

  const completed = review.aiStatus === 'completed' && Boolean(review.aiSummary) && Boolean(review.aiSuggestedReply)
  const statusCopy = review.aiStatus === 'failed' ? messages.reviews.analysisFailed : messages.reviews.analysisPending
  const hasTranslation = Boolean(review.translatedText && review.originalText && review.translatedText !== review.originalText)

  return <><PageHeader title={messages.reviews.original} back action={<span/>}/>
    <section className="review-detail card">
      <div className="review-establishment">
        <EstablishmentAvatar id={establishment.id} name={establishment.name} large photoUrl={establishment.photoUrl}/>
        <div><strong>{establishment.name}</strong><span>{relativeTime(review.publishedAt)}</span><b className={`detail-rating rating-${review.rating}`}>{review.rating} ★</b></div>
      </div>
      <h2 className="review-section-label">{showOriginal ? messages.reviews.original : messages.nav.reviews}</h2>
      <blockquote>{showOriginal ? review.originalText : review.reviewText}</blockquote>
      {hasTranslation && <button className="text-button" onClick={() => setShowOriginal((value) => !value)}>{showOriginal ? messages.reviews.hideOriginal : messages.reviews.viewOriginal}</button>}
      <span className="author">— {review.authorName}</span>
    </section>

    <section className="ai-panel card">
      <div className="ai-heading"><span><Sparkles size={20}/>{messages.reviews.aiSummary}</span></div>
      {completed
        ? <div className="ai-summary-copy">{review.aiSummary}</div>
        : <div className="ai-empty"><p>{statusCopy}</p><button className="secondary-button" onClick={handleGenerate} disabled={generating}>{generating ? <LoaderCircle className="spin"/> : <RefreshCw size={17}/>} {generating ? '…' : messages.reviews.relaunch}</button></div>}
    </section>

    {response
      ? <section className="response-panel card">
          <div className="response-title"><h2><Sparkles size={18}/>{messages.reviews.suggestedReply}</h2><span>{messages.reviews.reviewBeforePublishing}</span></div>
          <textarea value={response} onChange={(event) => setResponse(event.target.value)} rows={9} aria-label={messages.reviews.suggestedReply}/>
          <div className="response-grid">
            <button className="primary-button" onClick={handleCopy}>{copied ? <Check/> : <Clipboard/>}{copied ? messages.reviews.copied : messages.reviews.copy}</button>
            <button className="secondary-button" onClick={handleGenerate} disabled={generating}>{generating ? <LoaderCircle className="spin"/> : <RefreshCw size={17}/>} {messages.reviews.regenerate}</button>
            <button className="secondary-button response-map-button" onClick={openMaps}><ExternalLink size={17}/>{messages.reviews.openMaps}</button>
          </div>
        </section>
      : <div className="detail-actions"><button className="secondary-button full-width" onClick={openMaps}><ExternalLink size={18}/>{messages.reviews.openMaps}</button></div>}
  </>
}
