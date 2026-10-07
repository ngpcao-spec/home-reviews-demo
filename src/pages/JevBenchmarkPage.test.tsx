import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { QueryClient,QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { JevBenchmarkPage } from './JevBenchmarkPage'
import { jevApi } from '../lib/jev-benchmark'
import { jevSource,jevResult } from '../../tests/fixtures/jev-benchmark'
const access=vi.hoisted(()=>({data:true,isPending:false}))
vi.mock('../app/AppContext',()=>({useApp:()=>({currentUser:{id:'user'},demoMode:false,notifications:[]})}))
vi.mock('../lib/use-jev-access',()=>({useJevAccess:()=>access}))
vi.mock('../lib/supabase',()=>({supabase:null}))
vi.mock('./EnglishReviewPreparation',()=>({EnglishReviewPreparation:()=>null}))
function mount(language:'fr'|'vi'='fr'){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}><MemoryRouter><I18nProvider language={language}><JevBenchmarkPage/></I18nProvider></MemoryRouter></QueryClientProvider>)}
beforeEach(()=>{access.data=true;Object.defineProperty(document,'hidden',{configurable:true,value:false});vi.spyOn(jevApi,'sources').mockResolvedValue([jevSource]);vi.spyOn(jevApi,'latest').mockResolvedValue(null);vi.spyOn(jevApi,'read').mockResolvedValue({...jevResult,status:'running'});vi.spyOn(jevApi,'post').mockResolvedValue({benchmark_id:jevResult.id})})
afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks();vi.useRealTimers()})
describe('Jev mobile page',()=>{
  it('a persisted V6 selection offers a visible V7 shortcut; selection never posts and preparation is collapsed below launch',async()=>{
    const old='382c46aa-2505-44de-8693-71ab1fa92d11',english={source_generation_id:'b73ec894-d5fd-4b11-9fe6-cd89c117e9de',source_analysis_version:7,reviews_total:101,completed_at:'2026-10-06T09:00:00Z'}
    localStorage.setItem('jev-benchmark-selection:user',old)
    vi.mocked(jevApi.sources).mockResolvedValue([{...jevSource,...english,snapshots:[english,{source_generation_id:old,source_analysis_version:6,reviews_total:101,completed_at:'2026-10-05T09:00:00Z'}]}])
    mount();fireEvent.click(await screen.findByRole('button',{name:'Sélectionner V7 · Analyse EN'}))
    expect(await screen.findByRole('button',{name:'Lancer Phase 2 V7'})).toBeEnabled();expect(jevApi.post).not.toHaveBeenCalled()
    expect(screen.getByText('Préparation anglaise et rapports V7 / V8').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByLabelText('Dataset · V6 / V7')).toHaveValue(english.source_generation_id)
  })
  it('V7 selection is labelled English and directly offers Phase 2 without a Phase 1 launch',async()=>{
    const english={source_generation_id:'b73ec894-d5fd-4b11-9fe6-cd89c117e9de',source_analysis_version:7,reviews_total:101,completed_at:'2026-10-06T09:00:00Z'}
    vi.mocked(jevApi.sources).mockResolvedValue([{...jevSource,...english,snapshots:[english,{source_generation_id:'382c46aa-2505-44de-8693-71ab1fa92d11',source_analysis_version:6,reviews_total:101,completed_at:'2026-10-05T09:00:00Z'}]}])
    mount();expect(await screen.findByRole('button',{name:'Lancer Phase 2 V7'})).toBeEnabled()
    expect(screen.getByRole('option',{name:/V7 · 101 avis · Analyse EN/})).toBeInTheDocument();expect(screen.getByRole('option',{name:/V6 · 101 avis · Langues originales/})).toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'Lancer le test Jev'})).not.toBeInTheDocument();expect(jevApi.post).not.toHaveBeenCalled()
    expect(jevApi.latest).toHaveBeenCalledWith(english.source_generation_id,'themes_phase2')
  })
  it('A: discovers current Shabu V6 dynamically and never launches on page load',async()=>{
    mount();expect(await screen.findByRole('button',{name:'Lancer le test Jev'})).toBeEnabled()
    expect(screen.getByRole('option')).toHaveTextContent('Shabu Ssam BBQ Restaurant · 100 avis')
    expect(jevApi.latest).toHaveBeenCalledWith('1629f8d2-80da-42a7-92c7-af18ff04da32');expect(jevApi.post).not.toHaveBeenCalled()
  })
  it('B/C: double tap disables immediately and creates just one POST',async()=>{
    mount();const button=await screen.findByRole('button',{name:'Lancer le test Jev'})
    fireEvent.click(button);fireEvent.click(button)
    await screen.findByRole('heading',{name:'Test Jev en cours'});expect(jevApi.post).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button',{name:'Test Jev en cours'})).toBeDisabled()
  })
  it('D/E/F: unmount/remount finds server run and durable id without POST',async()=>{
    const view=mount();fireEvent.click(await screen.findByRole('button',{name:'Lancer le test Jev'}))
    await screen.findByRole('heading',{name:'Test Jev en cours'});view.unmount()
    vi.mocked(jevApi.latest).mockResolvedValue({...jevResult,status:'running'})
    mount();await screen.findByRole('heading',{name:'Test Jev en cours'})
    expect(jevApi.post).toHaveBeenCalledTimes(1);expect(localStorage.getItem('jev-benchmark:user:'+jevSource.source_generation_id)).toContain(jevResult.id)
    expect(screen.getByText(/Le test continue côté serveur/)).toBeVisible()
  })
  it('G: completed shows cost/time, agreement, stability and weak Price/Atmosphere separately',async()=>{
    vi.mocked(jevApi.latest).mockResolvedValue(jevResult);mount()
    await screen.findByText('Test terminé');expect(screen.getByText('96,8 %')).toBeVisible();expect(screen.getByText('99,0 %')).toBeVisible()
    expect(screen.getByText(/Économie potentielle/)).toBeVisible();expect(screen.getByText(/375,6/)).toBeVisible()
    expect(screen.getAllByText('À investiguer')).toHaveLength(2)
    expect(screen.getByRole('heading',{name:'Prix'})).toBeVisible();expect(screen.getByRole('heading',{name:'Ambiance'})).toBeVisible()
    expect(screen.getByRole('heading',{name:'Verdict du benchmark'})).toBeVisible();expect(jevApi.post).not.toHaveBeenCalled()
  })
  it('H: failed offers an explicit retry, but rechecks for running before POST',async()=>{
    vi.mocked(jevApi.latest).mockResolvedValue({...jevResult,status:'failed',error_code:'JEV_HTTP_429'});mount()
    const retry=await screen.findByRole('button',{name:'Réessayer'})
    vi.mocked(jevApi.latest).mockResolvedValue({...jevResult,status:'running'});fireEvent.click(retry)
    await screen.findByRole('heading',{name:'Test Jev en cours'});expect(jevApi.post).not.toHaveBeenCalled()
  })
  it('I: configuration error has localized server-only message and no key input',async()=>{
    vi.mocked(jevApi.post).mockRejectedValue(new Error('JEV_NOT_CONFIGURED'));mount()
    fireEvent.click(await screen.findByRole('button',{name:'Lancer le test Jev'}));await screen.findByText('La clé Jev n’est pas configurée côté serveur.')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
  it('direct unauthorized route cannot discover or launch',async()=>{
    access.data=false;mount();expect(await screen.findByText(/réservé aux propriétaires/)).toBeVisible()
    expect(jevApi.sources).not.toHaveBeenCalled();expect(jevApi.post).not.toHaveBeenCalled()
  })
  it('initial lookup failure prevents presenting an enabled launch action',async()=>{
    vi.mocked(jevApi.latest).mockRejectedValue(new Error('offline'));mount();await screen.findByRole('alert')
    expect(screen.getByRole('button',{name:'Lancer le test Jev'})).toBeDisabled();expect(jevApi.post).not.toHaveBeenCalled()
  })
  it('foreground resumes GET-only reading and hidden page does not poll',async()=>{
    vi.mocked(jevApi.latest).mockResolvedValue({...jevResult,status:'running'});mount();await screen.findByRole('heading',{name:'Test Jev en cours'})
    vi.mocked(jevApi.read).mockClear();Object.defineProperty(document,'hidden',{configurable:true,value:true});fireEvent(document,new Event('visibilitychange'))
    await new Promise(r=>setTimeout(r,2700));expect(jevApi.read).not.toHaveBeenCalled()
    Object.defineProperty(document,'hidden',{configurable:true,value:false});fireEvent(document,new Event('visibilitychange'))
    await waitFor(()=>expect(jevApi.read).toHaveBeenCalledWith(jevResult.id));expect(jevApi.post).not.toHaveBeenCalled()
  })
  it('Vietnamese result and labels are translated',async()=>{
    vi.mocked(jevApi.latest).mockResolvedValue(jevResult);mount('vi');await screen.findByText('Thử nghiệm hoàn tất')
    expect(screen.getByRole('heading',{name:'Chi phí ước tính'})).toBeVisible();expect(screen.getAllByText('Cần kiểm tra')).toHaveLength(2)
  })
  it('preserves the requested 100-review Shabu snapshot alongside newer 101-review V6, including reload',async()=>{
    const newer='382c46aa-2505-44de-8693-71ab1fa92d11'
    vi.mocked(jevApi.sources).mockResolvedValue([{...jevSource,source_generation_id:newer,reviews_total:101,completed_at:'2026-10-05T06:46:18Z',snapshots:[{source_generation_id:newer,reviews_total:101,completed_at:'2026-10-05T06:46:18Z'},{source_generation_id:jevSource.source_generation_id,reviews_total:100,completed_at:jevSource.completed_at}]}])
    const view=mount();await screen.findByRole('button',{name:'Lancer le test Jev'})
    expect(screen.getByLabelText('Dataset · V6 / V7')).toHaveValue(newer)
    fireEvent.change(screen.getByLabelText('Dataset · V6 / V7'),{target:{value:jevSource.source_generation_id}})
    await waitFor(()=>expect(jevApi.latest).toHaveBeenCalledWith(jevSource.source_generation_id))
    view.unmount();mount();await screen.findByRole('button',{name:'Lancer le test Jev'})
    expect(screen.getByLabelText('Dataset · V6 / V7')).toHaveValue(jevSource.source_generation_id)
    expect(jevApi.post).not.toHaveBeenCalled()
  })
})
