import {useEffect,useRef,useState} from 'react'
import {useI18n} from '../i18n'
import {dishRpc,readDishes,type DishName,type DishProfile} from '../lib/restaurant-dishes'
import './RestaurantDishes.css'

const reasons:Record<string,[string,string]> = {
 unclear_label:['Libellé indéterminé','Tên món chưa rõ'],
 unclear_serving:['Plat ou supplément à distinguer','Chưa rõ là món hay phần thêm'],
 conflicting_context:['Informations contradictoires','Thông tin mâu thuẫn'],
 insufficient_evidence:['Contexte insuffisant','Thiếu căn cứ'],
}
const menuProfileLabels={
 specialized:['Spécialisée','Chuyên một món'],
 varied:['Variée','Đa dạng'],
 unknown:['Indéterminée','Chưa xác định'],
}
const restaurantTypeLabels={
 street_food:['Restauration de rue','Ẩm thực đường phố'],
 family_dining:['Familial','Quán ăn gia đình'],
 unknown:['Indéterminé','Chưa xác định'],
}

export function RestaurantDishes({establishmentId,menuVersion}:{establishmentId:string;menuVersion?:string}){
 const {language}=useI18n(),vi=language==='vi'
 const [loaded,setLoaded]=useState<{scope:string;profile:DishProfile}>(),[names,setNames]=useState<DishName[]>([])
 const [open,setOpen]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0)
 const [selected,setSelected]=useState(''),[newName,setNewName]=useState(''),[parent,setParent]=useState('')
 const lock=useRef(false),epoch=useRef({value:0}).current,profile=loaded?.scope===establishmentId?loaded.profile:undefined
 useEffect(()=>{
  epoch.value++;setBusy(false);setOpen(false);setError('');setSelected('');setNewName('');setParent('')
  return()=>{epoch.value++}
 },[establishmentId,retry,epoch])
 useEffect(()=>{
  let gone=false
  let timer:number|undefined
  async function refresh() {
   try {
    const profile=await readDishes(establishmentId)
    if(gone)return
    setLoaded(current=>current?.scope===establishmentId&&current.profile.revision>profile.revision
     ?current:{scope:establishmentId,profile})
    setError(current=>current==='read'?'':current)
    if(profile.classification?.state==='queued'||profile.classification?.state==='running')
     timer=window.setTimeout(()=>void refresh(),5000)
   } catch { if(!gone)setError(current=>current||'read') }
  }
  void refresh()
  return()=>{gone=true;window.clearTimeout(timer)}
 },[establishmentId,menuVersion,retry])
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
   if(version===epoch.value){
    setLoaded(current=>current?.scope===establishmentId&&current.profile.revision>updated.revision
     ?current:{scope:establishmentId,profile:updated})
    setNewName('');setSelected('')
   }
  }catch(e){if(version===epoch.value)setError(e instanceof Error&&e.message==='DISH_CONFLICT'?'conflict':'save')}
  finally{lock.current=false;if(version===epoch.value)setBusy(false)}
 }
 const safePhoto=(url?:string)=>url&&/^https:\/\/(?:[^/]+\.)?(?:googleusercontent\.com|google\.com)\//.test(url)?url:undefined
 const classification=profile?.classification
 const awaiting=classification?.state==='queued'||classification?.state==='running'
 const other=profile?.unresolved.filter(row=>row.reason==='other')??[]
 const toReview=profile?.unresolved.filter(row=>row.reason!=='other')??[]
 return <section className="restaurant-dishes" aria-label={vi?'Đặc sản và món ăn':'Spécialité et plats'}>
  {profile?.specialty&&<p className="dish-specialty"><strong>{vi?'Đặc sản':'Spécialité'} : {profile.specialty.name}</strong><small>{status(profile.specialty.status)}</small></p>}
  {!profile?.specialty&&classification?.specialtyNeedsConfirmation&&<p className="dish-hint">{vi?'Đặc sản cần xác nhận':'Spécialité à confirmer'}</p>}
  {(profile?.menuProfile||profile?.restaurantType)&&<dl className="dish-facets">
   {profile.menuProfile&&<div><dt>{vi?'Thực đơn':'Carte'}</dt><dd>{menuProfileLabels[profile.menuProfile]?.[vi?1:0]}</dd></div>}
   {profile.restaurantType&&<div><dt>{vi?'Loại hình':'Type'}</dt><dd>{restaurantTypeLabels[profile.restaurantType]?.[vi?1:0]}</dd></div>}
  </dl>}
  {awaiting&&<p role="status">{vi?'Đang phân loại thực đơn mới…':'Classement du nouveau menu en cours…'}</p>}
  {classification?.state==='failed'&&<p role="status">{vi?'Chưa phân loại được thực đơn mới.':'Le classement du nouveau menu a échoué.'}</p>}
  {classification?.stale&&<p className="dish-hint">{vi?'Các món dưới đây dựa trên thực đơn trước.':'Les plats affichés proviennent du menu précédent.'}</p>}
  {profile&&<details className="dish-details"><summary>{vi?'Món ăn và biến thể':'Plats et variantes'} ({profile.associations.length})</summary>
   <p className="dish-hint">{vi?'Theo thực đơn đã lưu. Không đảm bảo hiện còn bán.':'D’après les menus enregistrés. La disponibilité actuelle n’est pas garantie.'}</p>
   {profile.associations.length===0&&<p>{vi?'Chưa xác định được món ăn.':'Aucun plat identifié avec suffisamment de précision.'}</p>}
   <ul>{profile.associations.map(a=><li key={a.id}><strong>{a.name}</strong><small>{status(a.status)} · {a.origin==='manual'?(vi?'Thủ công':'Manuelle'):(vi?'Tự động':'Automatique')}</small>
    {a.parentName&&<small>{vi?'Biến thể của':'Variante de'} {a.parentName}</small>}
    <details><summary>{vi?'Nguồn và căn cứ':'Sources et justificatifs'} ({a.evidence.length})</summary>{a.evidence.map((e,i)=><div className="dish-evidence" key={i}>
     <p>{e.name}{e.section&&<> · {e.section}</>}</p>
     <small>{e.reason==='manual_confirmation'?(vi?'Xác nhận thủ công':'Confirmation manuelle'):e.reason==='ai_menu_classification'?(vi?'AI phân loại theo thực đơn':'Classement IA d’après le menu'):e.reason==='explicit_menu_context'?(vi?'Diễn giải theo mục thực đơn':'Interprétation selon la rubrique du menu'):(vi?'Tên món ghi rõ trên thực đơn':'Nom explicite dans le menu')}</small>
     {e.collectedAt&&<small>{new Date(e.collectedAt).toLocaleDateString(vi?'vi-VN':'fr-FR')}</small>}
     {safePhoto(e.photo)&&<a href={safePhoto(e.photo)} target="_blank" rel="noreferrer">{vi?'Ảnh nguồn':'Photo source'}</a>}
     {e.runId&&<small>{vi?'Lượt':'Run'} {e.runId} · {vi?'Dòng':'Ligne'} {e.sourceRow}</small>}
    </div>)}</details>
   </li>)}</ul>
   {other.length>0&&<details><summary>{vi?'Khác':'Autres'} ({other.length})</summary><ul>{other.map(x=><li key={x.sourceRow}>{x.name||(vi?'Không có tên':'Sans nom')}{x.section&&' · '+x.section}</li>)}</ul></details>}
   {toReview.length>0&&<details><summary>{vi?'Cần xem xét':'À examiner'} ({toReview.length})</summary><ul>{toReview.map(x=><li key={x.sourceRow}>{x.name}{x.section&&' · '+x.section}{reasons[x.reason]&&<small>{reasons[x.reason][vi?1:0]}</small>}</li>)}</ul></details>}
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
