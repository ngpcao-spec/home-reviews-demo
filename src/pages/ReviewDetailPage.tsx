import { Check, Clipboard, ExternalLink, Languages, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../app/AppContext'
import { EstablishmentAvatar } from '../components/ui/EstablishmentAvatar'
import { PageHeader } from '../components/ui/PageHeader'
import { relativeTime } from '../lib/format'
import { useI18n } from '../i18n'

function baseLanguage(language?: string | null) {
  return language?.trim().toLowerCase().split(/[-_]/)[0] ?? ''
}

export function ReviewDetailPage() {
  const { id } = useParams()
  const { reviews, establishments, preferredLanguage, generateResponse, saveReplyDraft, translateReply, logAction, pushToast } = useApp()
  const { messages } = useI18n()
  const review = reviews.find((item) => item.id === id)
  const establishment = establishments.find((item) => item.id === review?.establishmentId)
  const persistedDraft = review?.replyDraftText ?? review?.aiSuggestedReply ?? ''
  const [response, setResponse] = useState(persistedDraft)
  const [generating, setGenerating] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const pendingSave = useRef<{ text: string; promise: Promise<number> } | null>(null)

  const persistDraft = (text: string) => {
    if (pendingSave.current?.text === text) return pendingSave.current.promise
    const previous = pendingSave.current?.promise.catch(() => 0) ?? Promise.resolve(0)
    const promise = previous.then(() => saveReplyDraft(review!.id, text))
    pendingSave.current = { text, promise }
    void promise.finally(() => {
      if (pendingSave.current?.promise === promise) pendingSave.current = null
    }).catch(() => undefined)
    return promise
  }

  useEffect(() => {
    setResponse(persistedDraft)
  }, [review?.id, persistedDraft])

  useEffect(() => {
    setShowOriginal(false)
  }, [review?.id])

  useEffect(() => {
    if (review) logAction(review.id, 'opened')
  }, [review?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!review || response === persistedDraft) return
    const timer = window.setTimeout(() => {
      void persistDraft(response).catch(() => pushToast(messages.reviews.draftSaveFailed))
    }, 700)
    return () => window.clearTimeout(timer)
  }, [review?.id, response, persistedDraft]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!review || !establishment) {
    return <><PageHeader title={messages.nav.reviews} back/><div className="empty-state"><h2>{messages.reviews.notFound}</h2></div></>
  }

  const handleGenerate = async () => {
    const manuallyEdited = Boolean(response) && response !== (review.aiSuggestedReply ?? '')
    if (manuallyEdited && !window.confirm(messages.reviews.confirmRegenerate)) return
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

  const openMaps = () => {
    logAction(review.id, 'opened_google_maps')
    window.open(review.sourceUrl || establishment.googleMapsUrl, '_blank', 'noopener,noreferrer')
  }

  const completed = review.aiStatus === 'completed' && Boolean(review.aiSummary) && Boolean(review.aiSuggestedReply)
  const statusCopy = review.aiStatus === 'failed' ? messages.reviews.analysisFailed : messages.reviews.analysisPending
  const hasTranslation = Boolean(review.translatedText && review.originalText && review.translatedText !== review.originalText)
  const draftDirty = response !== persistedDraft
  const sourceLanguage = baseLanguage(review.replyDraftLanguage ?? preferredLanguage)
  const clientLanguage = baseLanguage(review.reviewLanguage ?? review.aiDetectedLanguage)
  const translationRequired = Boolean(sourceLanguage && clientLanguage && sourceLanguage !== clientLanguage)
  const translationStale = Boolean(review.translatedReplyText) && (
    draftDirty || review.translatedFromDraftVersion !== (review.replyDraftVersion ?? 0)
  )
  const translationReady = Boolean(review.translatedReplyText) && !translationStale

  const handleTranslate = async () => {
    setTranslating(true)
    try {
      const version = draftDirty
        ? await persistDraft(response)
        : review.replyDraftVersion ?? 0
      await translateReply(review.id, version)
      pushToast(messages.reviews.translationReady)
    } catch {
      pushToast(messages.reviews.translationFailed)
    } finally {
      setTranslating(false)
    }
  }

  const finalReply = translationRequired ? review.translatedReplyText ?? '' : response
  const handleCopy = async () => {
    if (!finalReply || (translationRequired && !translationReady)) return
    await navigator.clipboard.writeText(finalReply)
    logAction(review.id, 'response_copied')
    setCopied(true)
    pushToast(messages.reviews.replyCopied)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return <><PageHeader title={messages.reviews.detailTitle} back action={<span/>}/>
    <section className="review-detail card">
      <div className="review-establishment">
        <EstablishmentAvatar id={establishment.id} name={establishment.name} large photoUrl={establishment.photoUrl}/>
        <div><strong>{establishment.name}</strong><span>{relativeTime(review.publishedAt)}</span><b className={`detail-rating rating-${review.rating}`}>{review.rating} ★</b></div>
      </div>
      <h2 className="review-section-label">{messages.reviews.reviewLabel}</h2>
      <blockquote>{showOriginal ? review.originalText : review.reviewText}</blockquote>
      {hasTranslation && <button className="text-button" onClick={() => setShowOriginal((value) => !value)}>{showOriginal ? messages.reviews.viewTranslation : messages.reviews.viewOriginal}</button>}
      <span className="author">— {review.authorName}</span>
    </section>

    <section className="ai-panel card">
      <div className="ai-heading"><span><Sparkles size={20}/>{messages.reviews.aiSummary}</span></div>
      {completed
        ? <div className="ai-summary-copy">{review.aiSummary}</div>
        : <div className="ai-empty"><p>{statusCopy}</p><button className="secondary-button" onClick={handleGenerate} disabled={generating}>{generating ? <LoaderCircle className="spin"/> : <RefreshCw size={17}/>} {generating ? '…' : messages.reviews.relaunch}</button></div>}
    </section>

    {response
      ? <>
          <section className="response-panel card">
            <div className="response-title"><h2><Sparkles size={18}/>{messages.reviews.suggestedReply}</h2><span>{messages.reviews.reviewBeforePublishing}</span></div>
            <textarea value={response} onChange={(event) => setResponse(event.target.value)} rows={9} aria-label={messages.reviews.suggestedReply}/>
            <div className="response-grid">
              <button className="secondary-button" onClick={handleGenerate} disabled={generating}>{generating ? <LoaderCircle className="spin"/> : <RefreshCw size={17}/>} {messages.reviews.regenerate}</button>
              {translationRequired
                ? <button className="primary-button" onClick={handleTranslate} disabled={translating || !response.trim()}>{translating ? <LoaderCircle className="spin"/> : <Languages size={18}/>} {translationStale ? messages.reviews.retranslate : messages.reviews.translateForClient}</button>
                : <button className="primary-button" onClick={handleCopy} disabled={!response.trim()}>{copied ? <Check/> : <Clipboard/>}{copied ? messages.reviews.copied : messages.reviews.copy}</button>}
            </div>
          </section>

          {translationRequired && review.translatedReplyText && <section className={`response-panel client-reply card${translationStale ? ' stale' : ''}`}>
            <div className="response-title"><h2><Languages size={18}/>{messages.reviews.clientLanguageReply}</h2><span>{translationStale ? messages.reviews.translationOutdated : messages.reviews.translationReady}</span></div>
            <div className="translated-reply-copy">{review.translatedReplyText}</div>
            <div className="response-grid">
              <button className="primary-button" onClick={handleCopy} disabled={translationStale}>{copied ? <Check/> : <Clipboard/>}{copied ? messages.reviews.copied : messages.reviews.copy}</button>
              {translationStale && <button className="secondary-button" onClick={handleTranslate} disabled={translating}>{translating ? <LoaderCircle className="spin"/> : <RefreshCw size={17}/>} {messages.reviews.retranslate}</button>}
              <button className="secondary-button response-map-button" onClick={openMaps}><ExternalLink size={17}/>{messages.reviews.openMaps}</button>
            </div>
          </section>}

          {(!translationRequired || !review.translatedReplyText) && <div className="detail-actions"><button className="secondary-button full-width" onClick={openMaps}><ExternalLink size={18}/>{messages.reviews.openMaps}</button></div>}
        </>
      : <div className="detail-actions"><button className="secondary-button full-width" onClick={openMaps}><ExternalLink size={18}/>{messages.reviews.openMaps}</button></div>}
  </>
}
