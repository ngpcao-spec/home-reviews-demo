// Synthetic offline fixture. No production selection, saved labels or model calls.
import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {MemoryRouter} from 'react-router-dom'
import {I18nProvider} from '../../../src/i18n'
import {AdjudicationAnnotation,AdjudicationResults} from '../../../src/pages/GoldAdjudicationPage'
import {syntheticAdjudicationBundle,syntheticAdjudication} from '../../fixtures/gold-adjudication'
import {selectAdjudicationItems,compareAdjudication,type AdjudicationLabel} from '../../../supabase/functions/_shared/gold-adjudication-core'
import {adjudicationProjection} from '../../../supabase/functions/_shared/gold-adjudication-api'
import '../../../src/styles/global.css'
import '../../../src/styles/pages.css'
import '../../../src/styles/reference.css'
import '../../../src/styles/warm-theme.css'
const params=new URLSearchParams(location.search),language=params.get('language')==='vi'?'vi':'fr',bundle=await syntheticAdjudicationBundle(),a=await syntheticAdjudication(bundle),items=(await selectAdjudicationItems(bundle)).items
let labels:AdjudicationLabel[]=JSON.parse(localStorage.getItem('adjudication-fixture-server')??'[]')
if(params.get('phase')==='results'){labels=items.flatMap(i=>i.themes.map(theme_key=>({review_id:i.review_id,theme_key,choice:'positive' as const})));a.status='completed';a.comparison=compareAdjudication(bundle,items,labels)}
export function Demo(){const [data,setData]=useState(adjudicationProjection(a,items,labels,bundle,true)),[busy,setBusy]=useState(false);async function action(kind:string,payload:Record<string,unknown>={}){setBusy(true);try{if(kind==='save_choice'){labels=labels.filter(l=>l.review_id!==payload.review_id||l.theme_key!==payload.theme_key);labels.push({review_id:payload.review_id,theme_key:payload.theme_key,choice:payload.choice} as AdjudicationLabel);localStorage.setItem('adjudication-fixture-server',JSON.stringify(labels))}else if(kind==='finalize'){a.status='completed';a.comparison=compareAdjudication(bundle,items,labels)}a.revision++;setData(adjudicationProjection(a,items,labels,bundle,true));return true}finally{setBusy(false)}}return <main className="page-frame"><div className="jev-page gold-page">{a.status==='completed'?<AdjudicationResults data={data}/>:<AdjudicationAnnotation data={data} user="fixture" busy={busy} action={action}/>}</div></main>}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><I18nProvider language={language}><Demo/></I18nProvider></MemoryRouter></QueryClientProvider>)
