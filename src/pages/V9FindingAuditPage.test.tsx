import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {MemoryRouter,useLocation} from 'react-router-dom'
import {afterEach,it,expect,vi} from 'vitest'
import {I18nProvider} from '../i18n'
import {FindingAuditEntry,V9FindingAuditPage} from './V9FindingAuditPage'
import {syntheticFindingAudit} from '../../tests/fixtures/v9-finding-audit'
import {findingAuditProjection} from '../../supabase/functions/_shared/v9-finding-audit-api'
const api=vi.hoisted(()=>vi.fn())
const access=vi.hoisted(()=>({data:true,isPending:false}))
vi.mock('../lib/v9-finding-audit',()=>({findingAuditApi:api}));vi.mock('../lib/use-jev-access',()=>({useJevAccess:()=>access}));vi.mock('../app/AppContext',()=>({useApp:()=>({currentUser:{id:'synthetic-user'},demoMode:false,notifications:[]})}));vi.mock('../components/ui/PageHeader',()=>({PageHeader:({title}:{title:string})=><header>{title}</header>}))
afterEach(()=>{cleanup();vi.clearAllMocks();localStorage.clear();access.data=true})
function Location(){const p=useLocation();return <output>{p.pathname+p.search}</output>}
function mount(entry=true){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}><MemoryRouter initialEntries={['/plus/v9-finding-audit']}><I18nProvider language="fr">{entry?<FindingAuditEntry/>:<V9FindingAuditPage/>}<Location/></I18nProvider></MemoryRouter></QueryClientProvider>)}
it('entry performs read-only discovery; explicit double tap creates one audit and navigates',async()=>{const f=await syntheticFindingAudit();api.mockImplementation(async(_id,action)=>action?findingAuditProjection(f.audit,f.items,[],f.bundle,true):{eligible:true,audit:null,items:[]});mount();const start=await screen.findByRole('button',{name:'Commencer le contrôle'});await waitFor(()=>expect(start).toBeEnabled());expect(api.mock.calls.every(c=>c[1]===undefined)).toBe(true);fireEvent.click(start);fireEvent.click(start);await screen.findByText('/plus/v9-finding-audit?id='+f.audit.id);expect(api.mock.calls.filter(c=>c[1]==='create')).toHaveLength(1)})
it('draft entire page is blind, and foreground reload only GETs server choices',async()=>{const f=await syntheticFindingAudit();api.mockResolvedValue(findingAuditProjection(f.audit,f.items,[],f.bundle,true));mount(false);await screen.findByText('Contrôle 1 / 30');expect(document.body.textContent).not.toMatch(/Jev|Sol|Gold|V9|probabilit|rating|TEXTE ORIGINAL/);expect(screen.queryAllByRole('button',{pressed:true})).toHaveLength(0);fireEvent(window,new Event('pageshow'));await waitFor(()=>expect(api.mock.calls.length).toBeGreaterThan(1));expect(api.mock.calls.every(c=>!c[1])).toBe(true)})
it('entry resumes an existing draft without creation; unauthorized entry stays hidden',async()=>{const f=await syntheticFindingAudit();api.mockResolvedValue(findingAuditProjection(f.audit,f.items,[],f.bundle,false));const q=mount();await screen.findByRole('button',{name:'Continuer le contrôle'});fireEvent.click(screen.getByRole('button',{name:'Continuer le contrôle'}));await screen.findByText('/plus/v9-finding-audit?id='+f.audit.id);expect(api.mock.calls.every(c=>!c[1])).toBe(true);q.unmount();access.data=false;mount();expect(screen.queryByRole('button',{name:'Commencer le contrôle'})).toBeNull()})
