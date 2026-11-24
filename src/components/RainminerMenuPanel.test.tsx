import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {RainminerMenuPanel} from './RainminerMenuPanel'
import {I18nProvider} from '../i18n'
const mock=vi.hoisted(()=>({invoke:vi.fn()}))
vi.mock('../lib/supabase',()=>({supabase:{functions:{invoke:mock.invoke}}}))
beforeEach(()=>{mock.invoke.mockReset();localStorage.clear()})
afterEach(()=>{cleanup();vi.restoreAllMocks()})
const draw=(language:'fr'|'vi'='fr',est='restaurant')=>render(<I18nProvider language={language}><RainminerMenuPanel establishmentId={est} userId="user"/></I18nProvider>)
const saved={counts:{received:4,excludedDrinks:1,retained:3},references:[
 {sourceRow:1,classification:'food',row:{name:'Steak au café',description:'Au vin',price:null}},
 {sourceRow:2,classification:'food',row:{name:'Steak au café',price:null}},
 {sourceRow:3,classification:'review',row:{name:'Special 8',price:null}},
],provenance:{retrievedAt:'2026-11-24T02:00:00Z'}}
it.each([
 ['queued','En attente','Đang chờ'],['running','Extraction en cours…','Đang lấy thực đơn…'],
 ['failed','Extraction échouée','Trích xuất thất bại'],['unknown','Vérification nécessaire','Cần xác minh'],
] as const)('shows %s in FR and VI without a start request',async(status,fr,viLabel)=>{
 for(const [language,label] of [['fr',fr],['vi',viLabel]] as const){
  mock.invoke.mockResolvedValue({data:{job:{status},result:null,canStart:true},error:null})
  draw(language);expect(await screen.findByText(label,{exact:true})).toBeVisible()
  expect(mock.invoke.mock.calls.every(call=>call[1].body.action==='status')).toBe(true);cleanup()
 }
})
it('shows completed or empty menu and keeps review classifications, duplicates and missing prices',async()=>{
 mock.invoke.mockResolvedValue({data:{job:{status:'completed'},result:saved,canStart:true},error:null})
 draw();await screen.findByText('Menu disponible');expect(screen.getAllByText('Steak au café')).toHaveLength(2)
 expect(screen.getByText(/À examiner/)).toBeVisible();expect(screen.getAllByText('Prix non renseigné')).toHaveLength(3)
 expect(screen.getByText(/24 nov. 2026/)).toBeVisible();cleanup()
 mock.invoke.mockResolvedValue({data:{job:{status:'completed'},result:{counts:{received:0,excludedDrinks:0,retained:0},references:[]},canStart:true},error:null})
 draw('vi');expect(await screen.findByText('Không tìm thấy món ăn')).toBeVisible()
})
it('requires confirmation and sends only one paid request for double clicks',async()=>{
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 mock.invoke.mockResolvedValueOnce({data:{job:{status:'failed'},result:saved,canStart:true,maxCostUsd:.5},error:null})
 draw();const button=await screen.findByRole('button',{name:'Récupérer les plats'});await waitFor(()=>expect(button).toBeEnabled())
 fireEvent.click(button);expect(confirm).toHaveBeenCalledWith(expect.stringContaining('0.5 USD'))
 expect(mock.invoke).toHaveBeenCalledTimes(1)
 confirm.mockReturnValue(true)
 let resolve!:(value:unknown)=>void
 mock.invoke.mockImplementation(()=>new Promise(done=>{resolve=done}))
 fireEvent.click(button);fireEvent.click(button)
 expect(mock.invoke).toHaveBeenCalledTimes(2)
 const payload=mock.invoke.mock.calls[1][1].body;expect(payload.confirm_paid).toBe(true);expect(payload.request_id).toBeTruthy()
 expect(screen.getAllByText('Steak au café')).toHaveLength(2)
 resolve({data:{job:{status:'queued',request_id:payload.request_id}},error:null})
 expect(await screen.findByText('En attente')).toBeVisible()
})
it('shows budget exhaustion and never starts an unknown request',async()=>{
 mock.invoke.mockResolvedValue({data:{job:{status:'queued',error_code:'MENU_BUDGET_LIMIT'},result:null,canStart:false},error:null})
 draw();await screen.findByText('Plafond de dépenses atteint.');expect(screen.getByRole('button')).toBeDisabled();cleanup()
 mock.invoke.mockResolvedValue({data:{job:{status:'unknown'},result:saved,canStart:true},error:null})
 draw();await screen.findByText('Vérification nécessaire');expect(screen.getByRole('button')).toBeDisabled()
})
it('changing restaurant hides the old menu while its replacement is loading',async()=>{
 mock.invoke.mockResolvedValueOnce({data:{job:{status:'completed'},result:saved,canStart:true},error:null})
 const view=draw();await screen.findByText('Menu disponible')
 mock.invoke.mockImplementation(()=>new Promise(()=>{}))
 view.rerender(<I18nProvider language="fr"><RainminerMenuPanel establishmentId="different" userId="user"/></I18nProvider>)
 expect(screen.queryByText('Menu disponible')).not.toBeInTheDocument();expect(screen.queryByText('Steak au café')).not.toBeInTheDocument()
})
