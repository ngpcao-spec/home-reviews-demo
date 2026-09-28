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

export function EstablishmentDetailPage() {
  const { id } = useParams(); const navigate = useNavigate()
  const { establishments, reviews, removeEstablishment } = useApp()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const establishment = establishments.find((item) => item.id === id)
  if (!establishment) return <><PageHeader title="Établissement" back/><div className="empty-state"><h2>Établissement introuvable</h2><button className="secondary-button" onClick={() => navigate('/etablissements')}>Retour à la liste</button></div></>
  const related = recentNegativeReviews(reviews.filter((item) => item.establishmentId === id))
  const confirmRemoval = async () => {
    setDeleting(true)
    setDeleteError('')
    try {
      await removeEstablishment(establishment.id)
      navigate('/etablissements')
    } catch {
      setDeleteError('Impossible de supprimer cet établissement. Réessayez dans quelques instants.')
      setDeleting(false)
    }
  }
  return <><PageHeader title={establishment.name} back />
    <section className="est-detail-hero card"><EstablishmentAvatar id={establishment.id} name={establishment.name} photoUrl={establishment.photoUrl} large/><div><h2>{establishment.name}</h2><div className="rating-line"><strong>{establishment.currentRating.toFixed(1)}</strong><Stars rating={Math.round(establishment.currentRating)}/><span>{establishment.currentReviewCount} avis</span></div><p><MapPin size={15}/>{establishment.address}, {establishment.city}</p></div></section>
    <section className="sync-panel card"><div><span>Surveillance active</span><SyncBadge status={establishment.syncStatus}/></div><p>Dernier contrôle<br/><strong>{fullDate(establishment.lastSyncedAt)}</strong></p><p>Prochain contrôle<br/><strong>{establishment.nextSyncAt ? timeUntil(establishment.nextSyncAt) : 'Non planifié'}</strong></p><div className="button-row"><a className="secondary-button full-width" href={establishment.googleMapsUrl} target="_blank" rel="noreferrer"><ExternalLink size={17}/>Google Maps</a></div></section>
    <div className="section-heading"><h2>Avis négatifs récents</h2><button className="text-button" onClick={() => navigate(`/avis?etablissement=${id}&statut=all`)}>Voir tout</button></div>
    {related.map((review) => <ReviewRow key={review.id} review={review}/>)}
    <button className="danger-button full-width" onClick={() => setConfirmDelete(true)}><Trash2 size={17}/>Supprimer de HOME Reviews</button>
    {confirmDelete && <div className="modal-backdrop" role="presentation"><div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">Supprimer cet établissement ?</h2><p>Les avis, analyses et notifications associés seront supprimés. Cette action est irréversible.</p>{deleteError && <p className="field-error" role="alert">{deleteError}</p>}<div className="button-row"><button className="secondary-button" disabled={deleting} onClick={() => setConfirmDelete(false)}>Annuler</button><button className="danger-button" disabled={deleting} onClick={() => void confirmRemoval()}>{deleting ? 'Suppression…' : 'Supprimer'}</button></div></div></div>}
  </>
}
