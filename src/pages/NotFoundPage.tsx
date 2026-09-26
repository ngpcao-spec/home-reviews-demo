import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
export function NotFoundPage(){const navigate=useNavigate();return <><PageHeader title="Page introuvable"/><div className="empty-state"><h2>Cette page n’existe pas</h2><p>Revenez au tableau de bord pour continuer.</p><button className="primary-button" onClick={()=>navigate('/')}>Retour à l’accueil</button></div></>}
