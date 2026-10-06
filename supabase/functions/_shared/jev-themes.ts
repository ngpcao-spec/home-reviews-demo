import { UNTRUSTED,parseUsage,type SystemOnePayload } from './jev.ts'
import { V6_THEME_AXES,type BenchmarkSource,type BenchmarkState,type BenchmarkOptions,type CostRates } from './jev-benchmark.ts'

// Exact V6 vocabulary. Tests compare keys/axes to the production CATALOG.
export const THEME_DEFINITIONS={
  food_quality:'general food quality, taste or flavor',freshness:'freshness of ingredients or food',cooking:'cooking or preparation, including overcooked or undercooked food',temperature:'food serving temperature, hot or cold dishes',portions:'quantity or portion size',presentation:'visual presentation of dishes',drinks:'drinks, coffee, cocktails or beverages served',variety:'menu variety, choice or dietary options',consistency:'consistency or inconsistency of food quality',
  friendly_staff:'welcome, friendliness or warmth of staff',attentiveness:'attention to customers, staff availability or customer care',wait_time:'waiting, slowness or speed of service',coordination:'service organization or coordination',communication:'communication with customers, explanations or understanding',order_accuracy:'order accuracy, wrong dishes or incorrect orders',professionalism:'professionalism or staff attitude',
  atmosphere:'general atmosphere or ambience',decor:'decoration, space or aesthetics',noise:'noise, quietness or sound level explicitly judged in the customer text',comfort:'physical comfort, seating, heat or air conditioning when judged as part of the experience',cleanliness:'cleanliness or hygiene',location:'location, access or ease of finding or reaching the place',
  value:'value for money',billing:'bill, fees, surcharges or billing errors',price_level:'expensive or inexpensive prices, or price level',
} as const
export type ThemeKey=keyof typeof THEME_DEFINITIONS
export const THEME_KEYS=Object.keys(THEME_DEFINITIONS) as ThemeKey[]
export const THEME_CHOICES=['absent','positive','negative','both'] as const
export type ThemeChoice=typeof THEME_CHOICES[number]
export interface ThemeAnswer {choice:ThemeChoice;probabilities:Record<ThemeChoice,number>}
export interface ThemeDecision {themes:Record<ThemeKey,ThemeAnswer>}
export function themePayload(model:string,review_alias:string,original_text:string):SystemOnePayload {
  return {model,state:{review_alias,original_text},questions:Object.fromEntries(THEME_KEYS.map(key=>[key,{type:'choice',instructions:`Determine whether the customer's ORIGINAL review text explicitly expresses an opinion about ${THEME_DEFINITIONS[key]}. Do not infer sentiment from stars, metadata, generic praise or assumptions. ${UNTRUSTED}`,criteria:{absent:'No explicit opinion about this theme.',positive:'Explicit positive opinion only about this theme.',negative:'Explicit negative opinion only about this theme.',both:'Explicit positive AND negative opinions about this theme in the same review.'}}]))}
}
export function parseThemes(raw:unknown) {
  const fail=()=>{throw new Error('JEV_INVALID_RESPONSE')}
  if(!raw || typeof raw!=='object' || Array.isArray(raw))return fail()
  const data=raw as Record<string,unknown>
  if(typeof data.model!=='string' || !data.model.trim() || !data.answers || typeof data.answers!=='object' || Array.isArray(data.answers))return fail()
  const answers=data.answers as Record<string,unknown>,themes={} as Record<ThemeKey,ThemeAnswer>
  for(const key of THEME_KEYS) {
    const rawAnswer=answers[key]
    if(!rawAnswer || typeof rawAnswer!=='object')return fail()
    const answer=rawAnswer as Record<string,unknown>
    if(answer.type!=='choice' || !THEME_CHOICES.includes(answer.choice as ThemeChoice) || !answer.probabilities || typeof answer.probabilities!=='object')return fail()
    const rawP=answer.probabilities as Record<string,unknown>,probabilities={} as Record<ThemeChoice,number>
    for(const choice of THEME_CHOICES) {
      const p=rawP[choice]
      if(typeof p!=='number' || !Number.isFinite(p) || p<0 || p>1)return fail()
      probabilities[choice]=p
    }
    if(Math.abs(Object.values(probabilities).reduce((a,b)=>a+b,0)-1)>.01)return fail()
    themes[key]={choice:answer.choice as ThemeChoice,probabilities}
  }
  return {model:data.model,usage:parseUsage(data.usage),decision:{themes}}
}
export function themePresence(answer:ThemeAnswer) {
  return {positive_presence:answer.choice==='positive' || answer.choice==='both',negative_presence:answer.choice==='negative' || answer.choice==='both',positive_presence_probability:answer.probabilities.positive+answer.probabilities.both,negative_presence_probability:answer.probabilities.negative+answer.probabilities.both}
}
export const supportLevel=(n:number):'high'|'medium'|'low'|'none'=>n>=20?'high':n>=5?'medium':n>=1?'low':'none'
const ratio=(n:number,d:number)=>d?n/d:null
const average=(v:number[])=>v.length?v.reduce((a,b)=>a+b,0)/v.length:null
export function binaryMetrics(tp:number,tn:number,fp:number,fn:number) {
  return {tp,tn,fp,fn,total_compared:tp+tn+fp+fn,agreement_with_sol_v6:ratio(tp+tn,tp+tn+fp+fn),precision_vs_sol_reference:ratio(tp,tp+fp),recall_vs_sol_reference:ratio(tp,tp+fn),f1_vs_sol_reference:ratio(2*tp,2*tp+fp+fn)}
}
type Counts=ReturnType<typeof binaryMetrics>
function pooled(rows:Counts[]) {return binaryMetrics(...(['tp','tn','fp','fn'] as const).map(k=>rows.reduce((a,r)=>a+r[k],0)) as [number,number,number,number])}
function drift(values:number[]) {
  const sorted=[...values].sort((a,b)=>a-b)
  return {mean_probability_drift:average(values),p95_probability_drift:sorted.length?sorted[Math.ceil(sorted.length*.95)-1]:null,max_probability_drift:sorted.at(-1)??null}
}
function duration(values:number[]) {
  const sorted=[...values].sort((a,b)=>a-b)
  return {count:values.length,mean_ms:average(values),p50_ms:sorted.length?sorted[Math.ceil(sorted.length*.5)-1]:null,p95_ms:sorted.length?sorted[Math.ceil(sorted.length*.95)-1]:null,max_ms:sorted.at(-1)??null}
}
export function themesVerdict(micro:number|null,macro:number|null,stability:number|null,complete=true):'excellent'|'prometteur'|'insuffisant'|'not_evaluable' {
  if(!complete || micro===null || macro===null || stability===null)return 'not_evaluable'
  if(micro>=.92 && macro>=.88 && stability>=.98)return 'excellent'
  if(micro>=.88 && macro>=.82 && stability>=.95)return 'prometteur'
  return 'insuffisant'
}
export function compareThemes(source:BenchmarkSource,state:BenchmarkState<ThemeDecision>,options:BenchmarkOptions,rates:CostRates) {
  const textual=source.snapshot.reviews.filter(r=>r.original_text?.trim()),decisions=new Map(state.decisions.map(r=>[r.review_id,r.repetitions]))
  const reference=new Set(source.findings.map(f=>`${f.review_id}:${f.theme_key}:${f.sentiment}`))
  const supports=Object.fromEntries(THEME_KEYS.map(theme=>[theme,Object.fromEntries(['positive','negative'].map(sentiment=>[sentiment,textual.filter(r=>reference.has(`${r.id}:${theme}:${sentiment}`)).length]))])) as Record<ThemeKey,Record<'positive'|'negative',number>>
  function labelCounts(theme:ThemeKey,sentiment:'positive'|'negative',repeat:number,threshold:number|'choice') {
    let tp=0,tn=0,fp=0,fn=0
    for(const r of textual) {
      const answer=decisions.get(r.id)?.[repeat]?.themes[theme]
      if(!answer)continue
      const p=themePresence(answer),prediction=threshold==='choice'?p[`${sentiment}_presence`]:p[`${sentiment}_presence_probability`]>=threshold,sol=reference.has(`${r.id}:${theme}:${sentiment}`)
      if(prediction){if(sol)tp++;else fp++}else{if(sol)fn++;else tn++}
    }
    return binaryMetrics(tp,tn,fp,fn)
  }
  const thresholds=[.5,.7,.8]
  function themeMetric(theme:ThemeKey,sentiment:'positive'|'negative',threshold:number) {
    const support=supports[theme][sentiment]
    const per_repeat=Array.from({length:options.repeat_count},(_,repeat)=>({repeat:repeat+1,...labelCounts(theme,sentiment,repeat,threshold)}))
    return {support_sol_v6:support,support_level:supportLevel(support),sufficient_support:support>=5,per_repeat,...pooled(per_repeat)}
  }
  const theme_metrics=Object.fromEntries(thresholds.map(threshold=>[threshold.toFixed(2),Object.fromEntries(THEME_KEYS.map(theme=>[theme,{positive:themeMetric(theme,'positive',threshold),negative:themeMetric(theme,'negative',threshold)}]))]))
  const supported=THEME_KEYS.flatMap(theme=>(['positive','negative'] as const).filter(sentiment=>supports[theme][sentiment]>=5).map(sentiment=>({theme,sentiment,axis:V6_THEME_AXES[theme]})))
  const axisKeys=['service','quality','price','atmosphere'] as const
  const threshold_comparison=Object.fromEntries(thresholds.map(threshold=>{
    const metrics=theme_metrics[threshold.toFixed(2)],labels=supported.map(l=>metrics[l.theme][l.sentiment]),micro=pooled(labels)
    const axes=Object.fromEntries(axisKeys.map(axis=>{
      const selected=supported.filter(l=>l.axis===axis)
      const bySentiment=(sentiment:'positive'|'negative')=>pooled(selected.filter(l=>l.sentiment===sentiment).map(l=>metrics[l.theme][l.sentiment])).f1_vs_sol_reference
      return [axis,{positive_micro_f1:bySentiment('positive'),negative_micro_f1:bySentiment('negative'),global_micro_f1:pooled(selected.map(l=>metrics[l.theme][l.sentiment])).f1_vs_sol_reference,supported_labels:selected.length,positive_supported_labels:selected.filter(l=>l.sentiment==='positive').length,negative_supported_labels:selected.filter(l=>l.sentiment==='negative').length}]
    }))
    return [threshold.toFixed(2),{micro_f1_all_supported_themes:micro.f1_vs_sol_reference,macro_f1_supported_themes:average(labels.map(l=>l.f1_vs_sol_reference).filter((n):n is number=>n!==null)),supported_labels:labels.length,counts:micro,axes}]
  }))
  const best_benchmark_threshold=Object.fromEntries(supported.map(l=>{
    const scored=thresholds.map(threshold=>({threshold,f1_vs_sol_reference:theme_metrics[threshold.toFixed(2)][l.theme][l.sentiment].f1_vs_sol_reference})).filter((v):v is {threshold:number;f1_vs_sol_reference:number}=>v.f1_vs_sol_reference!==null)
    scored.sort((a,b)=>b.f1_vs_sol_reference-a.f1_vs_sol_reference || a.threshold-b.threshold)
    return [`${l.theme}_${l.sentiment}`,scored[0]??null]
  }))
  const completeReviews=textual.filter(r=>decisions.get(r.id)?.filter(Boolean).length===options.repeat_count)
  const stableByAxis=Object.fromEntries(axisKeys.map(axis=>[axis,{pairs:0,stable:0,gaps:[] as number[]}]))
  for(const r of completeReviews)for(const theme of THEME_KEYS) {
    const answers=decisions.get(r.id)!.map(d=>d!.themes[theme]),axis=stableByAxis[V6_THEME_AXES[theme]]
    axis.pairs++;if(new Set(answers.map(a=>a.choice)).size===1)axis.stable++
    for(const sentiment of ['positive','negative'] as const) {
      const probs=answers.map(a=>themePresence(a)[`${sentiment}_presence_probability`])
      axis.gaps.push(Math.max(...probs)-Math.min(...probs))
    }
  }
  const allPairs=Object.values(stableByAxis).reduce((a,v)=>a+v.pairs,0),allStable=Object.values(stableByAxis).reduce((a,v)=>a+v.stable,0),gaps=Object.values(stableByAxis).flatMap(v=>v.gaps)
  const stability={exact_theme_choice_stability_rate:options.repeat_count>1?ratio(allStable,allPairs):null,complete_reviews:completeReviews.length,missing_reviews:textual.length-completeReviews.length,theme_review_pairs:allPairs,...drift(gaps),by_axis:Object.fromEntries(axisKeys.map(axis=>[axis,{exact_theme_choice_stability_rate:options.repeat_count>1?ratio(stableByAxis[axis].stable,stableByAxis[axis].pairs):null,theme_review_pairs:stableByAxis[axis].pairs,...drift(stableByAxis[axis].gaps)}])),note:'Choice equality across all repetitions per review/theme. Drift = max-min of each presence probability; p95 uses nearest rank. Missing repetitions excluded and flagged.'}
  const metrics_complete=state.errors.length===0 && completeReviews.length===textual.length
  const principal=threshold_comparison['0.50']
  const choice_presence_metrics=Object.fromEntries(THEME_KEYS.map(theme=>[theme,Object.fromEntries((['positive','negative'] as const).map(sentiment=>[sentiment,{support_sol_v6:supports[theme][sentiment],...pooled(Array.from({length:options.repeat_count},(_,repeat)=>labelCounts(theme,sentiment,repeat,'choice')))}]))]))
  return {benchmark_type:'themes_phase2' as const,scope:'theme-detection benchmark',reference:'Sol V6 findings are a reference, not ground truth.',catalog:THEME_KEYS,theme_axes:V6_THEME_AXES,
    dataset:{source_generation_id:source.generation_id,source_analysis_version:6,reviews_total:source.snapshot.reviews.length,reviews_with_text:textual.length,textless_review:source.snapshot.reviews.length-textual.length},
    jev:{requested_model:options.model,served_models:state.served_models,multiple_served_models:state.served_models.length>1,repeat_count:options.repeat_count,concurrency:options.concurrency,request_count:state.request_count,retry_count:state.retry_count,input_tokens:state.jev_input_tokens,output_tokens:state.jev_output_tokens,estimated_jev_cost_usd:state.jev_input_tokens/1_000_000*rates.jev_input,rate_used:rates.jev_input,cost_label:'ESTIMATION AU TARIF CONFIGURÉ',elapsed_ms:state.jev_elapsed_ms,individual_http_requests:duration(state.request_durations_ms),individual_evaluations_including_retries:duration(state.evaluation_durations_ms),usage_note:'API-returned tokens only; failed attempts without usage cannot be metered.'},
    sol_v6_baseline:{model:source.model,input_tokens:source.input_tokens,output_tokens:source.output_tokens,estimated_sol_baseline_cost_usd:(source.input_tokens*rates.sol_input+source.output_tokens*rates.sol_output)/1_000_000,end_to_end_elapsed_ms:Date.parse(source.completed_at)-Date.parse(source.started_at),rate_used:{input:rates.sol_input,output:rates.sol_output},scope:'Full Sol V6 extraction + narrative, including worker/cron orchestration.'},
    theme_metrics,choice_presence_metrics,threshold_comparison,best_benchmark_threshold,principal_threshold:.5,...principal,axis_metrics:principal.axes,stability,metrics_complete,errors:state.errors,
    verdict:{quality:themesVerdict(principal.micro_f1_all_supported_themes,principal.macro_f1_supported_themes,stability.exact_theme_choice_stability_rate,metrics_complete),weak_axes:axisKeys.filter(axis=>principal.axes[axis].supported_labels>0 && principal.axes[axis].global_micro_f1!==null && principal.axes[axis].global_micro_f1!<.8),cost:'Theme-detection benchmark only; not the final cost of a hybrid report.',latency:'Different workloads: Jev theme detection versus full Sol V6 end-to-end.',next_step:'Manual analysis of Shabu first. No automatic Artisan run, production switch, evidence extraction or Phase 3.'},
    aggregation:'TP/TN/FP/FN pooled across reviews × repetitions. Support = unique textual reviews with the Sol label, never multiplied by repeat_count. Micro/macro verdict exclude support < 5. Best threshold is exploratory on this snapshot; ties prefer 0.50 then 0.70.'}
}
