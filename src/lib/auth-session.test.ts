import {describe,it,expect,vi} from 'vitest'
import {authReturnKind,browserAuthFlow,cleanAuthReturnUrl,prepareAuthReturn,authStartupError,authStartupRecovery} from './auth-session'
const base='https://example.test/app/'
describe('iOS Google callback across browser storage contexts',()=>{
  it('uses client-only auth on iPhone/iPad, keeps PKCE for ordinary desktop starts, and accepts an implicit return in its new context',()=>{
    expect(browserAuthFlow(base,'iPhone','iPhone',5)).toBe('implicit');expect(browserAuthFlow(base,'Macintosh','MacIntel',5)).toBe('implicit');expect(browserAuthFlow(base,'Windows','Win32',0)).toBe('pkce')
    expect(browserAuthFlow(base+'#access_token=FAKE&refresh_token=FAKE','Windows','Win32',0)).toBe('implicit')
  })
  it('recognizes callbacks without interpreting ordinary routes as tokens',()=>{
    expect(authReturnKind(base+'#/plus/gold-check?id=fixture')).toBe('none');expect(authReturnKind(base+'?code=FAKE')).toBe('pkce');expect(authReturnKind(base+'#error=access_denied')).toBe('error')
  })
  it('removes all OAuth credentials/error details before routing, without logging/persisting them or removing ordinary query state',()=>{
    const input=base+'?view=all&code=FAKE&sb_flow_id=FAKE#access_token=FAKE&refresh_token=FAKE&provider_token=FAKE&expires_in=3600&type=signup'
    expect(cleanAuthReturnUrl(input)).toBe(base+'?view=all');expect(cleanAuthReturnUrl(base+'?code=FAKE#/connexion')).toBe(base+'#/connexion')
  })
  it('waits for initialization/session persistence before cleaning the return',async()=>{
    const order:string[]=[],replace=vi.fn(()=>order.push('clean')),auth={initialize:vi.fn(async()=>{order.push('initialize');return {error:null}}),getSession:vi.fn(async()=>{order.push('session');return {data:{session:{user:{id:'authorized'}}},error:null}})}
    await prepareAuthReturn(auth,base+'#access_token=FAKE&refresh_token=FAKE',replace)
    expect(order).toEqual(['initialize','session','clean']);expect(replace).toHaveBeenCalledWith(base);expect(authStartupError()).toBe('')
  })
  it('missing local PKCE state gives a visible restart message and strips the one-time code instead of silently looping',async()=>{
    const auth={initialize:vi.fn(async()=>({error:null})),getSession:vi.fn(async()=>({data:{session:null},error:null})),exchangeCodeForSession:vi.fn(async()=>({data:{session:null},error:new Error('missing verifier')}))},replace=vi.fn()
    await prepareAuthReturn(auth,base+'?code=FAKE',replace);expect(authStartupError()).toContain('recommencer ici');expect(replace).toHaveBeenCalledWith(base)
  })
  it('an older PKCE return can still exchange with its stored verifier before a fresh iOS sign-in',async()=>{
    const auth={initialize:vi.fn(async()=>({error:new Error('old flow')})),getSession:vi.fn(async()=>({data:{session:null},error:null})),exchangeCodeForSession:vi.fn(async()=>({data:{session:{user:{id:'authorized'}}},error:null}))}
    await prepareAuthReturn(auth,base+'?code=FAKE',()=>{});expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('FAKE',{flowId:undefined});expect(authStartupError()).toBe('')
  })
  it('preserves password recovery before URL cleanup and passes only safe messages on errors',async()=>{
    const unsubscribe=vi.fn(),auth={initialize:vi.fn(async()=>({error:new Error('SENSITIVE_VENDOR_CONTENT')})),getSession:vi.fn(async()=>({data:{session:null}})),onAuthStateChange:vi.fn((callback:(event:string)=>void)=>{callback('PASSWORD_RECOVERY');return {data:{subscription:{unsubscribe}}}})}
    await prepareAuthReturn(auth,base+'#error_description=SENSITIVE_VENDOR_CONTENT&type=recovery',()=>{});expect(authStartupRecovery()).toBe(true);expect(authStartupError()).not.toContain('SENSITIVE_VENDOR_CONTENT');expect(unsubscribe).toHaveBeenCalled()
  })
})
