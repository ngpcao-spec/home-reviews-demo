import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {I18nProvider} from '../i18n'
import {HistoricalV7Test} from './HistoricalV7Test'
const api=vi.hoisted(()=>vi.fn())
vi.mock('../lib/historical-v7',()=>({historicalV7Api:api}))
const coverage={stored_reviews:101,reviews_with_text:95,original_english:8,english_translation_found:87,english_translation_missing:0,coverage_percent:100}
function mount(percent=100,language:'fr'|'vi'='fr'){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}><I18nProvider language={language}><HistoricalV7Test user="u" establishment="shabu" name="Shabu" coverage={{...coverage,coverage_percent:percent}} visible/></I18nProvider></QueryClientProvider>)}
beforeEach(()=>api.mockResolvedValue({run:null}))
afterEach(()=>{cleanup();localStorage.clear();api.mockReset()})
it('only enables at coverage 100; opening never enqueues',async()=>{mount(99);expect(await screen.findByRole('button',{name:'Lancer le rapport V7'})).toBeDisabled();expect(api.mock.calls.every(c=>!c[2])).toBe(true)})
it('explicit double click launches once and reopening resumes without a new launch',async()=>{
  let started=false;api.mockImplementation(async(_e,_l,start)=>{if(start)started=true;return {run:started?{generation_id:'v7-id',status:'running',progress:0,total_steps:6}:null}})
  const view=mount(),button=await screen.findByRole('button',{name:'Lancer le rapport V7'});await waitFor(()=>expect(button).toBeEnabled());fireEvent.click(button);fireEvent.click(button)
  await screen.findByText('Rapport V7 en cours');expect(api.mock.calls.filter(c=>c[2])).toHaveLength(1);expect(localStorage.getItem('historical-v7:u:shabu:fr')).toBe('v7-id')
  view.unmount();mount();await screen.findByText('Rapport V7 en cours');expect(api.mock.calls.filter(c=>c[2])).toHaveLength(1)
})
it('an uncertain launch survives reload without automatically posting',async()=>{localStorage.setItem('historical-v7:u:shabu:fr','pending');mount();expect(await screen.findByRole('button',{name:'Lancer le rapport V7'})).toBeDisabled();expect(api.mock.calls.every(c=>!c[2])).toBe(true)})
it('VI failed state allows an explicit retry only',async()=>{api.mockResolvedValue({run:{generation_id:'old',status:'failed',error_code:'TEST',progress:0,total_steps:1}});mount(100,'vi');expect(await screen.findByRole('button',{name:'Thử lại báo cáo V7'})).toBeEnabled();expect(api.mock.calls.every(c=>!c[2])).toBe(true)})
