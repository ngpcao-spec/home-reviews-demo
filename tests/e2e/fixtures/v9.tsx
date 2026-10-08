// Offline synthetic data only; all status/launch requests intercepted by Playwright.
import {createRoot} from 'react-dom/client'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {I18nProvider} from '../../../src/i18n'
import {HistoricalV9Test} from '../../../src/pages/HistoricalV9Test'
import {ConsultantReport} from '../../../src/components/ConsultantReport'
import {syntheticV8} from '../../fixtures/cross-rating-v8'
import {syntheticV9,completeSyntheticTasks} from '../../fixtures/historical-v9'
import {deriveV9,v9Costs,compareV8V9} from '../../../supabase/functions/_shared/historical-v9-core'
import '../../../src/styles/global.css'
import '../../../src/styles/pages.css'
import '../../../src/styles/reference.css'
import '../../../src/styles/warm-theme.css'
import '../../../src/pages/JevBenchmarkPage.css'
const params=new URLSearchParams(location.search),language=params.get('language')==='vi'?'vi':'fr',h=syntheticV9();completeSyntheticTasks(h.tasks);const derived=deriveV9(h.reviews,h.tasks),cost=v9Costs({...h.usage,jev_theme_requests:291,jev_sentiment_requests:97,jev_input_tokens:38800,jev_output_tokens:3880,served_models:['jev-fixture'],narrative_state:'completed',sol_narrative_calls:1,sol_narrative_input_tokens:1000,sol_narrative_output_tokens:200},12000),report={...syntheticV8(language),version:9 as const,analysis_engine:'jev_hybrid' as const,analysis_unavailable_count:0,cross_rating_analysis:derived.cross_rating_analysis,analysis_pipeline:{...cost,unavailable_theme_reviews:0,source_generation_id:h.source.generation_id,source_snapshot_sha256:h.job.snapshot.source_snapshot_sha256},v8_v9_comparison:compareV8V9(h.source as never,h.reviews,derived,cost)}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}><I18nProvider language={language}><main className="page-frame">{params.get('phase')==='results'?<ConsultantReport report={report}/>:<div className="jev-page"><HistoricalV9Test user="mobile-v9-fixture" establishment="synthetic-establishment" name="Synthetic restaurant" visible/></div>}</main></I18nProvider></QueryClientProvider>)
