import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {ParallelReports,type ParallelView} from '../../../src/components/ParallelReports'
import {I18nProvider} from '../../../src/i18n'
import type {HistoricalReport} from '../../../src/lib/historical-report'
import '../../../src/styles/global.css'
import '../../../src/styles/pages.css'
import '../../../src/styles/warm-theme.css'
const language=new URLSearchParams(location.search).get('language')==='vi'?'vi':'fr'
const current={id:'mock-report',generationId:'mock-generation',organizationId:'mock-org',storedReviewsCount:7,generatedAt:'2026-10-20T00:00:00Z',aiStatus:'completed'} as HistoricalReport
const categories=['service','price','quality','ambiance'],evidence=categories.map(category=>({evidence_id:category,review_id:category,quote:'EXPLICIT SYNTHETIC CUSTOMER TEXT: Good food, staff, prices and room.'}))
const view={current:{id:current.id,generation_id:current.generationId!,state:'completed',generated_at:current.generatedAt,source_reviews:7,text_reviews:6,source_fingerprint:'MOCK'},corpus_reusable:true,unavailable_reason:null,
 experimental:{id:'mock-derived',created_at:'2026-10-21T00:00:00Z',state:'completed',error_code:null,generated_at:'2026-10-21T00:00:00Z',original_report:{marker:'EXPLICIT ORIGINAL MOCK'},raw_response:{marker:'EXPLICIT MOCK'},corrections:[],controls:{technical_checks_passed:true,evidence},usage:{jev:0,luna:0,sol:0},
 source_reviews:categories.map(id=>({id,analysis_text:evidence[0].quote,original_text:'EXPLICIT ORIGINAL SYNTHETIC TEXT'})),statistics:{scope:{source_reviews:7,analysed_text_reviews:6,textless_statistics_only:1},counts:{categories:{}}},
 derived_report:{format_version:'jls-direct-categories4-report-v1',report:{categories:categories.map(category=>({category,text:language==='fr'?'Exemple synthétique de synthèse : corpus favorable avec une observation à vérifier.':'Ví dụ tổng hợp giả lập: bộ đánh giá nhìn chung tích cực, có một phản ánh cần kiểm tra.',evidence_ids:[category]})),positive_aspects:[],negative_aspects:[],conclusion:{text:language==='fr'?'Conclusion synthétique, aucun appel IA.':'Kết luận giả lập, không gọi AI.',evidence_ids:['service']},recommendations:[{title:language==='fr'?'Vérifier le cas rapporté':'Kiểm tra trường hợp được phản ánh',category:'service',evidence_ids:['service'],observations:[{text:'EXPLICIT SYNTHETIC OBSERVATION',evidence_id:'service',quote:evidence[0].quote}],proposed_action:'EXPLICIT SYNTHETIC PROPOSAL',priority_reason:'EXPLICIT SYNTHETIC PRIORITY'}]}}},run:null,tasks:[],operation:null} satisfies ParallelView
const client=new QueryClient();client.setQueryData(['parallel-reports','mock-account','mock-org','mock-report','mock-generation'],view)
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/analyses']}><I18nProvider language={language}><main className="page-frame"><p>EXPLICIT SYNTHETIC TEST — NO SUPPLIER</p><ParallelReports current={current} account="mock-account" enabled={false}><section className="card"><h2>CURRENT MOCK REPORT PRESERVED</h2><button onClick={e=>e.currentTarget.dataset.clicked='yes'}>CURRENT GENERATE MOCK</button></section></ParallelReports></main></I18nProvider></MemoryRouter></QueryClientProvider>)
