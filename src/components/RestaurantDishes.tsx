import {useEffect,useRef,useState} from 'react'
import {useI18n} from '../i18n'
import {dishRpc,readDishes,type DishName,type DishProfile} from '../lib/restaurant-dishes'
import './RestaurantDishes.css'

export function RestaurantDishes({establishmentId}:{establishmentId:string}){
 const {language}=useI18n(),vi=language==='vi'
 const [loaded,setLoaded]=useState<{scope:string;profile:DishProfile}>(),[names,setNames]=useState<DishName[]>([])
 const [open,setOpen]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0)
 const [selected,setSelected]=useState(''),[newName,setNewName]=useState(''),[parent,setParent]=useState('')
 const lock=useRef(false),epoch=useRef({value:0}).current,profile=loaded?.scope===establishmentId?loaded.profile:undefined
 useEffect(()=>{
  let gone=false;epoch.value++;setBusy(false);setOpen(false);setError('');setSelected('');setNewName('');setParent('')
  void readDishes(establishmentId).then(profile=>{if(!gone)setLoaded({scope:establishmentId,profile})}).catch(()=>{if(!gone)setError('read')})
  return()=>{gone=true;epoch.value++}
 },[establishmentId,retry,epoch])
 const status=(s:string)=>s==='confirmed'?(vi?'Đã xác nhận':'Confirmée'):(vi?'Đề xuất':'Proposée')
 async function edit(){
  setOpen(!open)
  if(!open)try{setNames(await dishRpc<DishName[]>('list_dish_names'))}catch{setError('read')}
 }
 async function save(action:'specialty'|'add'|'confirm'|'remove',id:string|null,create=false){
  if(!profile?.canEdit||lock.current)return
  lock.current=true;setBusy(true);setError('');const version=epoch.value
  try{
   const updated=await dishRpc<DishProfile>('edit_restaurant_dishes',{p_establishment:establishmentId,p_revision:profile.revision,p_action:action,p_dish:id,
    ...(create?{p_name:newName.trim(),p_parent:parent||null}:{})})
   if(version===epoch.value){setLoaded({scope:establishmentId,profile:updated});setNewName('');setSelected('')}
  }catch(e){if(version===epoch.value)setError(e instanceof Error&&e.message==='DISH_CONFLICT'?'conflict':'save')}
  finally{lock.current=false;if(version===epoch.value)setBusy(false)}
 }
 const safePhoto=(url?:string)=>url&&/^https:\/\/(?:[^/]+\.)?(?:googleusercontent\.com|google\.com)\//.test(url)?url:undefined
 return <section className="restaurant-dishes" aria-label={vi?'Đặc sản và món ăn':'Spécialité et plats'}>
  {profile?.specialty&&<p className="dish-specialty"><strong>{vi?'Đặc sản':'Spécialité'} : {profile.specialty.name}</strong><small>{status(profile.specialty.status)}</small></p>}
  {profile&&<details className="dish-details"><summary>{vi?'Món ăn và biến thể':'Plats et variantes'} ({profile.associations.length})</summary>
   <p className="dish-hint">{vi?'Theo thực đơn đã lưu. Không đảm bảo hiện còn bán.':'D’après les menus enregistrés. La disponibilité actuelle n’est pas garantie.'}</p>
   {profile.associations.length===0&&<p>{vi?'Chưa xác định được món ăn.':'Aucun plat identifié avec suffisamment de précision.'}</p>}
   <ul>{profile.associations.map(a=><li key={a.id}><strong>{a.name}</strong><small>{status(a.status)} · {a.origin==='manual'?(vi?'Thủ công':'Manuelle'):(vi?'Tự động':'Automatique')}</small>
    {a.parentName&&<small>{vi?'Biến thể của':'Variante de'} {a.parentName}</small>}
    <details><summary>{vi?'Nguồn và căn cứ':'Sources et justificatifs'} ({a.evidence.length})</summary>{a.evidence.map((e,i)=><div className="dish-evidence" key={i}>
     <p>{e.name}{e.section&&<> · {e.section}</>}</p>
     <small>{e.reason==='manual_confirmation'?(vi?'Xác nhận thủ công':'Confirmation manuelle'):e.reason==='explicit_menu_context'?(vi?'Diễn giải theo mục thực đơn':'Interprétation selon la rubrique du menu'):(vi?'Tên món ghi rõ trên thực đơn':'Nom explicite dans le menu')}</small>
     {e.collectedAt&&<small>{new Date(e.collectedAt).toLocaleDateString(vi?'vi-VN':'fr-FR')}</small>}
     {safePhoto(e.photo)&&<a href={safePhoto(e.photo)} target="_blank" rel="noreferrer">{vi?'Ảnh nguồn':'Photo source'}</a>}
     {e.runId&&<small>{vi?'Lượt':'Run'} {e.runId} · {vi?'Dòng':'Ligne'} {e.sourceRow}</small>}
    </div>)}</details>
   </li>)}</ul>
   {profile.unresolved.length>0&&<details><summary>{vi?'Cần xem xét':'À examiner'} ({profile.unresolved.length})</summary><ul>{profile.unresolved.map((x,i)=><li key={i}>{x.name} · {x.section}</li>)}</ul></details>}
  </details>}
  {profile?.canEdit&&<button type="button" className="text-button" onClick={()=>void edit()} aria-expanded={open}>{vi?'Xác nhận hoặc sửa món ăn':'Confirmer ou corriger les plats'}</button>}
  {open&&profile?.canEdit&&<div className="dish-editor">
   {profile.shared&&<p>{vi?'Thông tin chung cho các tài khoản đang theo dõi nhà hàng này.':'Ces associations sont communes aux comptes abonnés à ce restaurant.'}</p>}
   <label>{vi?'Chọn món có sẵn':'Choisir un plat existant'}<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">—</option>{names.map(n=><option value={n.id} key={n.id}>{n.name}</option>)}</select></label>
   <div className="dish-actions"><button className="secondary-button" disabled={busy||!selected} onClick={()=>void save('specialty',selected)}>{vi?'Đặt làm đặc sản':'Définir comme spécialité'}</button><button className="secondary-button" disabled={busy||!selected} onClick={()=>void save('add',selected)}>{vi?'Thêm món':'Ajouter ce plat'}</button></div>
   <details><summary>{vi?'Thêm tên còn thiếu':'Ajouter un nom manquant'}</summary>
    <label>{vi?'Tên món chính xác':'Nom précis du plat'}<input value={newName} maxLength={100} onChange={e=>setNewName(e.target.value)}/></label>
    <label>{vi?'Biến thể của (không bắt buộc)':'Variante de (facultatif)'}<select value={parent} onChange={e=>setParent(e.target.value)}><option value="">—</option>{names.filter(n=>!n.parentId).map(n=><option value={n.id} key={n.id}>{n.name}</option>)}</select></label>
    <button className="secondary-button" disabled={busy||!newName.trim()} onClick={()=>void save('add',null,true)}>{vi?'Thêm và xác nhận':'Ajouter et confirmer'}</button>
   </details>
   {profile.specialty&&<div className="dish-actions"><button className="secondary-button" disabled={busy} onClick={()=>void save('specialty',profile.specialty!.id)}>{vi?'Xác nhận đặc sản':'Confirmer la spécialité'}</button><button className="text-button" disabled={busy} onClick={()=>void save('specialty',null)}>{vi?'Không có đặc sản chính':'Aucune spécialité principale'}</button></div>}
   <ul>{profile.associations.map(a=><li key={a.id}><strong>{a.name}</strong><small>{status(a.status)} · {a.origin==='manual'?(vi?'Thủ công':'Manuelle'):(vi?'Tự động':'Automatique')}</small>{a.parentName&&<small>{vi?'Biến thể của':'Variante de'} {a.parentName}</small>}<div className="dish-actions">{a.status==='proposed'&&<button className="text-button" disabled={busy} onClick={()=>void save('confirm',a.id)}>{vi?'Xác nhận':'Confirmer'}</button>}<button className="text-button" disabled={busy} onClick={()=>void save('remove',a.id)}>{vi?'Bỏ liên kết':'Retirer l’association'}</button><button className="text-button" disabled={busy} onClick={()=>void save('specialty',a.id)}>{vi?'Đặt làm đặc sản':'Définir comme spécialité'}</button></div></li>)}</ul>
  </div>}
  {error&&<div role="alert"><p>{error==='conflict'?(vi?'Thông tin đã thay đổi. Tải lại trước khi sửa.':'Ces associations ont changé. Rechargez-les avant de corriger.'):(vi?'Không thể tải hoặc lưu các món.':'Impossible de charger ou d’enregistrer les plats.')}</p><button className="text-button" onClick={()=>setRetry(x=>x+1)}>{vi?'Tải lại':'Recharger'}</button></div>}
 </section>
}
