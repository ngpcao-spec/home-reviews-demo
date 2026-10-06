// Synthetic visual fixture only. Never a real benchmark result.
import {themeResult} from './jev-themes'
import {compareLanguageEffect,type LanguageReference} from '../../supabase/functions/_shared/jev-language-effect'
import type {BenchmarkSource} from '../../supabase/functions/_shared/jev-benchmark'
import type {compareThemes} from '../../supabase/functions/_shared/jev-themes'
import type {JevThemeRun} from '../../src/lib/jev-theme-benchmark'
const a=structuredClone(themeResult.comparison) as ReturnType<typeof compareThemes>,b=structuredClone(a)
a.micro_f1_all_supported_themes=.8;b.micro_f1_all_supported_themes=.94;a.macro_f1_supported_themes=.84;b.macro_f1_supported_themes=.9
a.axis_metrics.service.global_micro_f1=.65;b.axis_metrics.service.global_micro_f1=.95
a.jev.served_models=['jev-old'];b.jev.served_models=['jev-new'];b.dataset.source_analysis_version=7
for(const key of ['friendly_staff','attentiveness','professionalism','wait_time'] as const){Object.assign(a.theme_metrics['0.50'][key].positive,{support_sol_v6:5,precision_vs_sol_reference:.3,recall_vs_sol_reference:1,f1_vs_sol_reference:.5});Object.assign(b.theme_metrics['0.50'][key].positive,{support_sol_v6:6,precision_vs_sol_reference:.9,recall_vs_sol_reference:1,f1_vs_sol_reference:.95})}
const source={generation_id:'fixture-v6',organization_id:'fixture-org',establishment_id:'fixture-est',snapshot:{analysis_version:6,reviews:Array.from({length:6},(_,i)=>({id:'r'+i,original_text:'synthetic',rating:5}))}} as BenchmarkSource
const next={...source,generation_id:'fixture-v7',snapshot:{analysis_version:7,reviews:source.snapshot.reviews.map(r=>({...r,analysis_text:'synthetic English'}))}}
const reference={id:'fixture-reference',source_generation_id:source.generation_id,source_analysis_version:6,benchmark_type:'themes_phase2',status:'completed',comparison:a,decisions:[]} as LanguageReference
export const languageThemeResult:JevThemeRun={...themeResult,source_generation_id:next.generation_id,comparison:{...b,language_effect:compareLanguageEffect(reference,source,next,b,[],true)}}
