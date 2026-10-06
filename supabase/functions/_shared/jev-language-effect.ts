import type {BenchmarkSource,ReviewDecisions} from './jev-benchmark.ts'
import {benchmarkText} from './analysis-text.ts'
import {THEME_KEYS,type ThemeDecision,type compareThemes} from './jev-themes.ts'

// Explicit reference requested for the Shabu language experiment. Never use 2B.
export const LANGUAGE_REFERENCE_ID='789ba38c-6f37-4ee9-ae5f-95ea767aee2e'
type Comparison=ReturnType<typeof compareThemes>
export interface LanguageReference {id:string;source_generation_id:string;source_analysis_version:number;benchmark_type:string;status:string;comparison:Comparison;decisions:ReviewDecisions<ThemeDecision>[]}
const difference=(a:number|null,b:number|null)=>a===null||b===null?null:b-a
const percent=(a:number,b:number)=>a?(b-a)/a*100:null
export function languageVerdict(delta:number|null,axes:{delta:number|null;sufficient_support:boolean}[]):'not_evaluable'|'strong_improvement'|'moderate_improvement'|'regression'|'neutral' {
  if(delta===null)return 'not_evaluable'
  if(delta>=.05&&!axes.some(a=>a.sufficient_support&&a.delta!==null&&a.delta<-.05))return 'strong_improvement'
  if(delta>=.02)return 'moderate_improvement'
  if(delta<=-.02)return 'regression'
  return 'neutral'
}
export function compareLanguageEffect(reference:LanguageReference,v6:BenchmarkSource,v7:BenchmarkSource,current:Comparison,decisions:ReviewDecisions<ThemeDecision>[],completed:boolean) {
  if(!completed||reference.status!=='completed')return null
  if(reference.benchmark_type!=='themes_phase2'||reference.source_analysis_version!==6||v6.snapshot.analysis_version!==6||v7.snapshot.analysis_version!==7||reference.source_generation_id!==v6.generation_id||v6.establishment_id!==v7.establishment_id||v6.organization_id!==v7.organization_id)throw new Error('SOURCE_LANGUAGE_REFERENCE_INVALID')
  const old=reference.comparison,a=new Set(v6.snapshot.reviews.map(r=>r.id)),b=new Set(v7.snapshot.reviews.map(r=>r.id)),common=[...a].filter(id=>b.has(id)),textA=new Set(v6.snapshot.reviews.filter(r=>benchmarkText(r,6).trim()).map(r=>r.id)),textB=new Set(v7.snapshot.reviews.filter(r=>benchmarkText(r,7).trim()).map(r=>r.id))
  const axes=Object.fromEntries(['service','quality','price','atmosphere'].map(axis=>{const x=old.axis_metrics[axis],y=current.axis_metrics[axis];return [axis,{v6_micro_f1:x.global_micro_f1,v7_micro_f1:y.global_micro_f1,delta:difference(x.global_micro_f1,y.global_micro_f1),sufficient_support:x.supported_labels>0&&y.supported_labels>0,v6_supported_labels:x.supported_labels,v7_supported_labels:y.supported_labels}]}))
  const themes=Object.fromEntries(THEME_KEYS.map(theme=>[theme,Object.fromEntries((['positive','negative'] as const).map(sentiment=>{
    const x=old.theme_metrics['0.50'][theme][sentiment],y=current.theme_metrics['0.50'][theme][sentiment],supported=x.support_sol_v6>=5&&y.support_sol_v6>=5
    const label=(m:typeof x)=>({support_sol_reference:m.support_sol_v6,precision_vs_sol_reference:m.precision_vs_sol_reference,recall_vs_sol_reference:m.recall_vs_sol_reference,f1_vs_sol_reference:m.f1_vs_sol_reference})
    return [sentiment,{v6:label(x),v7:label(y),sufficient_support_both:supported,delta:supported?difference(x.f1_vs_sol_reference,y.f1_vs_sol_reference):null}]
  }))]))
  const choices=Object.fromEntries(THEME_KEYS.map(theme=>[theme,{same_choice_count:0,different_choice_count:0,missing_choice_count:0,choice_agreement_percent:null as number|null}]))
  const oldDecisions=new Map(reference.decisions.map(d=>[d.review_id,d.repetitions])),newDecisions=new Map(decisions.map(d=>[d.review_id,d.repetitions]))
  const review_level_diffs:{review_id:string;theme:string;repeat:number;v6_choice:string;v7_choice:string}[]=[]
  const repeats=Math.min(old.jev.repeat_count,current.jev.repeat_count)
  for(const id of common.filter(id=>textA.has(id)&&textB.has(id)))for(const theme of THEME_KEYS)for(let repeat=0;repeat<repeats;repeat++) {
    const x=oldDecisions.get(id)?.[repeat]?.themes[theme]?.choice,y=newDecisions.get(id)?.[repeat]?.themes[theme]?.choice,c=choices[theme]
    if(!x||!y){c.missing_choice_count++;continue}
    if(x===y)c.same_choice_count++;else{c.different_choice_count++;review_level_diffs.push({review_id:id,theme,repeat:repeat+1,v6_choice:x,v7_choice:y})}
  }
  for(const c of Object.values(choices)){const n=c.same_choice_count+c.different_choice_count;c.choice_agreement_percent=n?c.same_choice_count/n*100:null}
  const micro=difference(old.micro_f1_all_supported_themes,current.micro_f1_all_supported_themes),stability=difference(old.stability.exact_theme_choice_stability_rate,current.stability.exact_theme_choice_stability_rate)
  const modelsA=[...new Set(old.jev.served_models)].sort(),modelsB=[...new Set(current.jev.served_models)].sort()
  return {v6_benchmark_id:reference.id,v6_source_generation_id:v6.generation_id,v7_source_generation_id:v7.generation_id,v6_source_analysis_version:6,v7_source_analysis_version:7,v6_input_mode:'original_language',v7_input_mode:'english_analysis',common_reviews:common.length,v6_reviews:a.size,v7_reviews:b.size,v6_only:a.size-common.length,v7_only:b.size-common.length,datasets_identical:a.size===common.length&&b.size===common.length,textual_common_reviews:common.filter(id=>textA.has(id)&&textB.has(id)).length,
    micro_f1_v6:old.micro_f1_all_supported_themes,micro_f1_v7:current.micro_f1_all_supported_themes,micro_f1_delta:micro,macro_f1_v6:old.macro_f1_supported_themes,macro_f1_v7:current.macro_f1_supported_themes,macro_f1_delta:difference(old.macro_f1_supported_themes,current.macro_f1_supported_themes),stability_v6:old.stability.exact_theme_choice_stability_rate,stability_v7:current.stability.exact_theme_choice_stability_rate,stability_delta:stability,axes,themes,choices,review_level_diffs,
    cost:{v6_input_tokens:old.jev.input_tokens,v7_input_tokens:current.jev.input_tokens,v6_output_tokens:old.jev.output_tokens,v7_output_tokens:current.jev.output_tokens,v6:old.jev.estimated_jev_cost_usd,v7:current.jev.estimated_jev_cost_usd,cost_delta:current.jev.estimated_jev_cost_usd-old.jev.estimated_jev_cost_usd,cost_delta_percent:percent(old.jev.estimated_jev_cost_usd,current.jev.estimated_jev_cost_usd)},
    latency:{v6_elapsed_ms:old.jev.elapsed_ms,v7_elapsed_ms:current.jev.elapsed_ms,elapsed_delta_ms:current.jev.elapsed_ms-old.jev.elapsed_ms,elapsed_delta_percent:percent(old.jev.elapsed_ms,current.jev.elapsed_ms)},
    served_models:{v6:modelsA,v7:modelsB,different:JSON.stringify(modelsA)!==JSON.stringify(modelsB)},parameters_match:old.jev.repeat_count===current.jev.repeat_count&&old.jev.concurrency===current.jev.concurrency&&old.jev.requested_model===current.jev.requested_model,
    language_effect_verdict:current.metrics_complete&&old.metrics_complete?languageVerdict(micro,Object.values(axes)):'not_evaluable',
    note:'Experimental comparison against each run’s own Sol reference; reference labels/support may differ. Choice agreement pairs the same repetition index on common textual reviews. Internal repeat stability is separate. Dataset/model/parameter differences are confounders; no causal claim or production switch.'}
}
