import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {webcrypto} from 'node:crypto'
import {I18nProvider} from '../i18n'
import {AdjudicationAnnotation,AdjudicationEntry,GoldAdjudicationPage} from './GoldAdjudicationPage'
import {syntheticAdjudicationBundle,syntheticAdjudication,fakeAdjudicationId} from '../../tests/fixtures/gold-adjudication'
import {selectAdjudicationItems,compareAdjudication,type AdjudicationLabel} from '../../supabase/functions/_shared/gold-adjudication-core'
import {adjudicationProjection} from '../../supabase/functions/_shared/gold-adjudication-api'
const api=vi.hoisted(()=>vi.fn())
vi.mock('../lib/gold-adjudication',()=>({adjudicationApi:api}))
vi.mock('../app/AppContext',()=>({useApp:()=>({currentUser:{id:'human'},demoMode:false,notifications:[]})}))
vi.mock('../lib/use-jev-access',()=>({useJevAccess:()=>({data:true,isPending:false})}))
beforeEach(()=>vi.stubGlobal('crypto',webcrypto))
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals();api.mockReset()})
function mount(content=<GoldAdjudicationPage/>,language:'fr'|'vi'='fr'){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}><MemoryRouter initialEntries={['/plus/gold-check?id='+fakeAdjudicationId]}><I18nProvider language={language}>{content}</I18nProvider></MemoryRouter></QueryClientProvider>)}
async function state(){const b=await syntheticAdjudicationBundle(),a=await syntheticAdjudication(b),items=(await selectAdjudicationItems(b)).items,labels:AdjudicationLabel[]=[];return {b,a,items,labels}}
it('requires explicit human choices, renders 1–3 selected themes only, and is blind to ratings/Gold/Sol/Jev',async()=>{
  const s=await state(),data=adjudicationProjection(s.a,s.items,s.labels,s.b,true),action=vi.fn(async()=>true)
  const view=mount(<AdjudicationAnnotation data={data} user="human" busy={false} action={action}/>);expect(screen.getByRole('button',{name:'Suivant'})).toBeDisabled()
  expect(view.container.querySelectorAll('[data-adjudication-theme]')).toHaveLength(s.items[0].themes.length)
  expect(view.container.querySelectorAll('[aria-pressed=true]')).toHaveLength(0);expect(screen.queryByText(/Gold actuel|Sol|Jev|rating|probabilities|original_text/)).not.toBeInTheDocument()
  const first=view.container.querySelector('[data-adjudication-theme]')!;fireEvent.click(first.querySelector('button[aria-pressed]')!)
  expect(action).toHaveBeenCalledWith('save_choice',{review_id:s.items[0].review_id,theme_key:s.items[0].themes[0],choice:'absent'})
})
it('autosaves each explicit choice and resumes server progress after reopening, with no automatic POST',async()=>{
  const s=await state();api.mockImplementation(async(_id,action,payload)=>{if(action==='save_choice'){s.labels.push({review_id:payload.review_id,theme_key:payload.theme_key,choice:payload.choice});s.a.revision++}return adjudicationProjection(s.a,s.items,s.labels,s.b,true)})
  const view=mount();await screen.findByText('Contrôle 1 / 12');expect(api.mock.calls.every(c=>!c[1])).toBe(true)
  for(const theme of s.items[0].themes){const card=view.container.querySelector(`[data-adjudication-theme="${theme}"]`)!;fireEvent.click(card.querySelector('button[aria-pressed]')!);await waitFor(()=>expect(card.querySelector('[aria-pressed=true]')).toBeTruthy())}
  expect(screen.getByText('1 / 12 terminés')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Suivant'}));await screen.findByText('Contrôle 2 / 12');view.unmount()
  mount();await screen.findByText('Contrôle 2 / 12');expect(screen.getByText('1 / 12 terminés')).toBeVisible();expect(api.mock.calls.filter(c=>c[1]==='save_choice')).toHaveLength(s.items[0].themes.length)
})
it('finalization requires confirmation and only then reveals Human/Gold/Sol/Jev',async()=>{
  const s=await state();s.labels.push(...s.items.flatMap(i=>i.themes.map(theme_key=>({review_id:i.review_id,theme_key,choice:'positive' as const}))))
  api.mockImplementation(async(_id,action)=>{if(action==='finalize'){s.a.status='completed';s.a.comparison=compareAdjudication(s.b,s.items,s.labels)}return adjudicationProjection(s.a,s.items,s.labels,s.b,true)})
  mount();await screen.findByText('12 / 12 terminés');expect(screen.queryByText('Gold actuel')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Finaliser le contrôle'}));expect(api.mock.calls.some(c=>c[1]==='finalize')).toBe(false)
  fireEvent.click(screen.getByRole('button',{name:'Confirmer la finalisation'}));await screen.findByText('Résultat du contrôle humain');expect(screen.queryByRole('button',{name:'Suivant'})).not.toBeInTheDocument();expect(screen.getAllByText('Gold actuel').length).toBeGreaterThan(0)
})
it('control creation is manual and double tapping calls create once',async()=>{
  const s=await state();api.mockResolvedValueOnce({eligible:true,adjudication:null,items:[]}).mockImplementation(async()=>{await new Promise(resolve=>setTimeout(resolve,10));return adjudicationProjection(s.a,s.items,[],s.b,true)})
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/entry']}><I18nProvider language="fr"><Routes><Route path="/entry" element={<AdjudicationEntry/>}/><Route path="/plus/gold-check" element={<p>opened</p>}/></Routes></I18nProvider></MemoryRouter></QueryClientProvider>)
  const button=await screen.findByRole('button',{name:'Commencer le contrôle'});await waitFor(()=>expect(button).toBeEnabled());expect(api.mock.calls.some(c=>c[1]==='create')).toBe(false);fireEvent.click(button);fireEvent.click(button);await screen.findByText('opened');expect(api.mock.calls.filter(c=>c[1]==='create')).toHaveLength(1)
})
it('VI frozen definitions and uncertain option are available without showing model answers',async()=>{
  const s=await state(),data=adjudicationProjection(s.a,s.items,s.labels,s.b,true),action=vi.fn(async()=>true),view=mount(<AdjudicationAnnotation data={data} user="human" busy={false} action={action}/>,'vi')
  fireEvent.click(screen.getByRole('button',{name:'Info · Sự quan tâm'}));expect(screen.getByText(/Quan tâm cụ thể đến nhu cầu/)).toBeVisible()
  const first=view.container.querySelector('[data-adjudication-theme]')!,buttons=first.querySelectorAll('button[aria-pressed]');fireEvent.click(buttons[4]);expect(action).toHaveBeenCalledWith('save_choice',expect.objectContaining({choice:'uncertain'}))
})
