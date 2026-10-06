import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {webcrypto} from 'node:crypto'
import {I18nProvider} from '../i18n'
import {GoldSetPage,GoldAnnotation,GoldSetEntry} from './GoldSetPage'
import {syntheticGold,fakeGoldId,syntheticLabels} from '../../tests/fixtures/human-gold'
import {blindGoldProjection} from '../../supabase/functions/_shared/gold-api'
import {normalizeGoldLabels,compareGold} from '../../supabase/functions/_shared/gold-core'
const api=vi.hoisted(()=>vi.fn())
vi.mock('../lib/human-gold',()=>({goldApi:api}))
vi.mock('../app/AppContext',()=>({useApp:()=>({currentUser:{id:'human'},demoMode:false,notifications:[]})}))
vi.mock('../lib/use-jev-access',()=>({useJevAccess:()=>({data:true,isPending:false})}))
beforeEach(()=>vi.stubGlobal('crypto',webcrypto))
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals();api.mockReset()})
function mount(content=<GoldSetPage/>,language:'fr'|'vi'='fr'){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}><MemoryRouter initialEntries={['/plus/gold-set?id='+fakeGoldId]}><I18nProvider language={language}>{content}</I18nProvider></MemoryRouter></QueryClientProvider>)}
it('blind annotation shows English only, no stars or model predictions; human choices saved explicitly',async()=>{
  const f=await syntheticGold(),data=blindGoldProjection(f.set,f.rows,f.labels,f.source,true),action=vi.fn(async()=>true)
  mount(<GoldAnnotation data={data} user="human" busy={false} action={action}/>);expect(screen.getByText(f.source.snapshot.reviews[0].analysis_text)).toHaveAttribute('lang','en')
  expect(screen.queryByText(/Sol|Jev|probabilit|désaccord|contrôle|rating|Russian/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Service',{exact:true}))
  fireEvent.click(screen.getByRole('button',{name:/^Amabilité/}));fireEvent.click(screen.getByRole('button',{name:'Positive'}))
  fireEvent.click(screen.getByRole('button',{name:/^Attention au client/}));fireEvent.click(screen.getByRole('button',{name:'Uncertain'}))
  fireEvent.click(screen.getByRole('button',{name:/^Professionnalisme/}));fireEvent.click(screen.getByRole('button',{name:'Both'}))
  fireEvent.click(screen.getByRole('button',{name:'Valider cet avis'}));await waitFor(()=>expect(action).toHaveBeenCalledWith('confirm_review',expect.objectContaining({choices:{friendly_staff:'positive',attentiveness:'uncertain',professionalism:'both'}})))
})
it('autosave and server progress survive unmount/reopen; GET never creates or labels automatically',async()=>{
  const f=await syntheticGold();api.mockImplementation(async(_id,action,payload)=>{if(action==='confirm_review'){const choices=normalizeGoldLabels(payload.choices);f.rows.find(r=>r.review_id===payload.review_id)!.confirmed_at='now';f.labels.push(...Object.entries(choices).map(([theme_key,choice])=>({review_id:payload.review_id,theme_key,choice})) as typeof f.labels);f.set.revision++}return blindGoldProjection(f.set,f.rows,f.labels,f.source,true)})
  const view=mount();await screen.findByText('Avis 1 / 40');expect(api.mock.calls.every(c=>!c[1])).toBe(true)
  fireEvent.click(screen.getByRole('button',{name:'Aucun thème explicite'}));await screen.findByText('Avis 2 / 40');expect(screen.getByText('1 / 40 terminés')).toBeVisible();view.unmount()
  mount();await screen.findByText('Avis 2 / 40');expect(screen.getByText('1 / 40 terminés')).toBeVisible();expect(api.mock.calls.filter(c=>c[1]==='confirm_review')).toHaveLength(1)
})
it('finalization requires a second confirmation and then hides editing/predictions-before-completion',async()=>{
  const f=await syntheticGold();f.rows.forEach(r=>r.confirmed_at='now');f.labels=syntheticLabels(f.rows.map(r=>r.review_id))
  api.mockImplementation(async(_id,action)=>{if(action==='finalize'){f.set.status='completed';f.set.comparison=await compareGold(f.set.id,f.source,f.benchmark,f.rows,f.labels)}return blindGoldProjection(f.set,f.rows,f.labels,f.source,true)})
  mount();await screen.findByText('40 / 40 terminés');expect(screen.queryByText('Micro F1')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Finaliser le Gold Set'}));expect(api.mock.calls.some(c=>c[1]==='finalize')).toBe(false)
  fireEvent.click(screen.getByRole('button',{name:'Confirmer la finalisation'}));await screen.findByText('GOLD SET RESULT');expect(screen.queryByRole('button',{name:'Valider cet avis'})).not.toBeInTheDocument();expect(api.mock.calls.filter(c=>c[1]==='finalize')).toHaveLength(1)
})
it('Gold entry creation is only manual and double tap makes one creation request',async()=>{
  api.mockResolvedValueOnce({eligible:true,gold_set:null,reviews:[]}).mockImplementation(async()=>{await new Promise(resolve=>setTimeout(resolve,10));const f=await syntheticGold();return blindGoldProjection(f.set,f.rows,[],f.source,true)})
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/entry']}><I18nProvider language="fr"><Routes><Route path="/entry" element={<GoldSetEntry/>}/><Route path="/plus/gold-set" element={<p>opened</p>}/></Routes></I18nProvider></MemoryRouter></QueryClientProvider>)
  const button=await screen.findByRole('button',{name:'Créer le Gold Set'});await waitFor(()=>expect(button).toBeEnabled());expect(api.mock.calls.some(c=>c[1]==='create')).toBe(false);fireEvent.click(button);fireEvent.click(button);await screen.findByText('opened');expect(api.mock.calls.filter(c=>c[1]==='create')).toHaveLength(1)
})
it('Vietnamese taxonomy help and controls are localized and translation replacement is explicit',async()=>{
  const f=await syntheticGold(),data=blindGoldProjection(f.set,f.rows,f.labels,f.source,true),action=vi.fn(async()=>true)
  mount(<GoldAnnotation data={data} user="human" busy={false} action={action}/>,'vi');fireEvent.click(screen.getByText('Dịch vụ',{exact:true}));fireEvent.click(screen.getByRole('button',{name:'Info · Tính chuyên nghiệp'}));expect(screen.getByText(/Chỉ năng lực, kiến thức/)).toBeVisible()
  fireEvent.click(screen.getByRole('button',{name:'Bản dịch tiếng Anh không chính xác'}));expect(action).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Xác nhận hoàn tất'}));await waitFor(()=>expect(action).toHaveBeenCalledWith('exclude_review',{review_id:f.rows[0].review_id}))
})
