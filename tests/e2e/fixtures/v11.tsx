// Offline synthetic data only; all status/launch requests intercepted by Playwright.
import {createRoot} from 'react-dom/client'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {I18nProvider} from '../../../src/i18n'
import {HistoricalV11Test} from '../../../src/pages/HistoricalV11Test'
import {ConsultantReport} from '../../../src/components/ConsultantReport'
import {syntheticV8} from '../../fixtures/cross-rating-v8'
import {completeSyntheticTasks} from '../../fixtures/historical-v9'
import {syntheticV11} from '../../fixtures/historical-v11'
import {deriveV11,v11Costs,compareV11Sources} from '../../../supabase/functions/_shared/historical-v11-core'
import '../../../src/styles/global.css'
import '../../../src/styles/pages.css'
import '../../../src/styles/reference.css'
import '../../../src/styles/warm-theme.css'
import '../../../src/pages/JevBenchmarkPage.css'
const params=new URLSearchParams(location.search),language=params.get('language')==='vi'?'vi':'fr',h=syntheticV11();completeSyntheticTasks(h.tasks);const derived=deriveV11(h.reviews,h.tasks),cost=v11Costs({...h.usage,jev_theme_requests:291,jev_sentiment_requests:97,jev_input_tokens:38800,jev_output_tokens:3880,served_models:['jev-fixture'],narrative_state:'completed',sol_narrative_calls:1,sol_narrative_input_tokens:1000,sol_narrative_output_tokens:200},12000),report={...syntheticV8(language),version:11 as const,analysis_engine:'jev_hybrid_human_aligned' as const,analysis_unavailable_count:0,cross_rating_analysis:derived.cross_rating_analysis,human_aligned_analysis_pipeline:{...cost,unavailable_theme_reviews:0,source_generation_id:h.source.generation_id,source_snapshot_sha256:h.job.snapshot.source_snapshot_sha256},v11_comparison:compareV11Sources(h.source,h.comparison10,h.reviews,derived,cost,h.audit)}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}><I18nProvider language={language}><main className="page-frame">{params.get('phase')==='results'?<ConsultantReport report={report}/>:<div className="jev-page"><HistoricalV11Test user="mobile-v11-fixture" establishment="synthetic-establishment" name="Synthetic restaurant" visible/></div>}</main></I18nProvider></QueryClientProvider>)




