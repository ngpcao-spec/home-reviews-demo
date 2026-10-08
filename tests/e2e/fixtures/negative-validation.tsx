// Offline fixture; no real experiment or provider call.
import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {I18nProvider} from '../../../src/i18n'
import {NegativeAnnotation,NegativeResults} from '../../../src/pages/NegativeValidationPage'
import {syntheticNegative,completeNegative,syntheticNegativeTasks} from '../../fixtures/negative-validation'
import {negativeProjection} from '../../../supabase/functions/_shared/negative-validation-api'
import {negativeChoices,type NegativeLabel} from '../../../supabase/functions/_shared/negative-validation-core'
import {compareNegativeValidation} from '../../../supabase/functions/_shared/negative-validation-score'
import '../../../src/styles/global.css'
import '../../../src/styles/pages.css'
import '../../../src/styles/reference.css'
import '../../../src/styles/warm-theme.css'
const params=new URLSearchParams(location.search),language=params.get('language')==='vi'?'vi':'fr',h=await syntheticNegative();let labels:NegativeLabel[]=JSON.parse(localStorage.getItem('negative-fixture-server')??'[]')
h.items.forEach(i=>{if(labels.some(l=>l.review_id===i.review_id))i.confirmed_at='2026-10-08T00:00:00Z'})
let comparison:Awaited<ReturnType<typeof compareNegativeValidation>>|null=null
if(params.get('phase')==='results'){labels=await completeNegative(h);h.run.benchmark_status='completed';comparison=await compareNegativeValidation(h.run,h.items,labels,syntheticNegativeTasks(h))}
export function Demo(){const [data,setData]=useState(negativeProjection(h.run,h.items,labels,comparison,true,null)),[busy,setBusy]=useState(false);async function action(kind:string,p:Record<string,unknown>={}){setBusy(true);try{if(kind==='confirm_review'){const choices=negativeChoices(p.choices as Record<string,unknown>);labels=labels.filter(l=>l.review_id!==p.review_id);labels.push(...Object.entries(choices).map(([theme_key,choice])=>({review_id:p.review_id,theme_key,choice}) as NegativeLabel));h.items.find(i=>i.review_id===p.review_id)!.confirmed_at='2026-10-08T00:00:00Z';localStorage.setItem('negative-fixture-server',JSON.stringify(labels))}else if(kind==='finalize_human')h.run.status='completed';h.run.revision++;setData(negativeProjection(h.run,h.items,labels,comparison,true,null));return true}finally{setBusy(false)}}return <main className="page-frame"><div className="jev-page gold-page">{comparison?<NegativeResults data={data}/>:h.run.status==='draft'?<NegativeAnnotation data={data} user="fixture" busy={busy} action={action}/>:<p>Human completed · benchmark idle</p>}</div></main>}
createRoot(document.getElementById('root')!).render(<MemoryRouter><I18nProvider language={language}><Demo/></I18nProvider></MemoryRouter>)
