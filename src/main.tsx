/* eslint-disable react-refresh/only-export-components */
import { StrictMode, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { AppProvider, useApp } from './app/AppContext'
import { I18nProvider } from './i18n'
import {supabase} from './lib/supabase'
import {authReturnKind,prepareAuthReturn} from './lib/auth-session'
import {PwaUpdateNotice} from './components/PwaUpdateNotice'
import './styles/global.css'
import './styles/pages.css'
import './styles/reference.css'
import './styles/warm-theme.css'

const Router=import.meta.env.VITE_ROUTER_MODE==='hash'?HashRouter:BrowserRouter
function AccountQueries({children}:{children:ReactNode}) {
  const [queryClient]=useState(()=>new QueryClient({defaultOptions:{queries:{staleTime:30_000,retry:1,refetchOnWindowFocus:false}}}))
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
function LocalizedApp(){
  const {preferredLanguage,currentUser}=useApp()
  return <AccountQueries key={currentUser.id??'anonymous'}><I18nProvider language={preferredLanguage??'fr'}><PwaUpdateNotice/><App/></I18nProvider></AccountQueries>
}
const root=createRoot(document.getElementById('root')!)
async function mountApp(){
  if(supabase&&authReturnKind(window.location.href)!=='none'){
    // Consume/clean OAuth's fragment before HashRouter interprets it as a route.
    root.render(<main className="auth-page"><div className="auth-brand"><span>H</span><div><strong>HOME</strong><small>REVIEWS</small></div></div><p role="status">Finalisation de la connexion Google…</p></main>)
    await prepareAuthReturn(supabase.auth)
  }
  root.render(<StrictMode><Router><AppProvider><LocalizedApp/></AppProvider></Router></StrictMode>)
}
void mountApp()
