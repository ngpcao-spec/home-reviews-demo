import {useI18n} from '../i18n'
import './RestaurantDishes.css'
export function DishSearchInput({query,setQuery,loading,error,retry,count}:{query:string;setQuery:(q:string)=>void;loading:boolean;error:boolean;retry:()=>void;count:number}){
 const {language}=useI18n(),vi=language==='vi'
 return <section className="dish-search"><label>{vi?'Tìm nhà hàng theo món':'Rechercher les restaurants par plat'}<input type="search" maxLength={100} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Phở, Phở gà, Bánh căn…"/></label>
  <small>{vi?'Theo thực đơn đã lưu. Đề xuất cần xác nhận; không đảm bảo hiện còn bán.':'D’après les menus enregistrés. Propositions à confirmer ; disponibilité actuelle non garantie.'}</small>
  {query.trim()&&(loading?<p role="status">{vi?'Đang tìm…':'Recherche…'}</p>:error?<p role="alert">{vi?'Không thể tìm món.':'Recherche indisponible.'} <button className="text-button" onClick={retry}>{vi?'Thử lại':'Réessayer'}</button></p>:<p role="status">{count?`${count} ${vi?'nhà hàng':'restaurant(s)'}`:(vi?'Chưa có nhà hàng tương ứng được ghi nhận.':'Aucun restaurant associé à ce plat dans les données disponibles.')}</p>)}
 </section>
}
