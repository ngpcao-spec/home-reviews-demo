import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {ParallelReports,type ParallelView} from '../../../src/components/ParallelReports'
import {I18nProvider} from '../../../src/i18n'
import {ConsultantReport} from '../../../src/components/ConsultantReport'
import {shabuReport} from '../../fixtures/consultant-v5'
import {parallelPresentationRow} from '../../fixtures/parallel-presentation'
import type {HistoricalReport} from '../../../src/lib/historical-report'
import '../../../src/styles/global.css'
import '../../../src/styles/pages.css'
import '../../../src/styles/warm-theme.css'
const language=new URLSearchParams(location.search).get('language')==='vi'?'vi':'fr'
const current={id:'mock-report',generationId:'mock-generation',organizationId:'mock-org',storedReviewsCount:7,generatedAt:'2026-10-20T00:00:00Z',aiStatus:'completed'} as HistoricalReport
const row=parallelPresentationRow(language),production=shabuReport(language)
const view={current:{id:current.id,generation_id:current.generationId!,state:'completed',generated_at:current.generatedAt,source_reviews:7,text_reviews:6,source_fingerprint:'MOCK'},corpus_reusable:true,unavailable_reason:null,experimental:row,run:null,tasks:[],operation:null} satisfies ParallelView
const client=new QueryClient();client.setQueryData(['parallel-reports','mock-account','mock-org','mock-report','mock-generation'],view)
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/analyses']}><I18nProvider language={language}><main className="page-frame"><p>EXPLICIT SYNTHETIC TEST — NO SUPPLIER</p><ParallelReports current={current} account="mock-account" enabled={false}><section className="card"><h2>CURRENT MOCK REPORT PRESERVED</h2><button onClick={e=>e.currentTarget.dataset.clicked='yes'}>CURRENT GENERATE MOCK</button></section><ConsultantReport report={production}/></ParallelReports></main></I18nProvider></MemoryRouter></QueryClientProvider>)
