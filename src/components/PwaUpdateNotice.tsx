import {useEffect,useState} from 'react'
import {useI18n} from '../i18n'
import './PwaUpdateNotice.css'
export function PwaUpdateNotice({reload=()=>window.location.reload()}:{reload?:()=>void}){
  const {language}=useI18n(),[available,setAvailable]=useState(false)
  useEffect(()=>{
    if(!import.meta.env.PROD||!('serviceWorker' in navigator))return
    let stopped=false,registration:ServiceWorkerRegistration|undefined,lastCheck=0,inFlight=false
    const workerListeners:(()=>void)[]=[]
    const initialController=navigator.serviceWorker.controller,controlChanged=()=>{if(!stopped&&initialController&&navigator.serviceWorker.controller!==initialController)setAvailable(true)}
    navigator.serviceWorker.addEventListener('controllerchange',controlChanged)
    const watch=()=>{const worker=registration?.installing;if(!worker)return;const replacing=!!navigator.serviceWorker.controller;const changed=()=>{if(!stopped&&replacing&&worker.state==='activated')setAvailable(true)};worker.addEventListener('statechange',changed);workerListeners.push(()=>worker.removeEventListener('statechange',changed));changed()}
    const check=async()=>{if(!registration||document.hidden||!navigator.onLine||inFlight||Date.now()-lastCheck<60_000)return;inFlight=true;lastCheck=Date.now();try{await registration.update()}catch{/* Offline shell stays available. */}finally{inFlight=false}}
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`,{updateViaCache:'none'}).then(r=>{if(stopped)return;registration=r;r.addEventListener('updatefound',watch);watch();void check()}).catch(()=>{/* Keep the app usable when registration is unavailable. */})
    const resume=()=>void check(),timer=window.setInterval(resume,60_000)
    document.addEventListener('visibilitychange',resume);window.addEventListener('pageshow',resume);window.addEventListener('online',resume)
    return()=>{stopped=true;window.clearInterval(timer);registration?.removeEventListener('updatefound',watch);navigator.serviceWorker.removeEventListener('controllerchange',controlChanged);workerListeners.forEach(fn=>fn());document.removeEventListener('visibilitychange',resume);window.removeEventListener('pageshow',resume);window.removeEventListener('online',resume)}
  },[])
  if(!available)return null
  return <aside className="pwa-update-notice" role="status"><strong>{language==='fr'?'Nouvelle version disponible':'Có phiên bản mới'}</strong><p>{language==='fr'?'Enregistrez vos choix avant d’actualiser.':'Lưu các lựa chọn trước khi cập nhật.'}</p><button className="primary-button" onClick={reload}>{language==='fr'?'Actualiser l’application':'Cập nhật ứng dụng'}</button></aside>
}
