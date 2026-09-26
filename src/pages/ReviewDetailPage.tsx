import { Check, CircleAlert, Clipboard, ExternalLink, LoaderCircle, MapPin, RefreshCw, RotateCcw, Sparkles, Timer } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useApp } from '../app/AppContext'
import { EstablishmentAvatar } from '../components/ui/EstablishmentAvatar'
import { PageHeader } from '../components/ui/PageHeader'
import { relativeTime } from '../lib/format'
import { categoryLabels } from '../lib/review-rules'

export function ReviewDetailPage() {
  const { id } = useParams(); const { reviews, establishments, generateResponse, markProcessed, reopenReview, logAction, pushToast } = useApp()
  const review = reviews.find((item) => item.id === id); const establishment = establishments.find((item) => item.id === review?.establishmentId)
  const [response, setResponse] = useState(review?.analysis?.suggestedResponse ?? '')
  const [generating, setGenerating] = useState(false); const [copied, setCopied] = useState(false)
  useEffect(() => { if (review) logAction(review.id, 'opened') }, [review?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!review || !establishment) return <><PageHeader title="Avis" back/><div className="empty-state"><h2>Avis introuvable</h2></div></>
  const handleGenerate = async () => { setGenerating(true); try { setResponse(await generateResponse(review.id)) } finally { setGenerating(false) } }
  const handleCopy = async () => { await navigator.clipboard.writeText(response); logAction(review.id, 'response_copied'); setCopied(true); pushToast('Réponse copiée'); window.setTimeout(()=>setCopied(false),1800) }
  const openMaps = () => { logAction(review.id, 'opened_google_maps'); window.open(review.sourceUrl || establishment.googleMapsUrl, '_blank', 'noopener,noreferrer') }
  return <><PageHeader title="Détail de l’avis" back action={<span/>}/>
    <section className="review-detail card"><div className="review-establishment"><EstablishmentAvatar id={establishment.id} name={establishment.name} large photoUrl={establishment.photoUrl}/><div><strong>{establishment.name}</strong><span>{relativeTime(review.publishedAt)}</span><b className={`detail-rating rating-${review.rating}`}>{review.rating} ★</b></div></div><blockquote>{review.reviewText}</blockquote><span className="author">— {review.authorName}</span></section>
    {review.analysis ? <><div className="analysis-summary-grid"><div className="analysis-tile problem"><Timer/><span>Problème détecté<strong>{categoryLabels[review.analysis.primaryCategory]}</strong></span></div><div className="analysis-tile urgency"><CircleAlert/><span>Urgence<strong>{review.analysis.urgency === 'critical' ? 'Critique' : review.analysis.urgency === 'high' ? 'Élevée' : review.analysis.urgency === 'medium' ? 'Moyenne' : 'Faible'}</strong></span></div></div><section className="ai-panel card"><div className="ai-heading"><span><Sparkles size={20}/>Résumé IA</span></div><div className="ai-summary-copy">{review.analysis.summary}</div></section></> : <section className="ai-panel card"><div className="ai-heading"><span><Sparkles size={18}/>Résumé IA</span></div><p>Analyse IA indisponible. L’avis reste à traiter et peut être relancé.</p><button className="secondary-button"><RefreshCw size={17}/>Relancer l’analyse</button></section>}
    {!response ? <div className="detail-actions"><button className="primary-button full-width" onClick={handleGenerate} disabled={generating}>{generating?<LoaderCircle className="spin"/>:<Sparkles/>}{generating?'Génération…':'Générer une réponse'}</button><button className="secondary-button full-width" onClick={openMaps}><MapPin size={18}/>Ouvrir dans Google Maps</button></div> : <section className="response-panel card"><div className="response-title"><h2>Réponse suggérée</h2><span>À relire avant publication</span></div><textarea value={response} onChange={(e)=>setResponse(e.target.value)} rows={9} aria-label="Réponse suggérée"/><div className="response-grid"><button className="primary-button" onClick={handleCopy}>{copied?<Check/>:<Clipboard/>}{copied?'Copiée':'Copier la réponse'}</button><button className="secondary-button" onClick={handleGenerate} disabled={generating}><RefreshCw size={17}/>Régénérer</button><button className="secondary-button" onClick={openMaps}><ExternalLink size={17}/>Google Maps</button>{review.status==='processed'?<button className="secondary-button" onClick={()=>reopenReview(review.id)}><RotateCcw size={17}/>Rouvrir</button>:<button className="secondary-button success" onClick={()=>markProcessed(review.id)}><Check size={17}/>Marquer traité</button>}</div></section>}
  </>
}
