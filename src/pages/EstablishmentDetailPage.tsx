import { ExternalLink, MapPin, Trash2 } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { useApp } from '../app/AppContext'
import { ReviewRow } from '../components/reviews/ReviewRow'
import { EstablishmentAvatar } from '../components/ui/EstablishmentAvatar'
import { PageHeader } from '../components/ui/PageHeader'
import { Stars } from '../components/ui/Stars'
import { SyncBadge } from '../components/ui/StatusBadge'
import { fullDate, timeUntil } from '../lib/format'
import { recentNegativeReviews } from '../lib/review-list'
import { useI18n } from '../i18n'

export function EstablishmentDetailPage() {
  const { id } = useParams(); const navigate = useNavigate()
  const { establishments, reviews, removeEstablishment } = useApp()
  const { messages } = useI18n()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const establishment = establishments.find((item) => item.id === id)
  if (!establishment) return <><PageHeader title={messages.reviews.establishment} back/><div className="empty-state"><h2>{messages.establishment.notFound}</h2><button className="secondary-button" onClick={() => navigate('/etablissements')}>{messages.common.back}</button></div></>
  const related = recentNegativeReviews(reviews.filter((item) => item.establishmentId === id))
  const confirmRemoval = async () => {
    setDeleting(true)
    setDeleteError('')
    try {
      await removeEstablishment(establishment.id)
      navigate('/etablissements')
    } catch {
      setDeleteError(messages.establishment.deleteFailed)
      setDeleting(false)
    }
  }
  return <><PageHeader title={establishment.name} back />
    <section className="est-detail-hero card"><div className="est-detail-cover"><EstablishmentAvatar id={establishment.id} name={establishment.name} photoUrl={establishment.photoUrl} large/></div><div className="est-detail-copy"><h2>{establishment.name}</h2><div className="rating-line"><strong>{establishment.currentRating.toFixed(1)}</strong><Stars rating={Math.round(establishment.currentRating)}/><span>{establishment.currentReviewCount} avis</span></div><p><MapPin size={15}/>{establishment.address}, {establishment.city}</p></div></section>
    <section className="sync-panel card"><div><strong>{messages.establishment.monitoringActive}</strong><SyncBadge status={establishment.syncStatus}/></div><div className="sync-timings"><p>{messages.establishment.lastCheck}<br/><strong>{fullDate(establishment.lastSyncedAt)}</strong></p><p>{messages.establishment.nextCheck}<br/><strong>{establishment.nextSyncAt ? timeUntil(establishment.nextSyncAt) : messages.establishment.notScheduled}</strong></p></div><div className="button-row"><a className="secondary-button full-width" href={establishment.googleMapsUrl} target="_blank" rel="noreferrer"><ExternalLink size={17}/>Google Maps</a></div></section>
    <div className="section-heading"><h2>{messages.establishment.recentNegative}</h2><button className="text-button" onClick={() => navigate(`/avis?etablissement=${id}&statut=all`)}>{messages.common.viewAll}</button></div>
    {related.map((review) => <ReviewRow key={review.id} review={review}/>)}
    <button className="danger-button full-width" onClick={() => setConfirmDelete(true)}><Trash2 size={17}/>{messages.establishment.delete}</button>
    {confirmDelete && <div className="modal-backdrop" role="presentation"><div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">{messages.establishment.deleteTitle}</h2><p>{messages.establishment.deleteBody}</p>{deleteError && <p className="field-error" role="alert">{deleteError}</p>}<div className="button-row"><button className="secondary-button" disabled={deleting} onClick={() => setConfirmDelete(false)}>{messages.common.cancel}</button><button className="danger-button" disabled={deleting} onClick={() => void confirmRemoval()}>{deleting ? messages.common.deleting : messages.common.delete}</button></div></div></div>}
  </>
}
