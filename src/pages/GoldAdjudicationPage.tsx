import {useState,useRef,useEffect} from 'react'
import {Link,useNavigate,useSearchParams} from 'react-router-dom'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import {Info} from 'lucide-react'
import {useApp} from '../app/AppContext'
import {useI18n} from '../i18n'
import {useJevAccess} from '../lib/use-jev-access'
import {PageHeader} from '../components/ui/PageHeader'
import {adjudicationMessages} from '../i18n/gold-adjudication'
import {adjudicationApi,type AdjudicationData} from '../lib/gold-adjudication'
import type {adjudicationProjection} from '../../supabase/functions/_shared/gold-adjudication-api'
import type {GoldTheme} from '../../supabase/functions/_shared/gold-taxonomy'
import './JevBenchmarkPage.css'
import './GoldSetPage.css'
import {RepresentativeEntry} from './RepresentativeHumanPage'
type Data=ReturnType<typeof adjudicationProjection>
export function AdjudicationEntry(){
  const {currentUser}=useApp(),{language}=useI18n(),t=adjudicationMessages[language],navigate=useNavigate(),busy=useRef(false),[starting,setStarting]=useState(false),[error,setError]=useState(false)
  const query=useQuery({queryKey:['adjudication-entry',currentUser.id],queryFn:()=>adjudicationApi(undefined,undefined,{},true),retry:false,staleTime:0})
  async function start(){if(busy.current||query.isPending||query.isError)return;if(query.data?.adjudication){navigate('/plus/gold-check?id='+query.data.adjudication.id);return}busy.current=true;setStarting(true);setError(false);try{const data=await adjudicationApi(undefined,'create');if(!data.adjudication)throw new Error('ADJUDICATION_CREATE_FAILED');navigate('/plus/gold-check?id='+data.adjudication.id)}catch{setError(true);await query.refetch()}finally{busy.current=false;setStarting(false)}}
  return <section className="card jev-card"><h3>{t.title}</h3><p>{t.intro}</p><button className="primary-button full-width" disabled={starting||query.isPending||query.isError} onClick={()=>void start()}>{starting?t.saving:query.data?.adjudication?.status==='completed'?t.show:query.data?.adjudication?t.resume:t.start}</button>{(query.isError||error)&&<p role="alert">{t.error}<button className="secondary-button" onClick={()=>void query.refetch()}>{t.check}</button></p>}</section>
}
export function GoldAdjudicationPage(){
  const {currentUser,demoMode}=useApp(),{language}=useI18n(),t=adjudicationMessages[language],access=useJevAccess(currentUser.id,demoMode),[params,setParams]=useSearchParams(),client=useQueryClient(),[busy,setBusy]=useState(false),[error,setError]=useState(''),lock=useRef(false)
  const id=params.get('id')??undefined,key=['adjudication',currentUser.id,id]
  const query=useQuery<AdjudicationData>({queryKey:key,enabled:access.data===true,queryFn:()=>adjudicationApi(id),retry:false,staleTime:0})
  useEffect(()=>{const resume=()=>{if(!document.hidden)void client.invalidateQueries({queryKey:['adjudication',currentUser.id]})};window.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',resume);return()=>{window.removeEventListener('pageshow',resume);document.removeEventListener('visibilitychange',resume)}},[client,currentUser.id])
  async function action(kind:string,payload:Record<string,unknown>={}){if(lock.current||query.isPending||query.isError)return false;lock.current=true;setBusy(true);setError('');try{const data=await adjudicationApi(query.data?.adjudication?.id,kind,{revision:query.data?.adjudication?.revision,...payload});client.setQueryData(key,data);if(data.adjudication&&!id){client.setQueryData(['adjudication',currentUser.id,data.adjudication.id],data);setParams({id:data.adjudication.id},{replace:true})}return true}catch(e){setError(e instanceof Error?e.message:'ADJUDICATION_CONNECTION_ERROR');await query.refetch();return false}finally{lock.current=false;setBusy(false)}}
  return <><PageHeader title={t.title} back/><div className="jev-page gold-page"><h2>{t.title}</h2>{access.isPending||query.isPending&&access.data===true?<p role="status">{t.loading}</p>:access.data!==true?<p>{t.denied}</p>:<>
    {(query.isError||error)&&<section role="alert" className="card jev-card"><p>{error==='ADJUDICATION_REVISION_CHANGED'?t.conflict:t.error}</p><button className="secondary-button" onClick={()=>void query.refetch()} disabled={busy||query.isFetching}>{t.check}</button></section>}
    {query.data?.adjudication?query.data.adjudication.status==='completed'?<AdjudicationResults data={query.data as Data}/>:<AdjudicationAnnotation data={query.data as Data} user={currentUser.id??''} busy={busy||query.isError} action={action}/>:!query.isError&&<section className="card jev-card"><p>{t.intro}</p><button className="primary-button full-width" disabled={busy||query.isPending} onClick={()=>void action('create')}>{t.start}</button></section>}
  </>}<Link to="/plus/gold-set?id=1d5cfc8c-ac77-4e44-a7a7-6153eb132385">{t.return}</Link></div></>
}
export function AdjudicationAnnotation({data,user,busy,action}:{data:Data;user:string;busy:boolean;action:(kind:string,payload?:Record<string,unknown>)=>Promise<boolean>}){
  const {language}=useI18n(),t=adjudicationMessages[language],a=data.adjudication,storage='adjudication-review:'+user+':'+a.id
  const [selected,setSelected]=useState(()=>{try{return localStorage.getItem(storage)??data.items.find(i=>i.themes.some(k=>i.choices[k]===undefined))?.review_id??data.items[0]?.review_id}catch{return data.items[0]?.review_id}}),[info,setInfo]=useState<GoldTheme|null>(null),[confirm,setConfirm]=useState(false)
  const index=Math.max(0,data.items.findIndex(i=>i.review_id===selected)),item=data.items[index],complete=item.themes.every(k=>item.choices[k]!==undefined)
  const select=(review_id:string)=>{setSelected(review_id);setInfo(null);try{localStorage.setItem(storage,review_id)}catch{/* Server remains authoritative. */}}
  return <><section className="card jev-card"><h3>{a.completed_reviews} / 12 {t.done}</h3><progress value={a.completed_reviews} max={12}/><p>{t.required}</p><small role="status">{busy?t.saving:Object.keys(item.choices).length?t.saved:''}</small></section><section className="card jev-card"><h3>{t.review} {index+1} / 12</h3><p className="gold-text" lang="en">{item.analysis_text}</p></section>
    {item.themes.map(theme=>{const definition=data.taxonomy[theme];return <section className="card jev-card" key={theme} data-adjudication-theme={theme}><div className="gold-theme-heading"><h3>{definition[language]}</h3><button className="gold-info" aria-label={'Info · '+definition[language]} onClick={()=>setInfo(info===theme?null:theme)}><Info size={18}/></button></div>{info===theme&&<><p>{definition[language==='fr'?'definition_fr':'definition_vi']}</p>{theme==='atmosphere'&&<p>{t.atmosphereReminder}</p>}</>}<div className="gold-choices">{(['absent','positive','negative','both','uncertain'] as const).map(choice=><button key={choice} aria-pressed={item.choices[theme]===choice} disabled={busy} onClick={()=>void action('save_choice',{review_id:item.review_id,theme_key:theme,choice})}>{t[choice]}</button>)}</div></section>})}
    <section className="card jev-card gold-actions"><div className="gold-navigation"><button className="secondary-button" disabled={busy||index===0} onClick={()=>select(data.items[index-1].review_id)}>{t.previous}</button><button className="secondary-button" disabled={busy||!complete||index===11} onClick={()=>select(data.items[index+1].review_id)}>{t.next}</button></div>{a.completed_reviews===12&&<button className="primary-button full-width" disabled={busy} onClick={()=>setConfirm(true)}>{t.finalize}</button>}
      {confirm&&<div role="alertdialog" aria-modal="true" aria-label={t.finalize}><p>{t.confirmation}</p><button className="primary-button" disabled={busy} onClick={()=>void action('finalize',{confirm:true})}>{t.confirm}</button><button className="secondary-button" disabled={busy} onClick={()=>setConfirm(false)}>{t.cancel}</button></div>}
    </section></>
}
export function AdjudicationResults({data}:{data:Data}){
  const {language}=useI18n(),t=adjudicationMessages[language],c=data.comparison!,n=(v:number|null)=>v===null?'—':v.toLocaleString(language==='fr'?'fr-FR':'vi-VN',{maximumFractionDigits:1})+' %'
  const cases=(rows:typeof c.cases)=>rows.map(row=><article className="jev-theme-detail" key={row.review_id+row.theme_key}><h4>{data.taxonomy[row.theme_key][language]} · {t.review} {row.position}</h4><dl className="jev-pairs"><dt>{t.human}</dt><dd>{t[row.human]}</dd><dt>{t.gold}</dt><dd>{t[row.gold]}</dd><dt>{t.sol}</dt><dd>{t[row.sol]}</dd><dt>{t.jev}</dt><dd>{t[row.jev]}</dd></dl><details className="jev-theme-list"><summary>{t.text}</summary><p className="gold-text" lang="en">{data.items.find(i=>i.review_id===row.review_id)?.analysis_text}</p></details></article>)
  return <div className="jev-results"><section className="card jev-card"><h3>{t.result}</h3><p>{c.review_count} {t.cases} · {c.label_count} {t.labels}</p><p>{t.immutable}</p><p>{t.note}</p><dl className="jev-pairs"><dt>{t.goldAgreement}</dt><dd>{n(c.gold_human_agreement_percent)}</dd><dt>{t.solAgreement}</dt><dd>{n(c.sol.agreement_with_human_percent)}</dd><dt>{t.jevAgreement}</dt><dd>{n(c.jev.agreement_with_human_percent)}</dd><dt>{t.uncertainCount}</dt><dd>{c.human_uncertain}</dd><dt>{t.sol} · {t.disagreements}</dt><dd>{c.sol.disagreements}</dd><dt>{t.jev} · {t.disagreements}</dt><dd>{c.jev.disagreements}</dd></dl><p>{t[c.interpretation as 'very_consistent']}</p></section>
    {(['attentiveness','professionalism','atmosphere'] as const).map(theme=><section className="card jev-card" key={theme}><h3>{data.taxonomy[theme][language]}</h3><dl className="jev-pairs"><dt>{t.controlled}</dt><dd>{c.by_theme[theme].controlled_cases}</dd><dt>{t.humanSol}</dt><dd>{c.by_theme[theme].human_matches_sol}</dd><dt>{t.humanJev}</dt><dd>{c.by_theme[theme].human_matches_jev}</dd><dt>{t.humanGold}</dt><dd>{c.by_theme[theme].human_matches_gold}</dd><dt>{t.uncertain}</dt><dd>{c.by_theme[theme].human_uncertain}</dd></dl></section>)}
    <section className="card jev-card"><h3>{t.comparison}</h3><dl className="jev-pairs"><dt>{t.solOnly}</dt><dd>{c.human_matches_sol_only}</dd><dt>{t.jevOnly}</dt><dd>{c.human_matches_jev_only}</dd><dt>{t.bothModels}</dt><dd>{c.human_matches_both}</dd><dt>{t.neither}</dt><dd>{c.human_matches_neither}</dd></dl></section>
    <section className="card jev-card"><h3>{t.mismatches}</h3>{cases(c.cases.filter(row=>row.gold_mismatch&&row.comparable))}</section><details className="card jev-card jev-theme-list"><summary>{t.allCases}</summary>{cases(c.cases)}</details>
    {data.adjudication.id==='146615ca-d3cd-4914-8613-4e6e3d6219f7'&&<RepresentativeEntry/>}
  </div>
}
