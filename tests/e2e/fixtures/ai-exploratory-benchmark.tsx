// Offline synthetic fixtures only. No source data, provider, or real experiment.
import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {I18nProvider} from '../../../src/i18n'
import {AiBenchmarkWorkspace} from '../../../src/pages/AiExploratoryBenchmarkPage'
import {ExploratoryWorkspace} from '../../../src/pages/JevExploratoryPage'
import {syntheticNegative,syntheticNegativeTasks} from '../../fixtures/negative-validation'
import {prepareAiBenchmark,scoreAiBenchmark,type AiPreannotation,type AiBenchmarkRun} from '../../../supabase/functions/_shared/ai-exploratory-benchmark'
import {EXPLORATORY_CONFIG} from '../../../supabase/functions/_shared/jev-exploratory-core'
import {exploratoryProjection} from '../../../supabase/functions/_shared/jev-exploratory-api'
import {THEME_KEYS} from '../../../supabase/functions/_shared/jev-themes'
import {NEGATIVE_MODEL_CONFIG} from '../../../supabase/functions/_shared/negative-validation-score'
import type {AiBenchmarkView} from '../../../src/lib/ai-exploratory-benchmark'
import '../../../src/styles/global.css'
import '../../../src/styles/pages.css'
import '../../../src/styles/reference.css'
import '../../../src/styles/warm-theme.css'
const language=new URLSearchParams(location.search).get('language')==='vi'?'vi':'fr',h=await syntheticNegative(),reference:AiPreannotation[]=h.items.map(i=>({review_id:i.review_id,analysis_text_sha256:i.analysis_text_sha256!,model_source:'chatgpt-fixture-v1',rubric_version:'human-aligned-review-rubric-v1',created_at:'2026-10-09T00:00:00Z',theme_choices:Object.fromEntries(THEME_KEYS.map(k=>[k,k==='temperature'||k==='wait_time'?'negative':'absent'])) as AiPreannotation['theme_choices']})),p=await prepareAiBenchmark(h.items,reference,[]),run:AiBenchmarkRun={id:h.run.id,source_experiment_id:h.run.id,organization_id:h.run.organization_id,establishment_id:h.run.establishment_id,status:'completed',dataset_snapshot:p.items,reference_snapshot:p.reference,model_config:NEGATIVE_MODEL_CONFIG,dataset_sha256:p.dataset_sha256,reference_sha256:p.reference_sha256,input_rate_usd_per_million:.042,created_at:h.run.created_at,started_at:'2026-10-09T00:00:00Z',completed_at:'2026-10-09T00:01:00Z',error_code:null},comparison=scoreAiBenchmark(run,syntheticNegativeTasks(h)),saved=localStorage.getItem('dual-fixture')
export function Demo(){const [done,setDone]=useState(!!saved),[reviewing,setReviewing]=useState(saved==='review'),data:AiBenchmarkView={source_experiment_id:run.source_experiment_id,run:done?{id:run.id,status:'completed',created_at:run.created_at,error_code:null}:null,ready:true,eligibility_error:null,english_ready:32,reference_reviews:32,reference_labels:800,reference_models:['chatgpt-fixture-v1'],reference_type:'chatgpt_ai_preannotations',human_validated:false,comparison:done?comparison:null,progress:{total:done?192:0,completed:done?192:0,failed:0}},suspects=exploratoryProjection({id:run.id,source_kind:'negative_validation',source_id:run.source_experiment_id,organization_id:run.organization_id,establishment_id:run.establishment_id,status:'completed',config:EXPLORATORY_CONFIG,dataset_sha256:run.dataset_sha256,rate:.042,created_at:run.created_at,started_at:null,completed_at:null,error_code:null,locked_by:null},comparison.reviews,[],[],[],null)
 return <main className="page-frame"><div className="jev-page gold-page exploratory-page">{reviewing?<ExploratoryWorkspace data={suspects} busy={false} action={async()=>suspects}/>:<AiBenchmarkWorkspace data={data} busy={false} start={async()=>{localStorage.setItem('dual-fixture','completed');setDone(true)}} review={async()=>{localStorage.setItem('dual-fixture','review');setReviewing(true)}}/>}</div></main>}
createRoot(document.getElementById('root')!).render(<MemoryRouter><I18nProvider language={language}><Demo/></I18nProvider></MemoryRouter>)
