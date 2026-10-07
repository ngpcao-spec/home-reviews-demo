// Synthetic fixture; all Supabase requests are intercepted by the browser test.
import {createRoot} from 'react-dom/client'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {I18nProvider} from '../../../src/i18n'
import {ConsultantReport} from '../../../src/components/ConsultantReport'
import {HistoricalV8Test} from '../../../src/pages/HistoricalV8Test'
import {syntheticV8} from '../../fixtures/cross-rating-v8'
import '../../../src/styles/global.css'
import '../../../src/styles/pages.css'
import '../../../src/styles/reference.css'
import '../../../src/styles/warm-theme.css'
import '../../../src/pages/JevBenchmarkPage.css'
const params=new URLSearchParams(location.search),language=params.get('language')==='vi'?'vi':'fr',report=syntheticV8(language)
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}><I18nProvider language={language}><main className="page-frame">{params.get('phase')==='start'?<div className="jev-page"><HistoricalV8Test user="mobile-fixture" establishment="synthetic-establishment" name="Synthetic restaurant" coverage={{stored_reviews:6,reviews_with_text:5,original_english:5,english_translation_found:0,english_translation_missing:0,coverage_percent:100}} visible/></div>:<ConsultantReport report={report}/>}</main></I18nProvider></QueryClientProvider>)
