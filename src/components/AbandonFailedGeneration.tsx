import {useState} from 'react'
import {useI18n} from '../i18n'
import type {HistoricalRun} from '../lib/historical-generation'
export function AbandonFailedGeneration({run,abandon,onAbandoned}:{run:HistoricalRun|null;abandon:()=>Promise<boolean>;onAbandoned:()=>void}){
 const {language}=useI18n(),fr=language==='fr',[busy,setBusy]=useState(false),[failed,setFailed]=useState(false)
 if(run?.status!=='failed'||!run.request_id||!run.can_abandon)return null
 const cancel=async()=>{
  if(busy||!window.confirm(fr
   ?'Abandonner cette génération incomplète ? Les avis et les rapports terminés seront conservés. Vous pourrez ensuite recréer le rapport depuis zéro, avec de nouveaux frais IA. Les appels précédents peuvent déjà avoir été facturés.'
   :'Hủy lần tạo báo cáo chưa hoàn tất này? Các đánh giá gốc và báo cáo đã hoàn tất vẫn được giữ. Sau đó bạn có thể tạo lại từ đầu với chi phí AI mới. Các lần xử lý trước có thể đã được tính phí.'))return
  setBusy(true);setFailed(false)
  try{if(await abandon())onAbandoned();else setFailed(true)}catch{setFailed(true)}finally{setBusy(false)}
 }
 return <div><button className="secondary-button" type="button" disabled={busy} onClick={()=>void cancel()}>{busy?(fr?'Annulation…':'Đang hủy…'):(fr?'Annuler cette génération':'Hủy lần tạo báo cáo này')}</button>
  {failed&&<p role="alert">{fr?'Annulation non confirmée. La génération reste conservée.':'Chưa xác nhận được việc hủy. Lần tạo báo cáo vẫn được giữ.'}</p>}</div>
}
