import { compareService,parseService,SERVICE_KEYS,type Phase2Reference } from '../../supabase/functions/_shared/jev-service'
import { newBenchmarkState,type BenchmarkSource } from '../../supabase/functions/_shared/jev-benchmark'
import { THEME_KEYS,parseThemes,compareThemes,type ThemeDecision } from '../../supabase/functions/_shared/jev-themes'
import type { JevServiceRun } from '../../src/lib/jev-service-benchmark'
import { themeResult } from './jev-themes'
// Synthetic UI fixture, never persisted or submitted to any provider.
const reviews=Array.from({length:6},(_,i)=>({id:'r'+i,original_text:'fixture',rating:5}))
const source:BenchmarkSource={generation_id:themeResult.source_generation_id,organization_id:'org',establishment_id:'shabu',status:'completed',model:'gpt-6.1-sol',snapshot:{analysis_version:6,reviews},classifications:reviews.map(r=>({review_id:r.id,sentiment:'positive'})),findings:reviews.slice(0,5).flatMap(r=>['friendly_staff','attentiveness','professionalism','wait_time'].map(theme=>({review_id:r.id,theme_key:theme,sentiment:'positive'}))),input_tokens:1000,output_tokens:1000,token_usage_complete:true,started_at:'2026-10-05T00:00:00Z',completed_at:'2026-10-05T00:02:00Z'}
const options={repeat_count:3,concurrency:8,model:'jev-latest'},state=newBenchmarkState<ThemeDecision>(source,options)
for(let i=0;i<6;i++)for(let repeat=0;repeat<3;repeat++) {
  state.decisions[i].repetitions[repeat]=parseService({model:'jev-1.13.0',usage:{input_tokens:800,output_tokens:70},answers:Object.fromEntries(SERVICE_KEYS.map(theme=>{const positive=i<5 && ['friendly_staff','attentiveness','professionalism','wait_time'].includes(theme);return [theme,{type:'choice',choice:positive?'positive':'absent',probabilities:{absent:positive?0:1,positive:positive?1:0,negative:0,both:0}}]}))}).decision
}
Object.assign(state,{served_models:['jev-1.13.0'],request_count:18,jev_input_tokens:8000,jev_output_tokens:700,jev_elapsed_ms:4000})
const previousState=newBenchmarkState<ThemeDecision>(source,options)
for(let i=0;i<6;i++)for(let repeat=0;repeat<3;repeat++)previousState.decisions[i].repetitions[repeat]=parseThemes({model:'jev-1.13.0',usage:{input_tokens:1500,output_tokens:250},answers:Object.fromEntries(THEME_KEYS.map(theme=>{const positive=['attentiveness','professionalism'].includes(theme) || (i<5 && ['friendly_staff','wait_time'].includes(theme));return [theme,{type:'choice',choice:positive?'positive':'absent',probabilities:{absent:positive?0:1,positive:positive?1:0,negative:0,both:0}}]}))}).decision
Object.assign(previousState,{jev_input_tokens:10000,jev_elapsed_ms:19000})
const previous:Phase2Reference={id:themeResult.id,source_generation_id:source.generation_id,status:'completed',benchmark_type:'themes_phase2',comparison:compareThemes(source,previousState,options,{jev_input:.042,sol_input:2,sol_output:10})}
export const serviceResult:JevServiceRun={...themeResult,id:'33333333-3333-4333-8333-333333333333',benchmark_type:'themes_phase2b_service',request_count:18,retry_count:0,jev_input_tokens:8000,jev_output_tokens:700,comparison:compareService(source,state,options,{jev_input:.042,sol_input:2,sol_output:10},previous)}
