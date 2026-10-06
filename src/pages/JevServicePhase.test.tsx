import { cleanup,fireEvent,render,screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient,QueryClientProvider } from '@tanstack/react-query'
import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { JevThemesPhase } from './JevThemesPhase'
import { JevServiceResults } from './JevServiceResults'
import { jevApi,saveJevReference,readJevReference } from '../lib/jev-benchmark'
import { jevSource } from '../../tests/fixtures/jev-benchmark'
import { serviceResult } from '../../tests/fixtures/jev-service-result'
import { themeResult } from '../../tests/fixtures/jev-themes'
vi.mock('../lib/supabase',()=>({supabase:null}))
const source={...jevSource,source_generation_id:serviceResult.source_generation_id,reviews_total:101}
function mount(content=<JevThemesPhase user="user" source={source} visible kind="themes_phase2b_service"/>,language:'fr'|'vi'='fr') {return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}><MemoryRouter><I18nProvider language={language}>{content}</I18nProvider></MemoryRouter></QueryClientProvider>)}
beforeEach(()=>{vi.spyOn(jevApi,'latest').mockResolvedValue(null);vi.spyOn(jevApi,'post').mockResolvedValue({benchmark_id:serviceResult.id});vi.spyOn(jevApi,'read').mockResolvedValue({...serviceResult,status:'running'})})
afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks()})
describe('Phase 2B manual UI and backward compatibility',()=>{
  it('loading performs GET only, then explicit double tap makes one typed POST with its own persisted reference',async()=>{
    saveJevReference('user',source.source_generation_id,{benchmark_id:'phase2-id',created_at:'today',pending:false},'themes_phase2')
    mount();const button=await screen.findByRole('button',{name:'Lancer Phase 2B'});expect(jevApi.post).not.toHaveBeenCalled()
    expect(jevApi.latest).toHaveBeenCalledWith(source.source_generation_id,'themes_phase2b_service')
    fireEvent.click(button);fireEvent.click(button);await screen.findByRole('heading',{name:'Analyse ciblée du service en cours…'})
    expect(jevApi.post).toHaveBeenCalledExactlyOnceWith(source.source_generation_id,'themes_phase2b_service')
    expect(readJevReference('user',source.source_generation_id,'themes_phase2')?.benchmark_id).toBe('phase2-id')
    expect(readJevReference('user',source.source_generation_id,'themes_phase2b_service')?.benchmark_id).toBe(serviceResult.id)
  })
  it('existing Phase 2B survives reopening without POST',async()=>{
    vi.mocked(jevApi.latest).mockResolvedValue({...serviceResult,status:'running'});const view=mount();await screen.findByRole('heading',{name:'Analyse ciblée du service en cours…'});view.unmount()
    mount();await screen.findByRole('heading',{name:'Analyse ciblée du service en cours…'});expect(jevApi.post).not.toHaveBeenCalled()
  })
  it('Phase 2B is offered only after Phase 2 completed and old results remain visible',async()=>{
    vi.mocked(jevApi.latest).mockImplementation(async(_id,type)=>type==='themes_phase2'?themeResult:null)
    mount(<JevThemesPhase user="user" source={source} visible/>);await screen.findByRole('button',{name:'Lancer Phase 2B'})
    expect(screen.getByRole('heading',{name:'Verdict Phase 2'})).toBeVisible();expect(jevApi.post).not.toHaveBeenCalled()
  })
  it('renders Service deltas, precision/recall, non-regression and seven details',()=>{
    const view=mount(<JevServiceResults run={serviceResult}/>);expect(view.container.querySelectorAll('[data-service-target]')).toHaveLength(4)
    expect(screen.getAllByText('Précision')).toHaveLength(4);expect(screen.getAllByText('Rappel')).toHaveLength(4)
    expect(screen.getByRole('heading',{name:'Non-régression'})).toBeVisible()
    fireEvent.click(screen.getByText('Voir les thèmes · 7'));expect(view.container.querySelectorAll('.jev-theme-detail')).toHaveLength(7)
    fireEvent.click(screen.getByText('Détails techniques'));expect(screen.getByText('service-disambiguation-v1')).toBeVisible()
  })
  it('mismatched datasets show no fabricated comparison',()=>{
    const run=structuredClone(serviceResult);run.comparison.phase2_comparison.comparable=false;run.comparison.phase2_comparison.absolute_difference=null
    mount(<JevServiceResults run={run}/>);expect(screen.getByRole('alert')).toHaveTextContent('Les snapshots ne correspondent pas')
  })
  it('Vietnamese title and manual launch label are translated',async()=>{
    mount(undefined,'vi');expect(await screen.findByRole('button',{name:'Chạy giai đoạn 2B'})).toBeVisible()
    expect(screen.getByRole('heading',{name:'Giai đoạn 2B — Dịch vụ'})).toBeVisible()
  })
})
