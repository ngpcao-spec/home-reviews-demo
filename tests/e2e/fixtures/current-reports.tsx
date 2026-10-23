import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {CurrentReports,type CurrentReportsView} from '../../../src/components/CurrentReports'
import {I18nProvider} from '../../../src/i18n'
import {parallelPresentationRow} from '../../fixtures/parallel-presentation'
import '../../../src/styles/global.css'
import '../../../src/styles/pages.css'
import '../../../src/styles/warm-theme.css'
const language=new URLSearchParams(location.search).get('language')==='vi'?'vi':'fr'
const row=parallelPresentationRow(language);row.current_source_run_id='SYNTHETIC_SOURCE'
const view={routing:{engine:'jev_sol_v2',updated_at:'2026-10-23'},legacy_report:null,versions:[{id:row.id,created_at:row.created_at,generated_at:row.generated_at,state:row.state,current_source_run_id:row.current_source_run_id}],experimental:row,run:null,tasks:[],operation:null} satisfies CurrentReportsView
const client=new QueryClient({defaultOptions:{queries:{staleTime:Infinity}}});client.setQueryData(['current-reports','mock-account','mock-est',language,''],view)
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/analyses']}><I18nProvider language={language}><main className="page-frame"><p>EXPLICIT SYNTHETIC TEST — NO SUPPLIER</p><CurrentReports establishmentId="mock-est" account="mock-account" languageKey={language} current={null} enabled={false} generating={false} generationAction={<button onClick={e=>e.currentTarget.dataset.clicked='yes'}>NORMAL GENERATE MOCK</button>}><p>LEGACY SOL PRESERVED</p></CurrentReports></main></I18nProvider></MemoryRouter></QueryClientProvider>)
