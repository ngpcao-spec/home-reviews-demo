import { cleanup,render,screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach,describe,it,expect,vi } from 'vitest'
import { SettingsPage } from './SettingsPage'
import { I18nProvider } from '../i18n'
const gate=vi.hoisted(()=>({data:false,isPending:false}))
vi.mock('../lib/use-jev-access',()=>({useJevAccess:()=>gate}))
vi.mock('../app/AppContext',()=>({useApp:()=>({currentUser:{id:'user',name:'HOME',email:'',initials:'H'},establishments:[],notifications:[],demoMode:false,monitoringIntervalHours:12,preferredLanguage:'fr',pushToast:vi.fn(),updatePreferredLanguage:vi.fn(),updateMonitoringInterval:vi.fn(),signOut:vi.fn()})}))
vi.mock('../lib/push-notifications',()=>({pushIsSupported:()=>false,getPushUiState:()=> 'unsupported',isIosDevice:()=>false,isStandalonePwa:()=>false,currentPushSubscription:async()=>null,disablePushNotifications:vi.fn(),enablePushNotifications:vi.fn()}))
afterEach(()=>cleanup())
describe('Temporary Jev Plus menu',()=>{
  it.each(['owner','admin','manager'])('permitted %s can reach Jev',()=>{
    gate.data=true;render(<MemoryRouter><SettingsPage/></MemoryRouter>)
    expect(screen.getByRole('link',{name:/Test Jev/})).toHaveAttribute('href','/plus/jev-benchmark')
  })
  it('standard or unresolved membership cannot see menu entry',()=>{
    gate.data=false;render(<MemoryRouter><SettingsPage/></MemoryRouter>);expect(screen.queryByRole('link',{name:/Test Jev/})).not.toBeInTheDocument()
  })
  it('Vietnamese entry uses Thử nghiệm Jev',()=>{
    gate.data=true;render(<MemoryRouter><I18nProvider language="vi"><SettingsPage/></I18nProvider></MemoryRouter>)
    expect(screen.getByRole('link',{name:/Thử nghiệm Jev/})).toBeVisible()
  })
})
