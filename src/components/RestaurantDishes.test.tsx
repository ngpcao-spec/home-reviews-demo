import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {RestaurantDishes} from './RestaurantDishes'
import {I18nProvider} from '../i18n'
const mock=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../lib/supabase',()=>({supabase:{rpc:mock.rpc}}))
const profile={revision:1,shared:true,canEdit:true,specialty:{id:'root',name:'Bánh căn',status:'proposed',origin:'automatic',evidence:{}},associations:[{id:'egg',name:'Bánh căn · TRỨNG GÀ',parentId:'root',parentName:'Bánh căn',status:'proposed',origin:'automatic',evidence:[{runId:'saved-run',sourceRow:5,name:'TRỨNG GÀ',section:'THỰC ĐƠN BÁNH CẦN',reason:'explicit_menu_context',collectedAt:'2026-11-24',photo:'https://lh3.googleusercontent.com/photo'}]}],unresolved:[]}
beforeEach(()=>{mock.rpc.mockReset()})
afterEach(cleanup)
const draw=(language:'fr'|'vi'='fr',id='restaurant')=>render(<I18nProvider language={language}><RestaurantDishes establishmentId={id}/></I18nProvider>)
it.each(['fr','vi'] as const)('shows proposal, contextual variant and evidence in %s without external calls',async language=>{
 mock.rpc.mockResolvedValue({data:profile,error:null});draw(language)
 await screen.findByText((language==='fr'?'Spécialité':'Đặc sản')+' : Bánh căn')
 expect(screen.getByText('Bánh căn · TRỨNG GÀ')).toBeInTheDocument()
 expect(screen.getByText(language==='fr'?'Interprétation selon la rubrique du menu':'Diễn giải theo mục thực đơn')).toBeInTheDocument()
 expect(mock.rpc.mock.calls.map(c=>c[0])).toEqual(['read_restaurant_dishes'])
})
it('requires edit rights and never invents a specialty when empty',async()=>{
 mock.rpc.mockResolvedValue({data:{...profile,canEdit:false,specialty:null,associations:[]},error:null});draw()
 await screen.findByText(/Aucun plat identifié/)
 expect(screen.queryByRole('button',{name:/corriger/})).toBeNull();expect(screen.queryByText(/Spécialité :/)).toBeNull()
})
it.each(['fr','vi'] as const)('groups secondary lines and flags only an unresolved specialty in %s',async language=>{
 const unresolved={...profile,specialty:null,unresolved:[{name:'Đặc biệt',sourceRow:3,runId:'saved-run',reason:'other'}],
  classification:{state:'succeeded',sourceRun:'saved-run',stale:false,specialtyNeedsConfirmation:true}}
 mock.rpc.mockResolvedValue({data:unresolved,error:null})
 draw(language)
 await screen.findByText(language==='fr'?'Spécialité à confirmer':'Đặc sản cần xác nhận')
 expect(screen.getByText(language==='fr'?'Autres (1)':'Khác (1)')).toBeInTheDocument()
 expect(screen.getByText('Đặc biệt')).toBeInTheDocument()
 expect(screen.queryByText(/À examiner|Cần xem xét/)).toBeNull()
})
it.each(['fr','vi'] as const)('shows the published specialty, menu profile and restaurant type separately in %s',async language=>{
 mock.rpc.mockResolvedValue({data:{...profile,menuProfile:'specialized',restaurantType:'family_dining'},error:null})
 draw(language)
 await screen.findByText(language==='fr'?'Spécialité : Bánh căn':'Đặc sản : Bánh căn')
 expect(screen.getByText(language==='fr'?'Spécialisée':'Chuyên một món')).toBeInTheDocument()
 expect(screen.getByText(language==='fr'?'Familial':'Quán ăn gia đình')).toBeInTheDocument()
 expect(screen.queryByText(/specialized|family_dining/)).toBeNull()
})
it.each(['fr','vi'] as const)('shows only the name-based label and keeps the proposal out of the dishes in %s',async language=>{
 mock.rpc.mockResolvedValue({data:{...profile,specialty:null,associations:[],
  nameSpecialtyProposal:{name:'Cơm tấm',nameEvidence:'Cơm Tấm',menuContext:'absent'},
  classification:{state:'succeeded',sourceRun:null,stale:false,specialtyNeedsConfirmation:true}},error:null})
 draw(language)
 await screen.findByText((language==='fr'?'Spécialité proposée d’après le nom':'Đặc sản đề xuất dựa trên tên quán')+' : Cơm tấm')
 expect(screen.getByText(language==='fr'?'Plats et variantes (0)':'Món ăn và biến thể (0)')).toBeInTheDocument()
 expect(screen.queryByText(language==='fr'?'Spécialité à confirmer':'Đặc sản cần xác nhận')).toBeNull()
 expect(mock.rpc.mock.calls.map(call=>call[0])).toEqual(['read_restaurant_dishes'])
})
it('confirms with revision, blocks duplicate clicks and displays a confirmed result',async()=>{
 let finish!:(v:unknown)=>void
 mock.rpc.mockImplementation((name:string)=>name==='read_restaurant_dishes'?Promise.resolve({data:profile}):name==='list_dish_names'?Promise.resolve({data:[{id:'root',name:'Bánh căn'}]}):new Promise(r=>{finish=r}))
 draw();await screen.findByText('Spécialité : Bánh căn');fireEvent.click(screen.getByText('Confirmer ou corriger les plats'))
 await screen.findAllByRole('option',{name:'Bánh căn'})
 const confirm=screen.getByRole('button',{name:'Confirmer la spécialité'});fireEvent.click(confirm);fireEvent.click(confirm)
 expect(mock.rpc.mock.calls.filter(c=>c[0]==='edit_restaurant_dishes')).toHaveLength(1)
 expect(mock.rpc.mock.calls.at(-1)![1]).toMatchObject({p_revision:1,p_dish:'root',p_action:'specialty'})
 finish({data:{...profile,revision:2,specialty:{...profile.specialty,status:'confirmed',origin:'manual'}}})
 await screen.findByText('Confirmée')
})
it.each(['fr','vi'] as const)('keeps a specialty without usable references visible and unverified in %s',async language=>{
 mock.rpc.mockResolvedValue({data:{...profile,specialty:null,associations:[],
  unverifiedSpecialty:{name:'Bánh căn',basis:'menu'},
  classification:{state:'succeeded',sourceRun:'saved-run',stale:false,specialtyNeedsConfirmation:true}},error:null})
 draw(language)
 await screen.findByText(language==='fr'?'Spécialité proposée : Bánh căn':'Đặc sản đề xuất : Bánh căn')
 expect(screen.getByText(language==='fr'?'Source non vérifiée':'Nguồn chưa được xác minh')).toBeInTheDocument()
 expect(screen.getByText(language==='fr'?'Plats et variantes (0)':'Món ăn và biến thể (0)')).toBeInTheDocument()
})
it('hides the old restaurant during rapid changes and discards late responses',async()=>{
 let finish!:(v:unknown)=>void
 mock.rpc.mockResolvedValueOnce({data:profile});const view=draw();await screen.findByText('Spécialité : Bánh căn')
 mock.rpc.mockImplementation(()=>new Promise(r=>{finish=r}))
 view.rerender(<I18nProvider language="fr"><RestaurantDishes establishmentId="other"/></I18nProvider>)
 expect(screen.queryByText('Spécialité : Bánh căn')).toBeNull()
 finish({data:{...profile,specialty:null,associations:[]}})
 await screen.findByText(/Aucun plat identifié/)
})
it('shows a stale edit conflict and does not resubmit automatically',async()=>{
 mock.rpc.mockImplementation((name:string)=>Promise.resolve(name==='read_restaurant_dishes'?{data:profile}:name==='list_dish_names'?{data:[]}:{error:{message:'DISH_CONFLICT'}}))
 draw();await screen.findByText('Spécialité : Bánh căn');fireEvent.click(screen.getByText('Confirmer ou corriger les plats'))
 fireEvent.click(screen.getByRole('button',{name:'Confirmer la spécialité'}))
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Ces associations ont changé'))
 expect(mock.rpc.mock.calls.filter(c=>c[0]==='edit_restaurant_dishes')).toHaveLength(1)
})
