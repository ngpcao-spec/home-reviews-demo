import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {MemoryRouter} from 'react-router-dom'
import {afterEach,it,expect,vi} from 'vitest'
import {I18nProvider} from '../i18n'
import {PilotEvidenceV21Page,EvidenceV21Workspace} from './PilotEvidenceV21Page'
import {syntheticEvidenceV21View} from '../../tests/fixtures/pilot-evidence-v21'
import {restorableRoute} from '../lib/navigation-state'
const api=vi.hoisted(()=>vi.fn());const gate=vi.hoisted(()=>({data:true,isPending:false}))
vi.mock('../lib/pilot-evidence-v21',()=>({evidenceV21Api:api}))
vi.mock('../lib/use-jev-access',()=>({useJevAccess:()=>gate}))
vi.mock('../app/AppContext',()=>({useApp:()=>({currentUser:{id:'fixture-owner'},demoMode:false,notifications:[]})}))
const mount=(ui:React.ReactNode,lang:'fr'|'vi'='fr')=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}><MemoryRouter><I18nProvider language={lang}>{ui}</I18nProvider></MemoryRouter></QueryClientProvider>)
afterEach(()=>{cleanup();vi.clearAllMocks();gate.data=true})
it.each(['fr','vi'] as const)('%s clear statistics / evidence / recommendations, no independent validation claim and no paid report',async language=>{mount(<EvidenceV21Workspace data={await syntheticEvidenceV21View()} audit={async()=>{}}/>,language);expect(screen.getByRole('button',{name:language==='fr'?'Nouveau rapport Sol V2.1 — désactivé':'Báo cáo Sol V2.1 mới — chưa bật'})).toBeDisabled();expect(screen.getAllByText(language==='fr'?'Toutes les preuves requises sont présentes et soutenues par les règles':'Có đủ tất cả bằng chứng cần thiết, được quy tắc hỗ trợ')).toHaveLength(4);expect(screen.getByRole('heading',{name:language==='fr'?'Statistiques JEV — inchangées':'Số liệu JEV — giữ nguyên'})).toBeInTheDocument();expect(screen.getByText(language==='fr'?'Les quatre recommandations du rapport Sol existant restent à examiner. Elles ne sont ni corrigées ni validées rétroactivement.':'Bốn khuyến nghị trong báo cáo Sol cũ vẫn cần xem xét. Không sửa hoặc xác nhận lại báo cáo cũ.')).toBeInTheDocument()})
it('GET-only reload/refresh restores persistent V21 result and route',async()=>{api.mockResolvedValue(await syntheticEvidenceV21View());const first=mount(<PilotEvidenceV21Page/>);await screen.findByRole('heading',{name:'Statistiques JEV — inchangées'});fireEvent.click(screen.getByRole('button',{name:'Actualiser sans appel IA'}));await waitFor(()=>expect(api).toHaveBeenCalledTimes(2));first.unmount();mount(<PilotEvidenceV21Page/>);await screen.findByRole('heading',{name:'Statistiques JEV — inchangées'});expect(api.mock.calls.every(c=>c.length===1)).toBe(true);expect(restorableRoute('/plus/jev-pilot-evidence-v21')).toBe(true)})
it('manual free recompute double tap guarded',async()=>{const data=await syntheticEvidenceV21View();api.mockResolvedValueOnce({...data,record:null,preview:null});let resolve:(v:unknown)=>void=()=>{};api.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));mount(<PilotEvidenceV21Page/>);const b=await screen.findByRole('button',{name:'Recalculer gratuitement les preuves V2.1'});fireEvent.click(b);fireEvent.click(b);expect(api).toHaveBeenCalledTimes(2);expect(api.mock.calls[1]).toEqual(['fr',true]);resolve(data);await screen.findByRole('heading',{name:'Statistiques JEV — inchangées'})})
it('role denied receives no audit data',()=>{gate.data=false;mount(<PilotEvidenceV21Page/>);expect(api).not.toHaveBeenCalled();expect(screen.getByText(/Réservé aux propriétaires/)).toBeInTheDocument()})
