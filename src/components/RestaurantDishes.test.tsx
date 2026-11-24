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
