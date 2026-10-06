import { compareThemes,parseThemes,THEME_KEYS,type ThemeDecision } from '../../supabase/functions/_shared/jev-themes'
import { newBenchmarkState,type BenchmarkSource } from '../../supabase/functions/_shared/jev-benchmark'
import type { JevThemeRun } from '../../src/lib/jev-theme-benchmark'
// Synthetic rendering data only: no provider request and no database write.
const reviews=Array.from({length:6},(_,i)=>({id:'r'+i,original_text:'fixture',rating:5}))
const source:BenchmarkSource={generation_id:'382c46aa-2505-44de-8693-71ab1fa92d11',organization_id:'org',establishment_id:'shabu',status:'completed',model:'gpt-6.1-sol',snapshot:{analysis_version:6,reviews},classifications:reviews.map(r=>({review_id:r.id,sentiment:'positive'})),findings:reviews.flatMap((r,i)=>[{review_id:r.id,theme_key:'food_quality',sentiment:'positive'},...(i<5?[{review_id:r.id,theme_key:'price_level',sentiment:'negative'}]:[]),...(i===0?[{review_id:r.id,theme_key:'billing',sentiment:'negative'}]:[])]),input_tokens:12000,output_tokens:10000,token_usage_complete:true,started_at:'2026-10-05T00:00:00Z',completed_at:'2026-10-05T00:06:00Z'}
const options={repeat_count:3,concurrency:8,model:'jev-latest'},state=newBenchmarkState<ThemeDecision>(source,options)
for(let i=0;i<6;i++)for(let repeat=0;repeat<3;repeat++) {
  const answers=Object.fromEntries(THEME_KEYS.map(theme=>[theme,{type:'choice',choice:theme==='food_quality'?'positive':'absent',probabilities:{absent:theme==='food_quality'?0:1,positive:theme==='food_quality'?1:0,negative:0,both:0}}]))
  state.decisions[i].repetitions[repeat]=parseThemes({model:'jev-1.13.0',answers,usage:{input_tokens:100,output_tokens:25}}).decision
}
Object.assign(state,{served_models:['jev-1.13.0'],request_count:18,jev_input_tokens:10000,jev_output_tokens:2500,jev_elapsed_ms:5000,request_durations_ms:[100,120,180]})
export const themeResult:JevThemeRun={id:'22222222-2222-4222-8222-222222222222',benchmark_type:'themes_phase2',source_generation_id:source.generation_id,status:'completed',created_at:'2026-10-06T01:00:00Z',error_code:null,requested_model:'jev-latest',served_models:state.served_models,repeat_count:3,reviews_total:6,request_count:18,retry_count:0,jev_input_tokens:10000,jev_output_tokens:2500,comparison:compareThemes(source,state,options,{jev_input:.042,sol_input:2,sol_output:10})}
