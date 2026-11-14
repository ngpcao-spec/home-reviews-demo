import {AppShell} from '../../../src/components/ui/AppShell'
import {createRoot} from 'react-dom/client'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {I18nProvider} from '../../../src/i18n'
import {AnalyticsPage} from '../../../src/pages/AnalyticsPage'
import {parallelPresentationRow} from '../../fixtures/parallel-presentation'
import {lang,state} from './analysis-stubs'
import '../../../src/styles/global.css'
import '../../../src/styles/pages.css'
import '../../../src/styles/reference.css'
import '../../../src/styles/warm-theme.css'
const q=new QueryClient({defaultOptions:{queries:{enabled:false,retry:false}}}),row=parallelPresentationRow(lang)
row.derived_report!.report.conclusion.text=lang==='fr'?'Une cuisine appréciée et un accueil chaleureux. Les avis signalent toutefois une attente plus longue aux heures de pointe.':'Ẩm thực được đánh giá cao và đón tiếp niềm nở. Tuy nhiên, khách phản ánh thời gian chờ lâu hơn vào giờ cao điểm.'
q.setQueryData(['current-reports','fixture-account','fixture',lang,''],{routing:{engine:'jev_sol_v2'},experimental:state==='none'?null:row,versions:[],shared_versions:state==='none'?[]:[{id:row.id,language:lang,generated_at:row.generated_at}],run:null,request_run:null,tasks:[],refresh:{enabled:true,reference_usable:state!=='none',new_reviews:state==='fresh'?0:14,negative_reviews:state==='fresh'?0:1,state:state==='running'?'in_progress':state==='failed'?'failed':'waiting'},retention:{policy:{enabled:true},state:{retained_count:150,period_start:'2026-09-01',period_end:'2026-11-14'},scope:state==='none'?null:{as_of:row.generated_at,review_count:150,period_start:'2026-09-01',period_end:'2026-10-21',stale:state!=='fresh'}}})
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/analyses?establishment=fixture&mode=historical']}><QueryClientProvider client={q}><I18nProvider language={lang}><Routes><Route element={<AppShell/>}><Route path="/analyses" element={<AnalyticsPage/>}/></Route></Routes></I18nProvider></QueryClientProvider></MemoryRouter>)
