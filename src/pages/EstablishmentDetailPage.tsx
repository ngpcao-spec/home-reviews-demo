import { ExternalLink, MapPin, RefreshCw, Trash2 } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { useApp } from '../app/AppContext'
import { ReviewRow } from '../components/reviews/ReviewRow'
import { EstablishmentAvatar } from '../components/ui/EstablishmentAvatar'
import { PageHeader } from '../components/ui/PageHeader'
import { Stars } from '../components/ui/Stars'
import { SyncBadge } from '../components/ui/StatusBadge'
import { fullDate } from '../lib/format'

export function EstablishmentDetailPage() {
  const { id } = useParams(); const navigate = useNavigate()
  const { establishments, reviews, refreshEstablishment, toggleMonitoring, removeEstablishment } = useApp()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const establishment = establishments.find((item) => item.id === id)
  if (!establishment) return <><PageHeader title="Établissement" back/><div className="empty-state"><h2>Établissement introuvable</h2><button className="secondary-button" onClick={() => navigate('/etablissements')}>Retour à la liste</button></div></>
  const related = reviews.filter((item) => item.establishmentId === id)
  return <><PageHeader title={establishment.name} back />
    <section className="est-detail-hero card"><EstablishmentAvatar id={establishment.id} name={establishment.name} large/><div><h2>{establishment.name}</h2><div className="rating-line"><strong>{establishment.currentRating.toFixed(1)}</strong><Stars rating={Math.round(establishment.currentRating)}/><span>{establishment.currentReviewCount} avis</span></div><p><MapPin size={15}/>{establishment.address}, {establishment.city}</p></div></section>
    <section className="sync-panel card"><div><span>État de la surveillance</span><SyncBadge status={establishment.syncStatus}/></div><p>Dernière synchronisation<br/><strong>{fullDate(establishment.lastSyncedAt)}</strong></p><div className="button-row"><button className="primary-button" onClick={() => refreshEstablishment(establishment.id)} disabled={establishment.syncStatus === 'syncing'}><RefreshCw size={17} className={establishment.syncStatus === 'syncing' ? 'spin' : ''}/>Actualiser</button><a className="secondary-button" href={establishment.googleMapsUrl} target="_blank" rel="noreferrer"><ExternalLink size={17}/>Google Maps</a></div></section>
    <div className="setting-row card"><div><strong>Surveillance active</strong><span>Synchronisation toutes les 60 minutes</span></div><button role="switch" aria-checked={establishment.syncEnabled} className={`switch ${establishment.syncEnabled ? 'on' : ''}`} onClick={() => toggleMonitoring(establishment.id)}><span/></button></div>
    <div className="section-heading"><h2>Avis récents</h2><button className="text-button" onClick={() => navigate(`/avis?etablissement=${id}`)}>Voir tout</button></div>
    {related.slice(0, 3).map((review) => <ReviewRow key={review.id} review={review}/>)}
    <button className="danger-button full-width" onClick={() => setConfirmDelete(true)}><Trash2 size={17}/>Supprimer de HOME Reviews</button>
    {confirmDelete && <div className="modal-backdrop" role="presentation"><div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">Supprimer cet établissement ?</h2><p>Les avis, analyses et notifications associés seront supprimés. Cette action est irréversible.</p><div className="button-row"><button className="secondary-button" onClick={() => setConfirmDelete(false)}>Annuler</button><button className="danger-button" onClick={() => { removeEstablishment(establishment.id); navigate('/etablissements') }}>Supprimer</button></div></div></div>}
  </>
}
