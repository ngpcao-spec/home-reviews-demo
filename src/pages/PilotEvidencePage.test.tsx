import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {MemoryRouter} from 'react-router-dom'
import {afterEach,it,expect,vi} from 'vitest'
import {I18nProvider} from '../i18n'
import {PilotEvidencePage,PilotEvidenceEntry,EvidenceWorkspace} from './PilotEvidencePage'
import {syntheticEvidenceView} from '../../tests/fixtures/pilot-evidence'
import {restorableRoute} from '../lib/navigation-state'
const api=vi.hoisted(()=>vi.fn());const gate=vi.hoisted(()=>({data:true,isPending:false}))
vi.mock('../lib/pilot-evidence',()=>({evidenceApi:api}))
vi.mock('../lib/use-jev-access',()=>({useJevAccess:()=>gate}))
vi.mock('../app/AppContext',()=>({useApp:()=>({currentUser:{id:'fixture-owner'},demoMode:false,notifications:[]})}))
const mount=(ui:React.ReactNode,language:'fr'|'vi'='fr')=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}><MemoryRouter><I18nProvider language={language}>{ui}</I18nProvider></MemoryRouter></QueryClientProvider>)
afterEach(()=>{cleanup();vi.clearAllMocks();gate.data=true})
it('entry route restored and no provider or audit started',()=>{mount(<PilotEvidenceEntry/>);expect(screen.getByRole('link')).toHaveAttribute('href','/plus/jev-pilot-evidence');expect(restorableRoute('/plus/jev-pilot-evidence')).toBe(true);expect(api).not.toHaveBeenCalled()})
it.each(['fr','vi'] as const)('FR/VI %s compares previous and new proof excerpts, never calls it human validation',async language=>{mount(<EvidenceWorkspace data={await syntheticEvidenceView()} audit={async()=>{}}/>,language);expect(screen.getByRole('button',{name:language==='fr'?'Générer un rapport avec les preuves V2 — non activé':'Tạo báo cáo dùng bằng chứng V2 — chưa bật'})).toBeDisabled();expect(screen.getByText(language==='fr'?'La difficulté de compréhension ne prouve pas un manque d’attention.':'Khó khăn khi hiểu không chứng minh việc thiếu quan tâm.')).toBeInTheDocument();expect(screen.getByText(language==='fr'?'Un emplacement peu remarquable ne prouve pas un accès difficile.':'Vị trí không nổi bật không chứng minh việc khó tiếp cận.')).toBeInTheDocument();expect(screen.getByText(/ni une validation humaine|không phải xác nhận thủ công/)).toBeInTheDocument()})
it('GET and reload restore immutable audit without calling POST',async()=>{api.mockResolvedValue(await syntheticEvidenceView());const first=mount(<PilotEvidencePage/>);await screen.findByText('Périmètre contrôlé');expect(api).toHaveBeenCalledExactlyOnceWith('fr');fireEvent.click(screen.getByRole('button',{name:'Actualiser sans appel IA'}));await waitFor(()=>expect(api).toHaveBeenCalledTimes(2));first.unmount();mount(<PilotEvidencePage/>);await screen.findByText('Périmètre contrôlé');expect(api.mock.calls.every(c=>c.length===1)).toBe(true)})
it('manual free audit double tap guarded; no report action',async()=>{const data=await syntheticEvidenceView();api.mockResolvedValueOnce({...data,record:null,packet:null});let resolve:(v:unknown)=>void=()=>{};api.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));mount(<PilotEvidencePage/>);const b=await screen.findByRole('button',{name:'Vérifier les preuves gratuitement'});fireEvent.click(b);fireEvent.click(b);expect(api).toHaveBeenCalledTimes(2);expect(api.mock.calls[1]).toEqual(['fr',true]);resolve(data);await screen.findByText('Périmètre contrôlé')})
it('role denied cannot fetch proof data',()=>{gate.data=false;mount(<PilotEvidencePage/>);expect(api).not.toHaveBeenCalled();expect(screen.getByText(/Réservé aux propriétaires/)).toBeInTheDocument()})
