import { useEffect,useRef,useState } from 'react'
import { useQuery,useQueryClient } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { useI18n } from '../i18n'
import { jevMessages } from '../i18n/jev'
import { themeMessages,themeLabels } from '../i18n/jev-themes'
import { jevApi,launchJevOnce,readJevReference,rememberJevRun,type JevSource } from '../lib/jev-benchmark'
import type { JevThemeComparison,JevThemeRun } from '../lib/jev-theme-benchmark'
import type { JevRun } from '../lib/jev-benchmark'
import type { JevServiceComparison,JevServiceRun } from '../lib/jev-service-benchmark'
import { serviceMessages } from '../i18n/jev-service'
import { JevServiceResults } from './JevServiceResults'
import {JevLanguageEffectResults} from './JevLanguageEffectResults'
import {GoldSetEntry} from './GoldSetPage'

export function JevThemesPhase({user,source,visible,kind='themes_phase2'}:{user:string;source:JevSource;visible:boolean;kind?:'themes_phase2'|'themes_phase2b_service'}) {
  const {language}=useI18n(),english=source.source_analysis_version===7&&kind==='themes_phase2',base=kind==='themes_phase2b_service'?serviceMessages[language]:themeMessages[language],t=english?{...base,title:language==='fr'?'Phase 2 — Thèmes · V7 anglais':'Giai đoạn 2 — Chủ đề · V7 tiếng Anh',intro:language==='fr'?'Mesurer Jev sur les mêmes thèmes en utilisant les avis standardisés en anglais.':'Đo Jev trên cùng các chủ đề với đánh giá được chuẩn hóa bằng tiếng Anh.',start:language==='fr'?'Lancer Phase 2 V7':'Chạy Phase 2 V7'}:base,common=jevMessages[language],client=useQueryClient()
  const [starting,setStarting]=useState(false),[error,setError]=useState(''),busy=useRef(false)
  type Comparison=JevThemeComparison|JevServiceComparison
  const id=source.source_generation_id,key=['jev-run',user,id,kind]
  const query=useQuery<JevRun<Comparison>|null>({queryKey:key,enabled:visible,retry:false,staleTime:0,queryFn:async()=>{
    const known=client.getQueryData<JevRun<Comparison>|null>(key)
    let run=known?.status==='running'?await jevApi.read<Comparison>(known.id):await jevApi.latest<Comparison>(id,kind)
    const saved=readJevReference(user,id,kind)
    if(!run && saved?.benchmark_id)run=await jevApi.read<Comparison>(saved.benchmark_id)
    if(run && (run.benchmark_type!==kind || run.source_generation_id!==id))throw new Error('JEV_PHASE_MISMATCH')
    if(run)rememberJevRun(user,run)
    return run
  },refetchInterval:q=>visible && (q.state.data?.status==='running' || readJevReference(user,id,kind)?.pending)?2500:false})
  useEffect(()=>{
    const resume=()=>{if(!document.hidden)void client.invalidateQueries({queryKey:['jev-run',user,id,kind]})}
    window.addEventListener('pageshow',resume)
    return()=>window.removeEventListener('pageshow',resume)
  },[user,id,client,kind])
  const run=query.data,pending=!!readJevReference(user,id,kind)?.pending
  async function launch() {
    if(busy.current || pending || query.isPending || query.isError || (run && run.status!=='failed'))return
    busy.current=true;setStarting(true);setError('')
    try {const result=await launchJevOnce<Comparison>(user,id,kind);if(result)client.setQueryData(key,result)}
    catch(e){setError(e instanceof Error?e.message:'JEV_CONNECTION_ERROR');await query.refetch()}
    finally{busy.current=false;setStarting(false)}
  }
  return <section className="jev-phase2" aria-label={t.title}>
    <header className="jev-section-heading"><span className="jev-tag">{kind==='themes_phase2b_service'?7:25} {language==='fr'?'thèmes':'chủ đề'}</span><h3>{t.title}</h3><p>{t.intro}</p></header>
    {query.isPending?<p className="jev-notice" role="status">{common.loading}</p>:<>
      {(query.isError || error) && <div className="card jev-card jev-error" role="alert"><p>{error==='JEV_NOT_CONFIGURED'?common.notConfigured:pending?common.unknown:common.readFailed}</p><button className="secondary-button" onClick={()=>void query.refetch()} disabled={query.isFetching}>{common.retryRead}</button></div>}
      {pending && !run && <p role="status" className="card jev-card">{common.unknown}</p>}
      {run?.status==='failed'&&<div className="card jev-card jev-error" role="alert"><h3>{common.failed}</h3><small>{run.error_code}</small></div>}
      {(!run || run.status==='failed') && !pending && <button className="primary-button full-width jev-launch" disabled={starting || query.isPending || query.isError || !visible} onClick={()=>void launch()}>{starting?common.starting:run?.status==='failed'?common.retry:t.start}</button>}
      {run?.status==='running'&&<div className="card jev-card jev-running" role="status"><LoaderCircle size={26} className="jev-spinner"/><h3>{t.running}</h3><strong>{source.name}</strong><p>{kind==='themes_phase2b_service'?`7 ${language==='fr'?'thèmes':'chủ đề'} · ${run.comparison.dataset.reviews_with_text} ${common.text}`:`${run.reviews_total} ${common.reviews}`} · {run.repeat_count} {common.repeats.toLowerCase()} · {run.requested_model}</p><small>{new Date(run.created_at).toLocaleString(language==='fr'?'fr-FR':'vi-VN')}</small><p>{common.continue}</p></div>}
      {english&&run?.status==='completed'&&run.id==='4c634678-17a9-47b3-89e1-fad0641f5d86'&&<GoldSetEntry/>}
      {run?.status==='completed'&&(kind==='themes_phase2b_service'?<JevServiceResults run={run as JevServiceRun}/>:<><JevThemeResults run={run as JevThemeRun}/>{!english&&<JevThemesPhase user={user} source={source} visible={visible} kind="themes_phase2b_service"/>}</>)}
    </>}
  </section>
}
export function JevThemeResults({run}:{run:JevThemeRun}) {
  const {language}=useI18n(),t=themeMessages[language],common=jevMessages[language],c=run.comparison
  const number=(v:number|null|undefined,digits=2)=>typeof v==='number' && Number.isFinite(v)?v.toLocaleString(language==='fr'?'fr-FR':'vi-VN',{minimumFractionDigits:digits,maximumFractionDigits:digits}):'—'
  const percent=(v:number|null|undefined)=>typeof v==='number'?number(v*100,1)+' %':'—'
  return <div className="jev-results jev-theme-results">
    {c.dataset.source_analysis_version===7&&<h3>PHASE 2 V7 · ENGLISH</h3>}
    {!c.metrics_complete&&<p className="jev-warning" role="alert">{common.partial}</p>}
    <section className="card jev-card"><span className="jev-tag">{t.scope}</span><p>{c.dataset.reviews_total} {common.reviews} · {c.dataset.reviews_with_text} {common.text} · {c.dataset.textless_review} {common.textless}</p><div className="jev-theme-kpis">{[[t.micro,number(c.micro_f1_all_supported_themes)],[t.macro,number(c.macro_f1_supported_themes)],[common.stability,percent(c.stability.exact_theme_choice_stability_rate)],[t.cost,number(c.jev.estimated_jev_cost_usd,6)+' USD'],[t.time,number(c.jev.elapsed_ms/1000,1)+' s']].map(([label,value])=><div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div><p className="jev-note">{t.threshold}. {t.supportNote}</p><p className="jev-note">{common.reference}</p></section>
    {c.language_effect&&<JevLanguageEffectResults effect={c.language_effect}/>}
    {(['service','quality','price','atmosphere'] as const).map(axis=>{
      const metrics=c.axis_metrics[axis],s=c.stability.by_axis[axis]
      const weak=metrics.supported_labels>0 && metrics.global_micro_f1!==null && metrics.global_micro_f1<.8
      return <section className="card jev-card jev-theme-axis" key={axis} data-theme-axis={axis}><h3>{common[axis]}</h3>{weak&&<span className="jev-tag jev-warning">{t.weak}</span>}<dl className="jev-pairs"><dt>{t.micro}</dt><dd>{number(metrics.global_micro_f1)}</dd><dt>{common.positive}</dt><dd>{number(metrics.positive_micro_f1)}</dd><dt>{common.negative}</dt><dd>{number(metrics.negative_micro_f1)}</dd><dt>{common.stability}</dt><dd>{percent(s.exact_theme_choice_stability_rate)}</dd></dl><p className="jev-note">{metrics.supported_labels} {t.supported}</p><details className="jev-theme-list"><summary>{t.themes}</summary>{c.catalog.filter(key=>c.theme_axes[key]===axis).map(key=><article className="jev-theme-detail" key={key}><h4>{themeLabels[key]?.[language]??key}</h4><small className="jev-note">{key}</small>{(['positive','negative'] as const).map(sentiment=>{
        const label=c.theme_metrics['0.50'][key][sentiment],best=c.best_benchmark_threshold[`${key}_${sentiment}`]
        return <div key={sentiment}><strong>{common[sentiment]}</strong><p>{t.support} : {label.support_sol_reference??label.support_sol_v6} · F1 : {number(label.f1_vs_sol_reference)}</p>{!label.sufficient_support?<span className="jev-tag jev-warning">{t.low}</span>:<p className="jev-note">{common.precision} : {number(label.precision_vs_sol_reference)} · {common.recall} : {number(label.recall_vs_sol_reference)}</p>}{best&&<p className="jev-note">{t.best} : {number(best.threshold)} · F1 : {number(best.f1_vs_sol_reference)}</p>}</div>
      })}</article>)}</details></section>
    })}
    <section className="card jev-card"><h3>{t.verdict}</h3><span className="jev-tag">{c.verdict.quality==='excellent'?t.excellent:c.verdict.quality==='prometteur'?t.promising:c.verdict.quality==='insuffisant'?t.insufficient:t.unavailable}</span>{c.verdict.weak_axes.map(axis=><p className="jev-warning" key={axis}>{common[axis as 'service']} · {t.weak}</p>)}<p>{t.next}</p></section>
    <section className="card jev-card"><h3>{common.cost} / {common.time}</h3><dl className="jev-pairs"><dt>Jev</dt><dd>{number(c.jev.estimated_jev_cost_usd,6)} USD · {number(c.jev.elapsed_ms/1000,1)} s</dd><dt>Sol V{c.dataset.source_analysis_version??6}</dt><dd>{number(c.sol_v6_baseline.estimated_sol_baseline_cost_usd,6)} USD · {number(c.sol_v6_baseline.end_to_end_elapsed_ms/1000,1)} s</dd></dl><p className="jev-note">{common.estimate}. {c.dataset.source_analysis_version===7?language==='fr'?'Le coût Sol couvre le rapport V7 complet ; Jev mesure les thèmes seulement. Les durées couvrent des travaux différents.':'Chi phí Sol là của báo cáo V7 đầy đủ; Jev chỉ đo các chủ đề. Hai thời gian bao gồm khối lượng công việc khác nhau.':t.notes}</p><p className="jev-note">{common.served} : {c.jev.served_models.join(', ')}</p>{c.jev.multiple_served_models&&<p className="jev-warning">{common.multiple}</p>}</section>
    <details className="card jev-card jev-technical"><summary>{common.technical}</summary><dl className="jev-verdict"><dt>Benchmark ID</dt><dd>{run.id}</dd><dt>Source V{c.dataset.source_analysis_version??6}</dt><dd>{run.source_generation_id}</dd><dt>{common.requests} / {common.retries}</dt><dd>{run.request_count} / {run.retry_count}</dd><dt>{common.input} / {common.output}</dt><dd>{run.jev_input_tokens} / {run.jev_output_tokens}</dd><dt>HTTP p50 / p95 / max</dt><dd>{number(c.jev.individual_http_requests.p50_ms,0)} / {number(c.jev.individual_http_requests.p95_ms,0)} / {number(c.jev.individual_http_requests.max_ms,0)} ms</dd><dt>{t.drift} · moyenne / p95 / max</dt><dd>{number(c.stability.mean_probability_drift,4)} / {number(c.stability.p95_probability_drift,4)} / {number(c.stability.max_probability_drift,4)}</dd></dl><h4>{t.thresholds}</h4>{Object.entries(c.threshold_comparison).map(([threshold,m])=><p className="jev-note" key={threshold}>{threshold} · Micro F1 {number(m.micro_f1_all_supported_themes)} · Macro F1 {number(m.macro_f1_supported_themes)}</p>)}<p className="jev-note">{t.exploratory}</p>{c.errors?.map((e,i)=><p className="jev-note" key={i}>{e.review_alias} · {e.repeat} · {e.error_code}</p>)}</details>
  </div>
}
