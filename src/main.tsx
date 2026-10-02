/* eslint-disable react-refresh/only-export-components */
import { StrictMode, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { AppProvider, useApp } from './app/AppContext'
import { I18nProvider } from './i18n'
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
  return <AccountQueries key={currentUser.id??'anonymous'}><I18nProvider language={preferredLanguage??'fr'}><App/></I18nProvider></AccountQueries>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Router><AppProvider><LocalizedApp/></AppProvider></Router></StrictMode>)

if('serviceWorker'in navigator&&import.meta.env.PROD)window.addEventListener('load',()=>navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`))
