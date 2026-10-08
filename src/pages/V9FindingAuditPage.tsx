import {useState,useRef,useEffect} from 'react'
import {Link,useNavigate,useSearchParams} from 'react-router-dom'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import {Info} from 'lucide-react'
import {useApp} from '../app/AppContext'
import {useI18n} from '../i18n'
import {useJevAccess} from '../lib/use-jev-access'
import {PageHeader} from '../components/ui/PageHeader'
import {findingAuditMessages} from '../i18n/v9-finding-audit'
import {findingAuditApi,type FindingAuditData} from '../lib/v9-finding-audit'
import type {findingAuditProjection} from '../../supabase/functions/_shared/v9-finding-audit-api'
import './JevBenchmarkPage.css'
import './GoldSetPage.css'
type Data=ReturnType<typeof findingAuditProjection>
export function FindingAuditEntry(){
  const {currentUser,demoMode}=useApp(),{language}=useI18n(),t=findingAuditMessages[language],access=useJevAccess(currentUser.id,demoMode),navigate=useNavigate(),lock=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState(false)
  const query=useQuery({queryKey:['finding-audit-entry',currentUser.id],enabled:access.data===true,queryFn:()=>findingAuditApi(undefined,undefined,{},true),retry:false,staleTime:0})
  async function start(){if(lock.current||query.isPending||query.isError)return;if(query.data?.audit){navigate('/plus/v9-finding-audit?id='+query.data.audit.id);return}lock.current=true;setBusy(true);setError(false);try{const data=await findingAuditApi(undefined,'create');if(!data.audit)throw new Error('FINDING_AUDIT_CREATE_FAILED');navigate('/plus/v9-finding-audit?id='+data.audit.id)}catch{setError(true);await query.refetch()}finally{lock.current=false;setBusy(false)}}
  if(access.data!==true)return null
  return <section className="card jev-card"><h3>{t.entryTitle}</h3><p>{t.intro}</p><button className="primary-button full-width" disabled={busy||query.isPending||query.isError} onClick={()=>void start()}>{busy?t.saving:query.data?.audit?.status==='completed'?t.show:query.data?.audit?t.resume:t.start}</button>{(error||query.isError)&&<div role="alert"><p>{t.error}</p><button className="secondary-button" onClick={()=>void query.refetch()}>{t.check}</button></div>}</section>
}
export function V9FindingAuditPage(){
  const {currentUser,demoMode}=useApp(),{language}=useI18n(),t=findingAuditMessages[language],access=useJevAccess(currentUser.id,demoMode),[params,setParams]=useSearchParams(),client=useQueryClient(),[busy,setBusy]=useState(false),[error,setError]=useState(''),lock=useRef(false)
  const id=params.get('id')??undefined,key=['finding-audit',currentUser.id,id]
  const query=useQuery<FindingAuditData>({queryKey:key,enabled:access.data===true,queryFn:()=>findingAuditApi(id),retry:false,staleTime:0})
  useEffect(()=>{const resume=()=>{if(!document.hidden)void client.invalidateQueries({queryKey:['finding-audit',currentUser.id]})};window.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',resume);return()=>{window.removeEventListener('pageshow',resume);document.removeEventListener('visibilitychange',resume)}},[client,currentUser.id])
  async function action(kind:string,payload:Record<string,unknown>={}){if(lock.current||query.isPending||query.isError)return false;lock.current=true;setBusy(true);setError('');try{const data=await findingAuditApi(query.data?.audit?.id,kind,{revision:query.data?.audit?.revision,...payload});client.setQueryData(key,data);if(data.audit&&!id){client.setQueryData(['finding-audit',currentUser.id,data.audit.id],data);setParams({id:data.audit.id},{replace:true})}return true}catch(e){setError(e instanceof Error?e.message:'FINDING_AUDIT_CONNECTION_ERROR');await query.refetch();return false}finally{lock.current=false;setBusy(false)}}
  return <><PageHeader title={t.title} back/><div className="jev-page gold-page"><h2>{t.title}</h2>{access.isPending||query.isPending&&access.data===true?<p role="status">{t.loading}</p>:access.data!==true?<p>{t.denied}</p>:<>
    {(query.isError||error)&&<section className="card jev-card" role="alert"><p>{error==='FINDING_AUDIT_REVISION_CHANGED'?t.conflict:t.error}</p><button className="secondary-button" disabled={busy||query.isFetching} onClick={()=>void query.refetch()}>{t.check}</button></section>}
    {query.data?.audit?query.data.audit.status==='completed'?<FindingAuditResults data={query.data as Data}/>:<FindingAuditAnnotation data={query.data as Data} user={currentUser.id??''} busy={busy||query.isError} action={action}/>:!query.isError&&<section className="card jev-card"><p>{t.required}</p><button className="primary-button full-width" disabled={busy||query.isPending} onClick={()=>void action('create')}>{t.start}</button></section>}
    </>}<Link to="/plus/jev-benchmark">{t.return}</Link></div></>
}
export function FindingAuditAnnotation({data,user,busy,action}:{data:Data;user:string;busy:boolean;action:(kind:string,payload?:Record<string,unknown>)=>Promise<boolean>}){
  const {language}=useI18n(),t=findingAuditMessages[language],a=data.audit,storage='finding-audit-item:'+user+':'+a.id
  const [selected,setSelected]=useState(()=>{try{return localStorage.getItem(storage)??data.items.find(i=>i.choice===undefined)?.id??data.items[0]?.id}catch{return data.items[0]?.id}}),[info,setInfo]=useState(false),[confirm,setConfirm]=useState(false)
  useEffect(()=>{try{if(selected)localStorage.setItem(storage,selected)}catch{/* Labels are only stored on the server. */}},[storage,selected])
  const index=Math.max(0,data.items.findIndex(i=>i.id===selected)),item=data.items[index],definition=data.taxonomy[item.theme_key]
  const select=(value:string)=>{setSelected(value);setInfo(false);try{localStorage.setItem(storage,value)}catch{/* Only cursor; server labels are authoritative. */}}
  return <><section className="card jev-card"><h3>{a.completed_findings} / 30 {t.done}</h3><progress aria-label={t.done} value={a.completed_findings} max={30}/><p>{t.required}</p><small role="status">{busy?t.saving:item.choice!==undefined?t.saved:''}</small></section>
    <section className="card jev-card"><h3>{t.review} {index+1} / 30</h3><p className="gold-text" lang="en">{item.analysis_text}</p></section>
    <section className="card jev-card" data-finding-audit-theme={item.theme_key}><div className="gold-theme-heading"><h3>{definition[language]}</h3><button className="gold-info" aria-label={'Info · '+definition[language]} onClick={()=>setInfo(!info)}><Info size={18}/></button></div>{info&&<p>{definition[language==='fr'?'definition_fr':'definition_vi']}</p>}<p>{t.question}</p><div className="gold-choices">{(['positive','negative','both','absent','uncertain'] as const).map(choice=><button key={choice} aria-pressed={item.choice===choice} disabled={busy} onClick={()=>void action('save_choice',{item_id:item.id,choice})}>{t[choice]}</button>)}</div></section>
    <section className="card jev-card gold-actions"><div className="gold-navigation"><button className="secondary-button" disabled={busy||index===0} onClick={()=>select(data.items[index-1].id)}>{t.previous}</button><button className="secondary-button" disabled={busy||item.choice===undefined||index===29} onClick={()=>select(data.items[index+1].id)}>{t.next}</button></div>{a.completed_findings===30&&<button className="primary-button full-width" disabled={busy} onClick={()=>setConfirm(true)}>{t.finalize}</button>}{confirm&&<div role="alertdialog" aria-modal="true" aria-label={t.finalize}><p>{t.confirmation}</p><button className="primary-button" disabled={busy} onClick={()=>void action('finalize',{confirm:true})}>{t.confirm}</button><button className="secondary-button" disabled={busy} onClick={()=>setConfirm(false)}>{t.cancel}</button></div>}</section></>
}
export function FindingAuditResults({data}:{data:Data}){
  const {language}=useI18n(),t=findingAuditMessages[language],c=data.comparison!,percent=(n:number|null)=>n===null?'—':(n*100).toLocaleString(language==='fr'?'fr-FR':'vi-VN',{maximumFractionDigits:1})+' %'
  const counts=(v:{controlled:number;validated:number;rejected:number;uncertain:number;validation_rate:number|null})=><dl className="jev-pairs"><dt>{t.controlled}</dt><dd>{v.controlled}</dd><dt>{t.validated}</dt><dd>{v.validated}</dd><dt>{t.rejected}</dt><dd>{v.rejected}</dd><dt>{t.uncertainCount}</dt><dd>{v.uncertain}</dd><dt>{t.rate}</dt><dd>{percent(v.validation_rate)}</dd></dl>
  const cards=(rows:typeof c.cases)=>rows.map(row=><article className="jev-theme-detail" key={row.id}><h4>{data.taxonomy[row.theme_key][language]} · {row.position}</h4><dl className="jev-pairs"><dt>{t.sentiment}</dt><dd>{t[row.sentiment]}</dd><dt>{t.human}</dt><dd>{t[row.human]}</dd><dt>{t.positiveProbability}</dt><dd>{percent(row.probability_positive)}</dd><dt>{t.negativeProbability}</dt><dd>{percent(row.probability_negative)}</dd><dt>{t.stability}</dt><dd>{row.repeat_stable?t.stable:t.unstable}</dd></dl><details><summary>{t.text}</summary><p className="gold-text" lang="en">{data.items.find(i=>i.id===row.id)?.analysis_text}</p></details></article>)
  return <div className="jev-results"><section className="card jev-card"><h3>{t.result}</h3><p>{t.revealed}</p>{counts(c)}<p>{t[c.interpretation as 'very_good_additional_signal']}</p><p>{t.note}</p><small>{t.immutable}</small></section>
    <section className="card jev-card"><h3>{t.byTheme}</h3>{Object.entries(c.by_theme).map(([key,v])=><article className="jev-theme-detail" key={key}><h4>{data.taxonomy[key as keyof typeof data.taxonomy][language]}</h4>{counts(v)}</article>)}</section>
    <section className="card jev-card"><h3>{t.thresholds}</h3><p>{t.thresholdNote}</p>{c.exploratory_thresholds.map(v=><details className="jev-theme-list" key={v.threshold}><summary>≥ {v.threshold.toFixed(2)} · {v.controlled} · {percent(v.validation_rate)}</summary>{counts(v)}<dl className="jev-pairs"><dt>{t.removedValidated}</dt><dd>{v.removed_validated}</dd><dt>{t.removedRejected}</dt><dd>{v.removed_rejected}</dd><dt>{t.retainedValidated}</dt><dd>{percent(v.retained_validated_fraction)}</dd></dl></details>)}</section>
    <section className="card jev-card"><h3>{t.stability}</h3><h4>{t.stable}</h4>{counts(c.stability.stable)}<h4>{t.unstable}</h4>{counts(c.stability.unstable)}</section>
    <section className="card jev-card"><h3>{t.rejectedCases}</h3>{c.rejected?cards(c.cases.filter(row=>row.outcome==='rejected')):<p>{t.noRejected}</p>}</section><details className="card jev-card jev-theme-list"><summary>{t.allCases}</summary>{cards(c.cases)}</details>
  </div>
}
