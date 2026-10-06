import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {I18nProvider} from '../i18n'
import {EnglishReviewPreparation} from './EnglishReviewPreparation'
const api=vi.hoisted(()=>vi.fn())
vi.mock('../lib/english-backfill',()=>({englishBackfillApi:api}))
const coverage={stored_reviews:101,reviews_with_text:95,original_english:5,english_translation_found:0,english_translation_missing:90,coverage_percent:5/95*100}
function mount(language:'fr'|'vi'='fr') {return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}><MemoryRouter><I18nProvider language={language}><EnglishReviewPreparation user="user" establishment="shabu" name="Shabu Ssam BBQ Restaurant" visible/></I18nProvider></MemoryRouter></QueryClientProvider>)}
beforeEach(()=>api.mockImplementation(async(_est,method)=>({coverage,job:method==='POST'?{id:'job',status:'queued'}:null})))
afterEach(()=>{cleanup();localStorage.clear();api.mockReset()})
describe('English preparation manual mobile flow',()=>{
  it('GET coverage never starts a provider run; explicit double tap makes one POST',async()=>{
    mount();const button=await screen.findByRole('button',{name:'Récupérer les versions anglaises'});expect(api.mock.calls.every(c=>c[1]===undefined)).toBe(true)
    fireEvent.click(button);fireEvent.click(button);await screen.findByText('Récupération des versions anglaises en cours…')
    expect(api.mock.calls.filter(c=>c[1]==='POST')).toHaveLength(1);expect(localStorage.getItem('english-backfill:user:shabu')).toBe('job')
  })
  it('reopening retrieves the existing durable job without POST',async()=>{
    api.mockResolvedValue({coverage,job:{id:'job',status:'running'}});const view=mount();await screen.findByText('Récupération des versions anglaises en cours…');view.unmount()
    mount();await screen.findByText('Récupération des versions anglaises en cours…');expect(api.mock.calls.some(c=>c[1]==='POST')).toBe(false)
  })
  it('ambiguous launch marker survives reload and blocks a second POST',async()=>{
    localStorage.setItem('english-backfill:user:shabu','pending');mount();expect(await screen.findByRole('button',{name:'Récupérer les versions anglaises'})).toBeDisabled();expect(api.mock.calls.some(c=>c[1]==='POST')).toBe(false)
  })
  it('VI labels and successful coverage are available without generating any report',async()=>{
    api.mockResolvedValue({coverage:{...coverage,english_translation_found:90,english_translation_missing:0,coverage_percent:100},job:{id:'job',status:'completed'}})
    mount('vi');expect(await screen.findByRole('button',{name:'Lấy phiên bản tiếng Anh'})).toBeDisabled();expect(screen.getByText('100 %')).toBeVisible()
  })
})
