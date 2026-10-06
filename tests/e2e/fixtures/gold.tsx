// Offline synthetic UI demonstration only; no authentication or real API/database.
import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {MemoryRouter} from 'react-router-dom'
import {I18nProvider} from '../../../src/i18n'
import {GoldAnnotation,GoldResults} from '../../../src/pages/GoldSetPage'
import {syntheticGold,syntheticLabels} from '../../fixtures/human-gold'
import {blindGoldProjection} from '../../../supabase/functions/_shared/gold-api'
import {normalizeGoldLabels,replacementGoldReview,compareGold,type GoldLabel} from '../../../supabase/functions/_shared/gold-core'
import '../../../src/styles/global.css'
import '../../../src/styles/pages.css'
import '../../../src/styles/reference.css'
import '../../../src/styles/warm-theme.css'
const params=new URLSearchParams(location.search),language=params.get('language')==='vi'?'vi':'fr',fixture=await syntheticGold()
const saved=JSON.parse(localStorage.getItem('gold-fixture-server')??'null');if(saved){fixture.set=saved.set;fixture.rows=saved.rows;fixture.labels=saved.labels}
if(params.get('phase')==='results'){fixture.rows.forEach(r=>r.confirmed_at='now');fixture.labels=syntheticLabels(fixture.rows.map(r=>r.review_id));fixture.set.status='completed';fixture.set.comparison=await compareGold(fixture.set.id,fixture.source,fixture.benchmark,fixture.rows,fixture.labels)}
export function Demo(){const [data,setData]=useState(blindGoldProjection(fixture.set,fixture.rows,fixture.labels,fixture.source,true)),[busy,setBusy]=useState(false);async function action(kind:string,payload:Record<string,unknown>={}){setBusy(true);try{if(kind==='confirm_review'){const id=payload.review_id as string,choices=normalizeGoldLabels(payload.choices as Record<string,unknown>);fixture.rows.find(r=>r.review_id===id)!.confirmed_at='now';fixture.labels=fixture.labels.filter(l=>l.review_id!==id);fixture.labels.push(...Object.entries(choices).map(([theme_key,choice])=>({review_id:id,theme_key,choice})) as GoldLabel[])}else if(kind==='exclude_review'){const next=await replacementGoldReview(fixture.source,fixture.benchmark,fixture.rows,payload.review_id as string);fixture.rows.find(r=>r.review_id===payload.review_id)!.excluded=true;fixture.rows.push(next)}else if(kind==='finalize'){fixture.set.status='completed';fixture.set.comparison=await compareGold(fixture.set.id,fixture.source,fixture.benchmark,fixture.rows,fixture.labels)}fixture.set.revision++;localStorage.setItem('gold-fixture-server',JSON.stringify({set:fixture.set,rows:fixture.rows,labels:fixture.labels}));setData(blindGoldProjection(fixture.set,fixture.rows,fixture.labels,fixture.source,true));return true}finally{setBusy(false)}}return <main className="page-frame"><div className="jev-page gold-page">{data.gold_set.status==='completed'?<GoldResults data={data}/>:<GoldAnnotation data={data} user="synthetic" busy={busy} action={action}/>}</div></main>}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><I18nProvider language={language}><Demo/></I18nProvider></MemoryRouter></QueryClientProvider>)
