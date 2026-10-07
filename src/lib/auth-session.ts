export type AuthReturn='none'|'pkce'|'implicit'|'error'
export function authReturnKind(href:string):AuthReturn {
  const url=new URL(href),hash=new URLSearchParams(url.hash.slice(1))
  if(hash.has('access_token')&&hash.has('refresh_token'))return 'implicit'
  if(url.searchParams.has('code'))return 'pkce'
  if(['error','error_code','error_description'].some(k=>url.searchParams.has(k)||hash.has(k)))return 'error'
  return 'none'
}
export function browserAuthFlow(href:string,userAgent:string,platform:string,touchPoints:number):'implicit'|'pkce' {
  const kind=authReturnKind(href)
  if(kind==='implicit')return 'implicit'
  const ios=/iPhone|iPad|iPod/i.test(userAgent)||(platform==='MacIntel'&&touchPoints>1)
  return ios?'implicit':'pkce'
}
const AUTH_KEYS=['code','sb_flow_id','access_token','refresh_token','provider_token','provider_refresh_token','token_type','expires_in','expires_at','error','error_code','error_description','type']
export function cleanAuthReturnUrl(href:string) {
  const url=new URL(href),kind=authReturnKind(href)
  if(kind==='none')return href
  AUTH_KEYS.forEach(k=>url.searchParams.delete(k))
  if(!url.hash.startsWith('#/')){const hash=new URLSearchParams(url.hash.slice(1));AUTH_KEYS.forEach(k=>hash.delete(k));url.hash=hash.toString()}
  return url.toString()
}
let startupError=''
export const authStartupError=()=>startupError
let startupRecovery=false
export const authStartupRecovery=()=>startupRecovery
interface AuthCallbackClient {
  initialize:()=>Promise<{error:unknown}>;getSession:()=>Promise<{data:{session:unknown};error?:unknown}>
  exchangeCodeForSession?:(code:string,options?:{flowId?:string})=>Promise<{data:{session:unknown};error?:unknown}>
  onAuthStateChange?:(callback:(event:string)=>void)=>{data:{subscription:{unsubscribe:()=>void}}}
}
export async function prepareAuthReturn(auth:AuthCallbackClient,href=window.location.href,replace:(url:string)=>void=url=>window.history.replaceState(window.history.state,'',url)) {
  const kind=authReturnKind(href);if(kind==='none')return
  startupError=''
  const original=new URL(href),fragment=new URLSearchParams(original.hash.slice(1))
  startupRecovery=original.searchParams.get('type')==='recovery'||fragment.get('type')==='recovery'
  const listener=auth.onAuthStateChange?.(event=>{if(event==='PASSWORD_RECOVERY')startupRecovery=true})
  try {
    const initialized=await auth.initialize();let session=await auth.getSession(),failure=initialized.error||session.error
    // Recover an older PKCE return on iOS using its stored verifier, when available.
    // This public SDK method rejects missing verifiers; it never bypasses PKCE.
    if(kind==='pkce'&&!session.data.session&&auth.exchangeCodeForSession){session=await auth.exchangeCodeForSession(original.searchParams.get('code')!,{flowId:original.searchParams.get('sb_flow_id')??undefined});failure=session.error}
    if(failure||!session.data.session)startupError=kind==='pkce'?'La connexion Google précédente ne peut pas être reprise dans ce navigateur. Touchez « Continuer avec Google » pour recommencer ici.':'La connexion Google n’a pas pu être finalisée. Réessayez depuis cet écran.'
  }catch{startupError='La connexion Google n’a pas pu être finalisée. Vérifiez votre connexion puis réessayez.'}
  finally{listener?.data.subscription.unsubscribe();replace(cleanAuthReturnUrl(href))}
}
