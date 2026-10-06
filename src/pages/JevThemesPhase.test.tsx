import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient,QueryClientProvider } from '@tanstack/react-query'
import { afterEach,beforeEach,describe,it,expect,vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { JevThemesPhase,JevThemeResults } from './JevThemesPhase'
import { jevApi,readJevReference,saveJevReference } from '../lib/jev-benchmark'
import { jevSource } from '../../tests/fixtures/jev-benchmark'
import { themeResult } from '../../tests/fixtures/jev-themes'
vi.mock('../lib/supabase',()=>({supabase:null}))
const source={...jevSource,source_generation_id:themeResult.source_generation_id,reviews_total:101}
function mount(content=<JevThemesPhase user="user" source={source} visible/>,language:'fr'|'vi'='fr') {return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}><MemoryRouter><I18nProvider language={language}>{content}</I18nProvider></MemoryRouter></QueryClientProvider>)}
beforeEach(()=>{vi.spyOn(jevApi,'latest').mockResolvedValue(null);vi.spyOn(jevApi,'post').mockResolvedValue({benchmark_id:themeResult.id});vi.spyOn(jevApi,'read').mockResolvedValue({...themeResult,status:'running'})})
afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks()})
describe('Manual Phase 2 and typed persistence',()=>{
  it('opening Phase 2 performs GET only; legacy Phase 1 reference does not block a manual Phase 2 click',async()=>{
    saveJevReference('user',source.source_generation_id,{benchmark_id:'2199bd35-628f-49aa-bf7e-cd706ef1eedc',created_at:'today',pending:false})
    mount();const button=await screen.findByRole('button',{name:'Lancer Phase 2'})
    expect(jevApi.latest).toHaveBeenCalledWith(source.source_generation_id,'themes_phase2');expect(jevApi.post).not.toHaveBeenCalled()
    fireEvent.click(button);fireEvent.click(button);await screen.findByRole('heading',{name:'Analyse des thèmes en cours…'})
    expect(jevApi.post).toHaveBeenCalledExactlyOnceWith(source.source_generation_id,'themes_phase2')
    expect(readJevReference('user',source.source_generation_id)?.benchmark_id).toBe('2199bd35-628f-49aa-bf7e-cd706ef1eedc')
    expect(readJevReference('user',source.source_generation_id,'themes_phase2')?.benchmark_id).toBe(themeResult.id)
  })
  it('return after unmount retrieves the existing Phase 2 without POST',async()=>{
    vi.mocked(jevApi.latest).mockResolvedValue({...themeResult,status:'running'});const view=mount();await screen.findByRole('heading',{name:'Analyse des thèmes en cours…'});view.unmount()
    mount();await screen.findByRole('heading',{name:'Analyse des thèmes en cours…'});expect(jevApi.post).not.toHaveBeenCalled()
  })
  it('shows five principal metrics, four axes, low support, thresholds and a visible weak supported Price axis',()=>{
    mount(<JevThemeResults run={themeResult}/>);expect(screen.getAllByText('Micro F1').length).toBeGreaterThan(0);expect(screen.getByText('Macro F1')).toBeVisible()
    expect(screen.getAllByText('Point faible à investiguer').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Voir les thèmes')).toHaveLength(4)
    const details=screen.getAllByText('Voir les thèmes')[2];fireEvent.click(details)
    expect(screen.getByText('billing')).toBeVisible();expect(screen.getAllByText('Échantillon insuffisant').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading',{name:'Verdict Phase 2'})).toBeVisible()
  })
  it('failed Phase 2 can retry explicitly, but a newly discovered running run prevents POST',async()=>{
    vi.mocked(jevApi.latest).mockResolvedValue({...themeResult,status:'failed',error_code:'JEV_HTTP_429'});mount();const retry=await screen.findByRole('button',{name:'Réessayer'})
    vi.mocked(jevApi.latest).mockResolvedValue({...themeResult,status:'running'});fireEvent.click(retry);await screen.findByRole('heading',{name:'Analyse des thèmes en cours…'});expect(jevApi.post).not.toHaveBeenCalled()
  })
  it('server configuration error never requests a key from the user',async()=>{
    vi.mocked(jevApi.post).mockRejectedValue(new Error('JEV_NOT_CONFIGURED'));mount();fireEvent.click(await screen.findByRole('button',{name:'Lancer Phase 2'}))
    await screen.findByText('La clé Jev n’est pas configurée côté serveur.');expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
  it('hides polling when backgrounded and resumes with GET by id',async()=>{
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
    const viewFor=(visible:boolean)=><QueryClientProvider client={client}><MemoryRouter><I18nProvider language="fr"><JevThemesPhase user="user" source={source} visible={visible}/></I18nProvider></MemoryRouter></QueryClientProvider>
    vi.mocked(jevApi.latest).mockResolvedValue({...themeResult,status:'running'});const view=render(viewFor(true));await screen.findByRole('heading',{name:'Analyse des thèmes en cours…'})
    vi.mocked(jevApi.read).mockClear();view.rerender(viewFor(false))
    await new Promise(r=>setTimeout(r,2600));expect(jevApi.read).not.toHaveBeenCalled()
    view.rerender(viewFor(true));await waitFor(()=>expect(jevApi.read).toHaveBeenCalledWith(themeResult.id));expect(jevApi.post).not.toHaveBeenCalled()
  })
  it('Vietnamese labels and insufficient-sample wording are localized',()=>{
    mount(<JevThemeResults run={themeResult}/>,'vi');expect(screen.getByRole('heading',{name:'Kết luận giai đoạn 2'})).toBeVisible();expect(screen.getAllByText('Chưa đủ mẫu').length).toBeGreaterThan(0)
  })
})
