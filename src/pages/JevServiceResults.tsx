import { useI18n } from '../i18n'
import { jevMessages } from '../i18n/jev'
import { themeMessages,themeLabels } from '../i18n/jev-themes'
import { serviceMessages } from '../i18n/jev-service'
import type { JevServiceRun } from '../lib/jev-service-benchmark'

export function JevServiceResults({run}:{run:JevServiceRun}) {
  const {language}=useI18n(),t=serviceMessages[language],common=jevMessages[language],themes=themeMessages[language],c=run.comparison,p=c.phase2_comparison
  const number=(v:number|null|undefined,digits=3)=>typeof v==='number' && Number.isFinite(v)?v.toLocaleString(language==='fr'?'fr-FR':'vi-VN',{minimumFractionDigits:digits,maximumFractionDigits:digits}):'—'
  const delta=(v:number|null|undefined)=>typeof v==='number'?(v>=0?'+':'')+number(v):'—'
  const percent=(v:number|null|undefined)=>typeof v==='number'?number(v*100,1)+' %':'—'
  const comparable=p.comparable && p.source_generation_id===run.source_generation_id
  const old=(v:number|null|undefined,digits=3)=>comparable?number(v,digits):'—'
  const gain=(v:number|null|undefined)=>comparable?delta(v):'—'
  return <div className="jev-results jev-service-results">
    {!c.metrics_complete&&<p className="jev-warning" role="alert">{common.partial}</p>}
    {!comparable&&<p className="jev-warning" role="alert">{t.noComparison}</p>}
    <section className="card jev-card"><h3>{common.service} · {themes.micro}</h3><div className="jev-theme-kpis"><div><small>{t.before}</small><strong>{old(p.phase2_service_micro_f1)}</strong></div><div><small>{t.after}</small><strong>{number(c.service_micro_f1_supported)}</strong></div><div><small>{t.gain}</small><strong>{gain(p.absolute_difference)}</strong></div></div><dl className="jev-pairs"><dt>{common.positive}</dt><dd>{number(c.service_positive_micro_f1)}</dd><dt>{common.negative}</dt><dd>{number(c.service_negative_micro_f1)}</dd><dt>{common.stability}</dt><dd>{percent(c.stability.exact_theme_choice_stability_rate)}</dd></dl><p className="jev-note">{themes.threshold}. {themes.supportNote}</p></section>
    {(['friendly_staff','attentiveness','professionalism','wait_time'] as const).map(key=>{
      const target=p.target_themes[key]
      return <section className="card jev-card" key={key} data-service-target={key}><h3>{themeLabels[key][language]} · {common.positive.toLowerCase()}</h3><p>{t.before} {old(target.phase2_f1)} → {t.after} <strong>{number(target.phase2b_f1)}</strong></p><p className="jev-highlight">{t.gain} : {gain(target.absolute_difference)}</p><p className="jev-note">{themes.support} : {target.support_sol_v6}</p>{target.support_sol_v6<5&&<span className="jev-tag jev-warning">{themes.low}</span>}<dl className="jev-axis-metrics"><div><dt>{common.precision}</dt><dd>{number(target.precision_vs_sol_reference)}</dd></div><div><dt>{common.recall}</dt><dd>{number(target.recall_vs_sol_reference)}</dd></div><div><dt>F1</dt><dd>{number(target.phase2b_f1)}</dd></div></dl>{['attentiveness','professionalism'].includes(key)&&<p className="jev-note">{t.before} · {common.precision} {old(target.phase2_precision)} · {common.recall} {old(target.phase2_recall)}. {t.precisionNote}</p>}<p className="jev-note">{common.stability} : {percent(c.stability.by_theme[key].exact_theme_choice_stability_rate)}</p></section>
    })}
    <section className="card jev-card"><h3>{t.nonRegression}</h3>{Object.entries(p.non_regression).map(([key,check])=><p className={check.passed===false?'jev-warning':'jev-note'} key={key}>{themeLabels[key.replace(/_(positive|negative)$/, '')]?.[language]??key} · {key.endsWith('_negative')?common.negative:common.positive} · {!check.assessed?t.notAssessed:check.passed?t.passed:t.regressed}</p>)}</section>
    <section className="card jev-card"><h3>{common.verdict}</h3><span className="jev-tag">{c.verdict.quality==='VERY_GOOD'?t.veryGood:c.verdict.quality==='SUCCESS'?t.success:t.needsReview}</span><p>{t.next}</p></section>
    <section className="card jev-card"><h3>{common.cost} / {common.time}</h3><dl className="jev-verdict"><dt>{t.before}</dt><dd>{old(p.phase2_cost_usd,6)} USD · {p.phase2_elapsed_ms===null?'—':old(p.phase2_elapsed_ms/1000,1)} s</dd><dt>{t.after}</dt><dd>{number(c.jev.estimated_jev_cost_usd,6)} USD · {number(c.jev.elapsed_ms/1000,1)} s</dd><dt>{common.input} / {common.output}</dt><dd>{run.jev_input_tokens} / {run.jev_output_tokens}</dd><dt>{common.requests} / {common.retries}</dt><dd>{run.request_count} / {run.retry_count}</dd><dt>{common.served}</dt><dd>{c.jev.served_models.join(', ')}</dd></dl><p className="jev-note">{t.costNote}</p>{c.jev.multiple_served_models&&<p className="jev-warning">{common.multiple}</p>}</section>
    <details className="card jev-card jev-technical"><summary>{themes.themes} · 7</summary>{c.catalog.map(key=><article className="jev-theme-detail" key={key}><h4>{themeLabels[key]?.[language]??key}</h4>{(['positive','negative'] as const).map(sentiment=>{
      const label=c.theme_metrics['0.50'][key][sentiment],best=c.best_benchmark_threshold[`${key}_${sentiment}`]
      return <div key={sentiment}><strong>{common[sentiment]}</strong><p>{themes.support} : {label.support_sol_v6} · F1 {number(label.f1_vs_sol_reference)}</p>{label.support_sol_v6<5&&<span className="jev-tag jev-warning">{themes.low}</span>}<p className="jev-note">{common.precision} {number(label.precision_vs_sol_reference)} · {common.recall} {number(label.recall_vs_sol_reference)}</p>{best&&<p className="jev-note">{themes.best} : {number(best.threshold,2)} · F1 {number(best.f1_vs_sol_reference)}</p>}</div>
    })}</article>)}<p className="jev-note">{themes.exploratory}</p></details>
    <details className="card jev-card jev-technical"><summary>{common.technical}</summary><dl className="jev-verdict"><dt>Benchmark ID</dt><dd>{run.id}</dd><dt>Source V6</dt><dd>{run.source_generation_id}</dd><dt>{t.before} · ID</dt><dd>{p.benchmark_id??'—'}</dd><dt>{t.version}</dt><dd>{c.question_set_version}</dd><dt>{themes.drift} · mean / p95 / max</dt><dd>{number(c.stability.mean_probability_drift,4)} / {number(c.stability.p95_probability_drift,4)} / {number(c.stability.max_probability_drift,4)}</dd></dl>{c.errors?.map((e,i)=><p className="jev-note" key={i}>{e.review_alias} · {e.repeat} · {e.error_code}</p>)}</details>
  </div>
}
