/* eslint-disable react-refresh/only-export-components */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '../../../src/App'
import { AppProvider, useApp } from '../../../src/app/AppContext'
import { I18nProvider } from '../../../src/i18n'
import { resumeHarness } from './resume-supabase'
import { readAppCache, purgeAppCache } from '../../../src/lib/app-cache'
import '../../../src/styles/global.css'
import '../../../src/styles/pages.css'
import '../../../src/styles/reference.css'
import '../../../src/styles/warm-theme.css'

Object.assign(window,{resumeHarness,readAppCache,purgeAppCache})
function TestApp(){const {preferredLanguage}=useApp();return <I18nProvider language={preferredLanguage??'fr'}><App/></I18nProvider>}
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={new QueryClient()}><HashRouter><AppProvider><TestApp/></AppProvider></HashRouter></QueryClientProvider></StrictMode>)
if(import.meta.env.PROD && 'serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js')
