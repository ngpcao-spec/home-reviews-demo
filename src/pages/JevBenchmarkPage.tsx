import { useEffect,useRef,useState } from 'react'
import { useQuery,useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FlaskConical,LoaderCircle } from 'lucide-react'
import { useApp } from '../app/AppContext'
import { PageHeader } from '../components/ui/PageHeader'
import { useI18n } from '../i18n'
import { jevMessages } from '../i18n/jev'
import { useJevAccess } from '../lib/use-jev-access'
import { jevApi,launchJevOnce,readJevReference,rememberJevRun,selectedJevSource,selectJevSource,costComparison,latencyRatio,type JevRun } from '../lib/jev-benchmark'
import './JevBenchmarkPage.css'
import { JevThemesPhase } from './JevThemesPhase'
import { EnglishReviewPreparation } from './EnglishReviewPreparation'
import {HistoricalV8Entry} from './HistoricalV8Entry'
import {HistoricalV9Test} from './HistoricalV9Test'
import {FIRST_V8_ESTABLISHMENT} from '../../supabase/functions/_shared/historical-v8'

export function JevBenchmarkPage() {
  const {currentUser,demoMode}=useApp(),{language}=useI18n(),t=jevMessages[language]
  const access=useJevAccess(currentUser.id,demoMode),client=useQueryClient()
  const [selected,setSelected]=useState(()=>selectedJevSource(currentUser.id??'')),[visible,setVisible]=useState(!document.hidden),[starting,setStarting]=useState(false),[launchError,setLaunchError]=useState('')
  const busy=useRef(false)
  useEffect(()=>{
    const resume=()=>setVisible(!document.hidden)
    document.addEventListener('visibilitychange',resume);window.addEventListener('pageshow',resume)
    return()=>{document.removeEventListener('visibilitychange',resume);window.removeEventListener('pageshow',resume)}
  },[])
  const sources=useQuery({queryKey:['jev-sources',currentUser.id],queryFn:()=>jevApi.sources(),enabled:access.data===true && visible,retry:false,staleTime:0})
  const primary=sources.data?.find(s=>s.source_generation_id===selected || s.snapshots?.some(v=>v.source_generation_id===selected))??sources.data?.[0]
  const source=primary?{...primary,...primary.snapshots?.find(v=>v.source_generation_id===selected)}:undefined
  const sourceId=source?.source_generation_id,user=currentUser.id??''
  const directThemes=source?.source_analysis_version===7
  const englishSnapshot=primary?.snapshots?.find(s=>s.source_analysis_version===7)
  const chooseSource=(id:string)=>{setSelected(id);selectJevSource(user,id);setLaunchError('')}
  const queryKey=['jev-run',user,sourceId]
  const runQuery=useQuery<JevRun|null>({queryKey,enabled:access.data===true && !!sourceId && visible && !directThemes,retry:false,staleTime:0,
    queryFn:async()=>{
      const known=client.getQueryData<JevRun|null>(['jev-run',user,sourceId])
      // Initial/reopened page resolves the server's preferred run. Polling a known
      // running benchmark is always GET by id. Neither path can launch a test.
      let run=known?.status==='running'?await jevApi.read(known.id):await jevApi.latest(sourceId!)
      const saved=readJevReference(user,sourceId!)
      if(!run && saved?.benchmark_id)run=await jevApi.read(saved.benchmark_id)
      if(run)rememberJevRun(user,run)
      return run
    },
    refetchInterval:query=>visible && (query.state.data?.status==='running' || (sourceId && readJevReference(user,sourceId)?.pending))?2500:false,
  })
  const run=runQuery.data,pending=!!sourceId && !!readJevReference(user,sourceId)?.pending
  // Foreground always triggers a read, including completed/failed/error states.
  useEffect(()=>{
    if(!visible || !sourceId || access.data!==true)return
    const read=()=>{if(!document.hidden)void client.invalidateQueries({queryKey:['jev-run',user,sourceId]})}
    document.addEventListener('visibilitychange',read);window.addEventListener('pageshow',read)
    return()=>{document.removeEventListener('visibilitychange',read);window.removeEventListener('pageshow',read)}
  },[visible,sourceId,user,access.data,client])
  const launch=async()=>{
    if(busy.current || !sourceId || pending || runQuery.isPending || runQuery.isError || (run && run.status!=='failed'))return
    busy.current=true;setStarting(true);setLaunchError('')
    selectJevSource(user,sourceId)
    const launchedKey=['jev-run',user,sourceId]
    try {
      const result=await launchJevOnce(user,sourceId)
      if(result)client.setQueryData(launchedKey,result)
      else await client.invalidateQueries({queryKey:launchedKey})
    }catch(error){setLaunchError(error instanceof Error?error.message:'JEV_CONNECTION_ERROR');await client.invalidateQueries({queryKey:launchedKey})}
    finally{busy.current=false;setStarting(false)}
  }
  const loading=access.isPending || (access.data===true && (sources.isPending || (!!sourceId && !directThemes && runQuery.isPending)))
  return <><PageHeader title={t.title} back/><div className="jev-page">
    <header className="jev-intro"><span className="jev-tag"><FlaskConical size={14}/>{t.experimental}</span><h2>{t.title}</h2><p>{t.subtitle}</p></header>
    {loading?<p role="status" className="jev-notice"><LoaderCircle className="jev-spinner" size={18}/>{t.loading}</p>:access.data!==true?<section className="card jev-card"><p>{t.denied}</p><Link to="/plus">{language==='fr'?'Retour à Plus':'Quay lại Thêm'}</Link></section>:<>
      {sources.isError?<p role="alert">{t.readFailed}</p>:!source?<p className="card jev-card">{t.noSources}</p>:<>
        <section className="card jev-card jev-source"><label htmlFor="jev-source">{t.establishment}</label><select id="jev-source" value={primary!.source_generation_id} disabled={starting} onChange={e=>chooseSource(e.target.value)}>{sources.data!.map(s=><option key={s.source_generation_id} value={s.source_generation_id}>{s.name} · {s.reviews_total} {t.reviews}</option>)}</select>
          {(primary?.snapshots?.length??0)>1&&<><label className="jev-snapshot-label" htmlFor="jev-snapshot">{t.dataset} · V6 / V7</label><select id="jev-snapshot" value={sourceId} disabled={starting} onChange={e=>chooseSource(e.target.value)}>{primary!.snapshots!.map(s=><option key={s.source_generation_id} value={s.source_generation_id}>V{s.source_analysis_version} · {s.reviews_total} {t.reviews} · {s.source_analysis_version===7?'Analyse EN':language==='fr'?'Langues originales':'Ngôn ngữ gốc'} · {new Date(s.completed_at).toLocaleString(language==='fr'?'fr-FR':'vi-VN')}</option>)}</select></>}
          <p>{sourceId===primary?.source_generation_id?t.reportDate:language==='fr'?'Rapport sélectionné':'Báo cáo đã chọn'} · {new Date(source.completed_at).toLocaleDateString(language==='fr'?'fr-FR':'vi-VN')}</p>{source.source_analysis_version===7&&<span className="jev-tag">Analyse EN · V7</span>}<div className="jev-meta"><span>{t.model}<strong>Jev latest</strong></span><span>{t.repeats}<strong>3</strong></span><span>{t.dataset}<strong>{source.reviews_total} {t.reviews}</strong></span></div></section>
        {source.establishment_id===FIRST_V8_ESTABLISHMENT&&<HistoricalV9Test key={"v9:"+source.establishment_id} user={user} establishment={source.establishment_id} name={source.name} visible={visible}/>}
        {source.establishment_id===FIRST_V8_ESTABLISHMENT&&<HistoricalV8Entry key={source.establishment_id} user={user} establishment={source.establishment_id} name={source.name} visible={visible}/>}
        {!directThemes&&englishSnapshot&&<section className="card jev-card"><h3>{language==='fr'?'Phase 2 sur les avis anglais':'Giai đoạn 2 với đánh giá tiếng Anh'}</h3><p>{language==='fr'?'Un rapport V7 est disponible. Sélectionnez-le pour accéder au lancement du test.':'Đã có báo cáo V7. Chọn báo cáo để mở nút chạy thử nghiệm.'}</p><button className="primary-button full-width" disabled={starting} onClick={()=>chooseSource(englishSnapshot.source_generation_id)}>{language==='fr'?'Sélectionner V7 · Analyse EN':'Chọn V7 · Phân tích tiếng Anh'}</button></section>}
        {!directThemes&&<>
        {(runQuery.isError || launchError) && <section className="card jev-card jev-error" role="alert"><p>{launchError==='JEV_NOT_CONFIGURED'?t.notConfigured:pending?t.unknown:t.readFailed}</p><button className="secondary-button" disabled={runQuery.isFetching} onClick={()=>void runQuery.refetch()}>{t.retryRead}</button></section>}
        {!run && pending && <section className="card jev-card" role="status"><p>{t.unknown}</p></section>}
        {(!run || run.status==='failed') && !pending && <>
          {run?.status==='failed' && <section className="card jev-card jev-error" role="alert"><h3>{t.failed}</h3><small>{run.error_code}</small></section>}
          <button className="primary-button full-width jev-launch" disabled={starting || runQuery.isPending || runQuery.isError || sources.isError || !visible} onClick={()=>void launch()}>{starting?<><LoaderCircle size={18} className="jev-spinner"/>{t.starting}</>:run?.status==='failed'?t.retry:t.start}</button>
        </>}
        {run?.status==='running' && <section className="card jev-card jev-running" role="status"><LoaderCircle className="jev-spinner" size={26}/><h3>{t.running}</h3><strong>{source.name}</strong><p>{run.reviews_total} {t.reviews} · {run.requested_model} · {run.repeat_count} {t.repeats.toLowerCase()}</p><small>{t.started} {new Date(run.created_at).toLocaleString(language==='fr'?'fr-FR':'vi-VN')}</small><p>{t.continue}</p><button className="secondary-button" disabled>{t.running}</button></section>}
        {run?.status==='completed' && <JevBenchmarkResults run={run} name={source.name}/>}
        {run?.status==='failed' && <JevTechnicalDetails run={run}/>}
        </>}
        {(directThemes||run?.status==='completed') && <JevThemesPhase key={sourceId} user={user} source={source} visible={visible}/>}
        <details className="card jev-card jev-technical"><summary>{language==='fr'?'Préparation anglaise et rapport V7':'Chuẩn bị tiếng Anh và báo cáo V7'}</summary><EnglishReviewPreparation key={source.establishment_id} user={user} establishment={source.establishment_id} name={source.name} visible={visible}/></details>
      </>}
    </>}
    <p className="jev-footnote">{t.production}</p>
  </div></>
}
export function JevBenchmarkResults({run,name}:{run:JevRun;name:string}) {
  const {language}=useI18n(),t=jevMessages[language],c=run.comparison
  const format=(v:number|null|undefined,digits=1)=>typeof v==='number' && Number.isFinite(v)?v.toLocaleString(language==='fr'?'fr-FR':'vi-VN',{maximumFractionDigits:digits,minimumFractionDigits:digits}):'—'
  const percent=(v:number|null|undefined)=>typeof v==='number'?format(v*100)+' %':'—'
  const quality=(v:number|null)=>v===null?t.unavailable:v>=.95?t.excellent:v>=.9?t.promising:t.insufficient
  const stability=(v:number|null)=>v===null?t.unavailable:v>=.98?t.stableExcellent:v>=.95?t.good:t.study
  const costs=costComparison(c.jev.estimated_jev_cost_usd,c.sol_v6_baseline.estimated_sol_baseline_cost_usd),speed=latencyRatio(c.jev.elapsed_ms,c.sol_v6_baseline.end_to_end_elapsed_ms)
  const verdictQuality:Record<string,string>={excellent:t.excellent,prometteur:t.promising,'insuffisant pour remplacement direct':t.insufficient,not_evaluable:t.unavailable}
  const verdictStability:Record<string,string>={excellente:t.stableExcellent,bonne:t.good,'à investiguer':t.study,not_evaluable:t.unavailable}
  return <div className="jev-results">
    <section className="card jev-card"><span className="jev-tag">{t.complete}</span>{c.dataset.source_analysis_version===7&&<span className="jev-tag">Analyse EN · V7</span>}<h3>{name}</h3><p>{c.dataset.reviews_total} {t.reviews} · {c.dataset.reviews_with_text} {t.text} · {c.dataset.textless_review} {t.textless}</p><dl className="jev-pairs"><dt>{t.served}</dt><dd>{c.jev.served_models.join(', ')||'—'}</dd><dt>{t.repeats}</dt><dd>{run.repeat_count}</dd><dt>{t.requests}</dt><dd>{run.request_count}</dd><dt>{t.retries}</dt><dd>{run.retry_count}</dd></dl>{c.jev.multiple_served_models&&<p className="jev-warning">{t.multiple}</p>}</section>
    {!c.metrics_complete&&<p className="jev-warning" role="alert">{t.partial}</p>}
    <section className="card jev-card"><h3>{t.cost}</h3><div className="jev-dual"><div><small>{t.jevCost}</small><strong>{format(c.jev.estimated_jev_cost_usd,6)} <em>USD</em></strong></div><div><small>{t.solCost}</small><strong>{format(c.sol_v6_baseline.estimated_sol_baseline_cost_usd,6)} <em>USD</em></strong></div></div>{costs&&<><p>{t.share.replace('{value}',percent(costs.share))}</p><p className="jev-highlight">{t.savings.replace('{value}',percent(costs.savings))}</p></>}<span className="jev-tag">{t.scope}</span><p className="jev-note">{t.estimate}. {t.costNote} {t.repeatNote}</p></section>
    <section className="card jev-card"><h3>{t.time}</h3><div className="jev-dual"><div><small>{t.jevTime}</small><strong>{format(c.jev.elapsed_ms/1000)} <em>s</em></strong></div><div><small>{t.solTime}</small><strong>{format(c.sol_v6_baseline.end_to_end_elapsed_ms/1000)} <em>s</em></strong></div></div>{speed!==null&&<p className="jev-highlight">{t.speed.replace('{value}',format(speed))}</p>}<p className="jev-note">{t.timeNote}</p></section>
    <section className="card jev-card jev-score"><h3>{t.agreement}</h3><strong>{percent(c.overall_sentiment.pooled_raw_agreement_with_sol_v6)}</strong><span className="jev-tag">{quality(c.overall_sentiment.pooled_raw_agreement_with_sol_v6)}</span><p className="jev-note">{t.reference}</p></section>
    <section className="card jev-card jev-score"><h3>{t.stability}</h3><strong>{percent(c.stability.stable_decision_rate)}</strong><span className="jev-tag">{stability(c.stability.stable_decision_rate)}</span><p className="jev-note">{t.drift} : {format(c.stability.max_probability_drift,4)}</p></section>
    <div className="jev-section-heading"><h3>{t.axes}</h3><p>{t.threshold}</p></div>
    {(['service','quality','price','atmosphere'] as const).map(axis=><section className="card jev-card jev-axis" key={axis} data-axis={axis}><h3>{t[axis]}</h3>{(['positive','negative'] as const).map(polarity=>{
      const scores=c.axes_at_threshold['0.50']?.[`${axis}_${polarity}`]?.pooled
      const weak=scores?.f1_vs_sol_reference!==null && scores?.f1_vs_sol_reference!==undefined && scores.f1_vs_sol_reference<.8
      return <div className="jev-axis-signal" key={polarity}><div><h4>{t[polarity]}</h4>{weak&&<span className="jev-tag jev-warning">{t.investigate}</span>}</div><dl className="jev-axis-metrics"><div><dt>{t.precision}</dt><dd>{format(scores?.precision_vs_sol_reference,2)}</dd></div><div><dt>{t.recall}</dt><dd>{format(scores?.recall_vs_sol_reference,2)}</dd></div><div><dt>F1</dt><dd className={weak?'jev-warning':''}>{format(scores?.f1_vs_sol_reference,2)}</dd></div></dl></div>
    })}</section>)}
    <section className="card jev-card"><h3>{t.verdict}</h3><dl className="jev-verdict"><dt>{t.quality}</dt><dd>{verdictQuality[c.verdict.quality]??t.unavailable}</dd><dt>{t.stability}</dt><dd>{verdictStability[c.verdict.stability]??t.unavailable}</dd><dt>{t.cost}</dt><dd>{t.costVerdict}</dd><dt>{t.time}</dt><dd>{t.latencyVerdict}</dd><dt>{t.next}</dt><dd>{t.nextVerdict}</dd></dl></section>
    <JevTechnicalDetails run={run}/>
  </div>
}
function JevTechnicalDetails({run}:{run:JevRun}) {
  const {language}=useI18n(),t=jevMessages[language]
  return <details className="card jev-card jev-technical"><summary>{t.technical}</summary><dl className="jev-verdict"><dt>Benchmark ID</dt><dd>{run.id}</dd><dt>Source V6</dt><dd>{run.source_generation_id}</dd><dt>{t.served}</dt><dd>{run.served_models.join(', ')||'—'}</dd><dt>{t.requests} / {t.retries}</dt><dd>{run.request_count} / {run.retry_count}</dd><dt>{t.input}</dt><dd>{run.jev_input_tokens}</dd><dt>{t.output}</dt><dd>{run.jev_output_tokens}</dd>{run.error_code&&<><dt>{t.failed}</dt><dd>{run.error_code}</dd></>}</dl>{run.comparison.errors?.map((e,i)=><p className="jev-note" key={i}>{e.review_alias} · {e.repeat} · {e.error_code}</p>)}</details>
}
