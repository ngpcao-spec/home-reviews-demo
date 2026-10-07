import {useQuery} from '@tanstack/react-query'
import {useI18n} from '../i18n'
import {englishBackfillApi} from '../lib/english-backfill'
import {HistoricalV8Test} from './HistoricalV8Test'
/** Visible before historical Jev results. Reads preparation only, never starts it. */
export function HistoricalV8Entry({user,establishment,name,visible}:{user:string;establishment:string;name:string;visible:boolean}){
  const {language}=useI18n(),coverage=useQuery({queryKey:['english-preparation',user,establishment],queryFn:()=>englishBackfillApi(establishment),enabled:visible,retry:false,staleTime:0})
  return <div className="historical-v8-entry"><HistoricalV8Test user={user} establishment={establishment} name={name} coverage={coverage.data?.coverage} visible={visible}/>{coverage.isError&&<p className="jev-warning" role="alert">{language==='fr'?'Impossible de lire la couverture anglaise.':'Không thể đọc tỷ lệ bao phủ tiếng Anh.'}<button className="secondary-button" onClick={()=>void coverage.refetch()}>{language==='fr'?'Actualiser':'Làm mới'}</button></p>}<p className="jev-note">{language==='fr'?'Les résultats Jev V7 ci-dessous sont conservés en historique.':'Các kết quả Jev V7 bên dưới được giữ lại trong lịch sử.'}</p></div>
}
