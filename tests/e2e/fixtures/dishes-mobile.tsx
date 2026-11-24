import {createRoot} from 'react-dom/client'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {I18nProvider} from '../../../src/i18n'
import {AppShell} from '../../../src/components/ui/AppShell'
import {EstablishmentDetailPage} from '../../../src/pages/EstablishmentDetailPage'
import {EstablishmentsPage} from '../../../src/pages/EstablishmentsPage'
import {lang,banhId} from './dishes-stubs'
import '../../../src/styles/global.css'
import '../../../src/styles/pages.css'
import '../../../src/styles/reference.css'
import '../../../src/styles/warm-theme.css'
const params=new URLSearchParams(location.search)
const initial=params.has('search')?'/etablissements?plat='+encodeURIComponent(params.get('search')!):'/etablissements/'+banhId
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[initial]}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><I18nProvider language={lang}><p style={{margin:0,textAlign:'center',background:'#433726',color:'white',fontSize:12}}>TEST ISOLÉ · données sauvegardées / fournisseurs désactivés</p><Routes><Route element={<AppShell/>}><Route path="/etablissements/:id" element={<EstablishmentDetailPage/>}/><Route path="/etablissements" element={<EstablishmentsPage/>}/></Route></Routes></I18nProvider></QueryClientProvider></MemoryRouter>)
