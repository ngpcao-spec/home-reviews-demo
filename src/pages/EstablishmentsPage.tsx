import { ChevronRight, MapPin, Star } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../app/AppContext'
import { EstablishmentAvatar } from '../components/ui/EstablishmentAvatar'
import { BrandHeader } from '../components/ui/BrandHeader'
import { compactNumber } from '../lib/format'
import { isNegativeReview } from '../lib/review-list'
import { useI18n } from '../i18n'
import { DishSearchInput } from '../components/DishSearch'
import { useDishSearch } from '../lib/use-dish-search'

export function EstablishmentsPage() {
  const navigate = useNavigate()
  const { establishments, reviews, currentUser } = useApp()
  const { messages, language } = useI18n()
  const [params,setParams]=useSearchParams(),query=params.get('plat')??''
  const search=useDishSearch(query,currentUser.id??'')
  const matches=new Map(search.matches.map(m=>[m.establishmentId,m]))
  const visible=query.trim()?search.matches.flatMap(m=>establishments.filter(e=>e.id===m.establishmentId)):establishments
  return <>
    <BrandHeader title={<span className="establishments-title">{messages.establishment.mine}</span>} addAction={() => navigate('/etablissements/ajouter')} />
    <DishSearchInput query={query} setQuery={value=>setParams(previous=>{const next=new URLSearchParams(previous);if(value)next.set('plat',value);else next.delete('plat');return next},{replace:true})} {...search} count={visible.length}/>
    <div className="establishment-list">{visible.map((item) => {
      const pending = reviews.filter((review) => review.establishmentId === item.id && isNegativeReview(review)).length
      return <Link to={`/etablissements/${item.id}`} className="establishment-card card" key={item.id}>
        <EstablishmentAvatar id={item.id} name={item.name} large photoUrl={item.photoUrl} />
        <div className="est-info"><h2>{item.name}</h2><div className="rating-line"><Star fill="currentColor"/><strong>{item.currentRating.toFixed(1)}</strong><span>({compactNumber(item.currentReviewCount)} avis)</span></div><p>{item.category}</p><small><MapPin/> {item.city}</small>{matches.has(item.id)&&<span className="dish-match">{matches.get(item.id)!.kind==='specialty'?(language==='vi'?'Đặc sản':'Spécialité'):(language==='vi'?'Có trong thực đơn':'Présent au menu')} · {matches.get(item.id)!.dish} · {matches.get(item.id)!.status==='confirmed'?(language==='vi'?'Đã xác nhận':'Confirmé'):(language==='vi'?'Đề xuất':'Proposé')}{matches.get(item.id)!.stale&&(language==='vi'?' · Thực đơn trước':' · Menu précédent')}</span>}</div>

        <div className={`pending-count ${pending ? 'has-pending' : ''}`} aria-label={`${pending} ${messages.home.toProcess}`}>{pending}</div><ChevronRight className="est-chevron" />
      </Link>
    })}</div>
  </>
}
