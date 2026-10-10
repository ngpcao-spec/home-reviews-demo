import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {MemoryRouter} from 'react-router-dom'
import {afterEach,describe,it,expect,vi} from 'vitest'
import {I18nProvider} from '../i18n'
import {EconomyWorkspace,JevEconomyPage,JevEconomyEntry} from './JevEconomyPage'
import {syntheticEconomy} from '../../tests/fixtures/jev-economy'
import {restorableRoute} from '../lib/navigation-state'
const api=vi.hoisted(()=>vi.fn());
const gate=vi.hoisted(()=>({data:true,isPending:false}));
vi.mock('../lib/jev-economy',()=>({economyApi:api}))
vi.mock('../lib/use-jev-access',()=>({useJevAccess:()=>gate}))
vi.mock('../app/AppContext',()=>({useApp:()=>({currentUser:{id:'fixture-owner'},demoMode:false,notifications:[],establishments:[{id:'252a8dca-14c7-4f09-bd1f-7b2c40ae97aa',name:'Artisan Cafe & Eatery'}]})}))
const mount=(ui:React.ReactNode,language:'fr'|'vi'='fr')=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}><MemoryRouter><I18nProvider language={language}>{ui}</I18nProvider></MemoryRouter></QueryClientProvider>);
afterEach(()=>{cleanup();vi.clearAllMocks();localStorage.clear();gate.data=true})
describe('economic mobile screen',()=>{
 it('entry/route available only as experimental economy preparation',()=>{mount(<JevEconomyEntry/>);expect(screen.getByRole('link',{name:'Voir le mode économique'})).toHaveAttribute('href','/plus/jev-economy');expect(restorableRoute('/plus/jev-economy')).toBe(true)})
 it.each(['fr','vi'] as const)('renders %s counts/scores/unknown costs and disabled paid confirmation',async language=>{mount(<EconomyWorkspace data={await syntheticEconomy()}/>,language);expect(screen.getByText(language==='fr'?'Avis déjà analysés et réutilisables':'Đánh giá đã phân tích có thể tái sử dụng')).toBeInTheDocument();expect(screen.getAllByText(language==='fr'?'Nouveaux avis nécessitant JEV':'Đánh giá mới cần JEV')[0]).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:language==='fr'?'Voir la confirmation d’un futur test':'Xem xác nhận cho kiểm tra tương lai'}));expect(screen.getByRole('alertdialog')).toContainHTML('USD');expect(screen.getByRole('button',{name:language==='fr'?'Lancer le test payant — non activé':'Chạy kiểm tra trả phí — chưa bật'})).toBeDisabled();expect(api).not.toHaveBeenCalled()})
 it('read-only GET data restored from server after remount; refresh does not start a paid task',async()=>{const data=await syntheticEconomy();api.mockResolvedValue(data);const first=mount(<JevEconomyPage/>);await screen.findByText('Configuration prête · aucun test lancé');expect(api).toHaveBeenCalledExactlyOnceWith(data.establishment.id);fireEvent.click(screen.getByRole('button',{name:'Actualiser sans appel IA'}));await waitFor(()=>expect(api).toHaveBeenCalledTimes(2));first.unmount();mount(<JevEconomyPage/>);await screen.findByText('Configuration prête · aucun test lancé');expect(api).toHaveBeenCalledTimes(3);expect(api.mock.calls.every(args=>args.length===1)).toBe(true)})
 it('denied users cannot request or see data',()=>{gate.data=false;mount(<JevEconomyPage/>);expect(api).not.toHaveBeenCalled();expect(screen.getByText('Réservé aux propriétaires, administrateurs et managers.')).toBeInTheDocument()})
 it('changes retrospective pass with no API and labels uncertainty / AI limitations',async()=>{mount(<EconomyWorkspace data={await syntheticEconomy()}/>);fireEvent.change(screen.getByLabelText('Résultats V12 enregistrés : un passage / trois passages'),{target:{value:'mean3'}});expect(screen.getByText('Moyenne des trois passages · Négatif')).toBeInTheDocument();expect(screen.getByText(/aucun Gold humain/)).toBeInTheDocument();expect(api).not.toHaveBeenCalled()})
})
