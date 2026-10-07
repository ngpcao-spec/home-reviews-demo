// Real Supabase SDK, fake Auth service only. Never initiates Google or production auth.
import {createRoot} from 'react-dom/client'
import {HashRouter,Routes,Route,useLocation} from 'react-router-dom'
import {createClient} from '@supabase/supabase-js'
import {authReturnKind,browserAuthFlow,prepareAuthReturn,authStartupError} from '../../../src/lib/auth-session'
import {getGoogleOAuthOptions} from '../../../src/lib/auth-redirect'
import '../../../src/styles/global.css'
const flow=browserAuthFlow(location.href,navigator.userAgent,navigator.platform,navigator.maxTouchPoints)
const client=createClient('https://auth-fixture.supabase.co','fixture-public-key',{auth:{flowType:flow,persistSession:true,autoRefreshToken:false,detectSessionInUrl:true}})
if(authReturnKind(location.href)!=='none')await prepareAuthReturn(client.auth)
const {data}=await client.auth.getSession()
export function Fixture(){const route=useLocation();return <><p>Flow: {flow}</p><p>Route: {route.pathname}</p>{data.session?<h1>Session connected</h1>:<><h1>Google connection</h1>{authStartupError()&&<p role="alert">{authStartupError()}</p>}<button onClick={()=>void (async()=>{const result=await client.auth.signInWithOAuth({provider:'google',options:{...getGoogleOAuthOptions(location.origin,'/tests/e2e/fixtures/auth-iphone.html'),skipBrowserRedirect:true}});const url=new URL(result.data.url!);document.getElementById('result')!.textContent=url.searchParams.has('code_challenge')?'PKCE challenge':'No local PKCE verifier required'})()}>Start mock Google</button><p id="result"/></>}</>}
createRoot(document.getElementById('root')!).render(<HashRouter><Routes><Route path="*" element={<Fixture/>}/></Routes></HashRouter>)
