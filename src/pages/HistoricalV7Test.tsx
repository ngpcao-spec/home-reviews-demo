import {useEffect,useRef,useState} from 'react'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import {useI18n} from '../i18n'
import {historicalV7Api,type V7Status} from '../lib/historical-v7'
import type {EnglishCoverage} from '../lib/english-backfill'

const words={fr:{title:'Rapport V7 — Analyse en anglais',start:'Lancer le rapport V7',running:'Rapport V7 en cours',continue:'Les avis sont analysés en anglais. Vous pouvez quitter l’application et revenir plus tard.',completed:'Rapport V7 terminé',coverage:'Une couverture anglaise de 100 % est nécessaire pour ce premier test.',loading:'Lecture du statut V7…',starting:'Démarrage…',error:'Impossible de confirmer le statut. Vérifiez avant une nouvelle tentative.',check:'Vérifier le statut',retry:'Réessayer le rapport V7',failed:'Le rapport V7 a échoué.',compare:'Comparaison V6 / V7',different:'Les datasets diffèrent. Les sentiments et findings sont comparés uniquement sur les avis communs.',same:'Même dataset. Comparaison des avis communs.',reviews:'Avis',text:'Avec texte',english:'Couverture anglaise',model:'Modèle',cost:'Coût estimé USD',time:'Durée de bout en bout',tokens:'Tokens entrée / sortie / total',agreement:'Accord V6/V7',differences:'Différences',missing:'Classifications manquantes',common:'Communs',only6:'V6 uniquement',only7:'V7 uniquement',service:'Service',quality:'Qualité',price:'Prix',atmosphere:'Ambiance',friendly_staff:'Amabilité',attentiveness:'Attention au client',professionalism:'Professionnalisme',wait_time:'Attente',note:'Estimation au tarif configuré. Ces différences ne constituent pas un verdict sur la qualité. Aucun benchmark Jev ne sera lancé.',baseline:'Aucun run V6 terminé disponible pour la comparaison.',uncertain:'Lancement non confirmé. Le bouton reste bloqué jusqu’à récupération du run.'},vi:{title:'Báo cáo V7 — Phân tích bằng tiếng Anh',start:'Tạo báo cáo V7',running:'Báo cáo V7 đang được tạo',continue:'Các đánh giá đang được phân tích bằng tiếng Anh. Bạn có thể rời ứng dụng và quay lại sau.',completed:'Báo cáo V7 đã hoàn thành',coverage:'Cần tỷ lệ bao phủ tiếng Anh 100 % cho lần thử đầu tiên.',loading:'Đang đọc trạng thái V7…',starting:'Đang khởi động…',error:'Không thể xác nhận trạng thái. Hãy kiểm tra trước khi thử lại.',check:'Kiểm tra trạng thái',retry:'Thử lại báo cáo V7',failed:'Báo cáo V7 không thành công.',compare:'So sánh V6 / V7',different:'Dữ liệu khác nhau. Cảm xúc và findings chỉ được so sánh trên các đánh giá chung.',same:'Cùng tập dữ liệu. So sánh các đánh giá chung.',reviews:'Đánh giá',text:'Có nội dung',english:'Tỷ lệ tiếng Anh',model:'Mô hình',cost:'Chi phí ước tính USD',time:'Thời gian toàn quy trình',tokens:'Tokens đầu vào / đầu ra / tổng',agreement:'Đồng thuận V6/V7',differences:'Khác biệt',missing:'Phân loại còn thiếu',common:'Chung',only6:'Chỉ V6',only7:'Chỉ V7',service:'Dịch vụ',quality:'Chất lượng',price:'Giá',atmosphere:'Không gian',friendly_staff:'Sự thân thiện',attentiveness:'Sự quan tâm',professionalism:'Tính chuyên nghiệp',wait_time:'Thời gian chờ',note:'Ước tính theo mức giá cấu hình. Các khác biệt không phải kết luận về chất lượng. Không tự động chạy benchmark Jev.',baseline:'Chưa có báo cáo V6 hoàn thành để so sánh.',uncertain:'Chưa xác nhận khởi chạy. Nút bị khóa cho đến khi tìm được báo cáo.'}}
const active=(data:V7Status|undefined)=>['queued','running','retry'].includes(data?.run?.status??'')
const locks=new Set<string>()
export function HistoricalV7Test({user,establishment,name,coverage,visible}:{user:string;establishment:string;name:string;coverage?:EnglishCoverage;visible:boolean}) {
  const {language}=useI18n(),t=words[language],client=useQueryClient(),busy=useRef(false),[starting,setStarting]=useState(false),[error,setError]=useState('')
  const storageKey=`historical-v7:${user}:${establishment}:${language}`,key=['historical-v7',user,establishment,language]
  const stored=()=>{try{return localStorage.getItem(storageKey)}catch{return null}}
  const save=(value:string)=>{try{localStorage.setItem(storageKey,value)}catch{/* Server is authoritative. */}}
  const query=useQuery<V7Status>({queryKey:key,enabled:visible,retry:false,staleTime:0,queryFn:async()=>{
    const generation=stored(),data=await historicalV7Api(establishment,language,false,generation&&generation!=='pending'?generation:undefined)
    if(data.run)save(data.run.generation_id)
    return data
  },refetchInterval:q=>visible&&!document.hidden&&(active(q.state.data)||stored()==='pending')?2500:false})
  useEffect(()=>{const resume=()=>{if(!document.hidden&&visible)void client.invalidateQueries({queryKey:['historical-v7',user,establishment,language]})};window.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',resume);return()=>{window.removeEventListener('pageshow',resume);document.removeEventListener('visibilitychange',resume)}},[client,user,establishment,language,visible])
  async function start() {
    if(busy.current||locks.has(storageKey)||active(query.data)||stored()==='pending'||coverage?.coverage_percent!==100||query.isPending||query.isError||query.data?.run?.status==='completed')return
    busy.current=true;locks.add(storageKey);setStarting(true);setError('')
    const launch=async()=>{
      const current=await historicalV7Api(establishment,language)
      if(current.run&&current.run.status!=='failed'){save(current.run.generation_id);client.setQueryData(key,current);return}
      if(stored()==='pending')return
      save('pending')
      const result=await historicalV7Api(establishment,language,true)
      if(!result.run)throw new Error('REPORT_LAUNCH_UNCONFIRMED')
      save(result.run.generation_id)
      await query.refetch()
    }
    try{if(navigator.locks)await navigator.locks.request(storageKey,launch);else await launch()}
    catch(e){const code=e instanceof Error?e.message:'REPORT_LAUNCH_UNCONFIRMED';if(['ENGLISH_COVERAGE_REQUIRED','REPORT_OTHER_VERSION_RUNNING','REPORT_LANGUAGE_CHANGED','UNAUTHORIZED','FORBIDDEN'].includes(code)){try{localStorage.removeItem(storageKey)}catch{/* Storage optional. */}}setError(code);await query.refetch()}
    finally{busy.current=false;locks.delete(storageKey);setStarting(false)}
  }
  const run=query.data?.run,summary=run?.summary,comparison=query.data?.comparison,uncertain=stored()==='pending'
  const number=(n:number|null|undefined,digits=1)=>n==null?'—':n.toLocaleString(language==='fr'?'fr-FR':'vi-VN',{maximumFractionDigits:digits})
  const metrics=(value:{v6:number;v7:number;common:number;v6_only:number;v7_only:number})=><dl className="jev-pairs"><dt>V6</dt><dd>{value.v6}</dd><dt>V7</dt><dd>{value.v7}</dd><dt>{t.common}</dt><dd>{value.common}</dd><dt>{t.only6}</dt><dd>{value.v6_only}</dd><dt>{t.only7}</dt><dd>{value.v7_only}</dd></dl>
  return <section className="card jev-card historical-v7-test"><h3>{t.title}</h3><strong>{name}</strong>
    {query.isPending&&<p role="status">{t.loading}</p>}
    {(query.isError||error||uncertain)&&<div role="alert"><p>{uncertain?t.uncertain:t.error}</p>{error&&<small>{error}</small>}<button className="secondary-button" onClick={()=>void query.refetch()} disabled={query.isFetching}>{t.check}</button></div>}
    {active(query.data)&&<div role="status"><h4>{t.running}</h4><p>{t.continue}</p><small>{run?.progress} / {run?.total_steps}</small></div>}
    {run?.status==='failed'&&<p role="alert">{t.failed} <small>{run.error_code}</small></p>}
    {run?.status!=='completed'&&!active(query.data)&&<><p className="jev-note">{t.coverage}</p><button className="primary-button full-width jev-launch" disabled={starting||uncertain||query.isPending||query.isError||!visible||coverage?.coverage_percent!==100} onClick={()=>void start()}>{starting?t.starting:run?.status==='failed'?t.retry:t.start}</button></>}
    {run?.status==='completed'&&summary&&<><h4>{t.completed}</h4><dl className="jev-pairs"><dt>{t.reviews}</dt><dd>{summary.analysis_input_stats.total_reviews}</dd><dt>{t.text}</dt><dd>{summary.analysis_input_stats.reviews_with_text}</dd><dt>{t.english}</dt><dd>{number(summary.analysis_input_stats.english_analysis_coverage_percent)} %</dd><dt>{t.model}</dt><dd>{summary.model}</dd><dt>{t.tokens}</dt><dd>{summary.input_tokens} / {summary.output_tokens} / {summary.total_tokens}</dd><dt>{t.cost}</dt><dd>{number(summary.estimated_cost_usd,6)}</dd><dt>{t.time}</dt><dd>{number(summary.elapsed_ms==null?null:summary.elapsed_ms/1000)} s</dd></dl><small className="jev-id">{run.generation_id}</small>
      {comparison?<><h4>{t.compare}</h4><p>{comparison.dataset.identical?t.same:t.different}</p>{metrics(comparison.dataset)}<h4>{t.agreement}</h4><strong>{number(comparison.sentiment.agreement_percent)} %</strong><p>{t.differences}: {comparison.sentiment.difference_count} / {comparison.sentiment.compared}</p>{comparison.sentiment.missing_classification_count>0&&<p>{t.missing}: {comparison.sentiment.missing_classification_count}</p>}<h4>Findings</h4>{metrics(comparison.findings)}
        {Object.entries(comparison.axes).map(([axis,value])=><details key={axis}><summary>{t[axis as 'service']}</summary>{metrics(value)}</details>)}
        {Object.entries(comparison.service_themes).map(([theme,value])=><div key={theme}><h4>{t[theme as 'friendly_staff']}</h4>{metrics(value)}</div>)}
        <h4>{t.cost}</h4><dl className="jev-pairs"><dt>V6</dt><dd>{number(comparison.v6.estimated_cost_usd,6)} USD</dd><dt>V7</dt><dd>{number(comparison.v7.estimated_cost_usd,6)} USD</dd><dt>Δ</dt><dd>{number(comparison.cost_difference_percent)} %</dd><dt>Δ tokens</dt><dd>{number(comparison.tokens_difference_percent)} %</dd><dt>{t.time} V6</dt><dd>{number(comparison.v6.elapsed_ms==null?null:comparison.v6.elapsed_ms/1000)} s</dd><dt>{t.time} V7</dt><dd>{number(comparison.v7.elapsed_ms==null?null:comparison.v7.elapsed_ms/1000)} s</dd></dl><p className="jev-note">{t.note}</p><small className="jev-id">V6: {comparison.v6.generation_id}</small>
      </>:<p>{t.baseline}</p>}</>}
  </section>
}
