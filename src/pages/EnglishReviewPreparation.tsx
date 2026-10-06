import {useState,useRef,useEffect} from 'react'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import {useI18n} from '../i18n'
import {englishBackfillApi,type EnglishStatus} from '../lib/english-backfill'
const wording={fr:{title:'Préparer les avis en anglais',start:'Récupérer les versions anglaises',text:'Avis avec texte',original:'Déjà en anglais',translated:'Traductions anglaises',missing:'Encore sans version anglaise',coverage:'Couverture',running:'Récupération des versions anglaises en cours…',continue:'Vous pouvez quitter l’application. Le traitement continue côté serveur.',loading:'Lecture de la couverture…',error:'Impossible de lire la préparation anglaise.',unknown:'Lancement non confirmé. Vérifiez le statut avant une nouvelle tentative.',check:'Vérifier le statut',complete:'Préparation terminée. Vérifiez la couverture avant de lancer volontairement un rapport V7.',note:'Cette action récupère les traductions Google/Apify. Elle ne génère aucun rapport ni réponse IA.',starting:'Démarrage…'},vi:{title:'Chuẩn bị đánh giá bằng tiếng Anh',start:'Lấy phiên bản tiếng Anh',text:'Đánh giá có nội dung',original:'Nội dung gốc bằng tiếng Anh',translated:'Bản dịch tiếng Anh',missing:'Chưa có phiên bản tiếng Anh',coverage:'Tỷ lệ bao phủ',running:'Đang lấy các phiên bản tiếng Anh…',continue:'Bạn có thể rời ứng dụng. Quá trình tiếp tục trên máy chủ.',loading:'Đang đọc tỷ lệ bao phủ…',error:'Không thể đọc quá trình chuẩn bị tiếng Anh.',unknown:'Chưa xác nhận khởi chạy. Kiểm tra trạng thái trước khi thử lại.',check:'Kiểm tra trạng thái',complete:'Đã chuẩn bị xong. Kiểm tra tỷ lệ bao phủ trước khi chủ động tạo báo cáo V7.',note:'Thao tác này lấy bản dịch Google/Apify, không tạo báo cáo hoặc phản hồi AI.',starting:'Đang khởi động…'}}
const locks=new Set<string>()
export function EnglishReviewPreparation({user,establishment,name,visible}:{user:string;establishment:string;name:string;visible:boolean}) {
  const {language}=useI18n(),t=wording[language],client=useQueryClient(),[starting,setStarting]=useState(false),[failed,setFailed]=useState(false),busy=useRef(false)
  const localKey=`english-backfill:${user}:${establishment}`,key=['english-preparation',user,establishment]
  const pending=()=>{try{return localStorage.getItem(localKey)==='pending'}catch{return false}}
  const query=useQuery<EnglishStatus>({queryKey:key,enabled:visible,retry:false,staleTime:0,queryFn:async()=>{
    const data=await englishBackfillApi(establishment)
    if(data.job){try{localStorage.setItem(localKey,data.job.id)}catch{/* Server remains authoritative. */}}
    return data
  },refetchInterval:q=>visible && (['queued','starting','running'].includes(q.state.data?.job?.status??'') || pending())?2500:false})
  useEffect(()=>{const resume=()=>{if(!document.hidden)void client.invalidateQueries({queryKey:['english-preparation',user,establishment]})};window.addEventListener('pageshow',resume);return()=>window.removeEventListener('pageshow',resume)},[user,establishment,client])
  const running=['queued','starting','running'].includes(query.data?.job?.status??''),uncertain=pending()
  async function start() {
    if(busy.current || locks.has(localKey) || running || uncertain || query.isPending || query.isError)return
    busy.current=true;locks.add(localKey);setStarting(true);setFailed(false)
    async function launch(){const current=await englishBackfillApi(establishment);if(['queued','starting','running'].includes(current.job?.status??'')){client.setQueryData(key,current);return}if(pending())return;localStorage.setItem(localKey,'pending');const result=await englishBackfillApi(establishment,'POST');localStorage.setItem(localKey,result.job?.id??'complete');client.setQueryData(key,result)}
    try{if(navigator.locks)await navigator.locks.request(localKey,launch);else await launch()}
    catch(error){if(error instanceof Error && ['APIFY_TOKEN_MISSING','UNAUTHORIZED','FORBIDDEN','ESTABLISHMENT_NOT_FOUND','ESTABLISHMENT_ID_REQUIRED'].includes(error.message))localStorage.removeItem(localKey);setFailed(true);await query.refetch()}
    finally{busy.current=false;locks.delete(localKey);setStarting(false)}
  }
  return <section className="card jev-card english-preparation"><h3>{t.title}</h3><strong>{name}</strong>{query.isPending?<p role="status">{t.loading}</p>:<>
    {query.data&&<dl className="jev-pairs"><dt>{t.text}</dt><dd>{query.data.coverage.reviews_with_text}</dd><dt>{t.original}</dt><dd>{query.data.coverage.original_english}</dd><dt>{t.translated}</dt><dd>{query.data.coverage.english_translation_found}</dd><dt>{t.missing}</dt><dd>{query.data.coverage.english_translation_missing}</dd><dt>{t.coverage}</dt><dd>{query.data.coverage.coverage_percent.toLocaleString(language==='fr'?'fr-FR':'vi-VN',{maximumFractionDigits:1})} %</dd></dl>}
    {(query.isError || failed || uncertain)&&<div role="alert"><p>{uncertain?t.unknown:t.error}</p><button className="secondary-button" onClick={()=>void query.refetch()} disabled={query.isFetching}>{t.check}</button></div>}
    {running?<div role="status"><p>{t.running}</p><p>{t.continue}</p></div>:query.data?.job?.status==='completed'?<p>{t.complete}</p>:null}
    {query.data?.job?.error_code&&<small className="jev-warning">{query.data.job.error_code}</small>}
    <button className="primary-button full-width jev-launch" onClick={()=>void start()} disabled={starting || running || uncertain || query.isError || query.isPending || !visible || query.data?.coverage.english_translation_missing===0}>{starting?t.starting:t.start}</button>
  </>}<p className="jev-note">{t.note}</p></section>
}
