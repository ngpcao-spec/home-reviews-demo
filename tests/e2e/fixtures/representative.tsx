// Synthetic local fixture only. Never creates or annotates the real holdout.
import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {I18nProvider} from '../../../src/i18n'
import {RepresentativeAnnotation,RepresentativeResults} from '../../../src/pages/RepresentativeHumanPage'
import {syntheticRepresentative} from '../../fixtures/representative'
import {representativeProjection} from '../../../supabase/functions/_shared/representative-api'
import {scoreRepresentative} from '../../../supabase/functions/_shared/representative-score'
import {representativeReplacement} from '../../../supabase/functions/_shared/representative-selection'
import {normalizeGoldLabels,type GoldLabel} from '../../../supabase/functions/_shared/gold-core'
import '../../../src/styles/global.css'
import '../../../src/styles/pages.css'
import '../../../src/styles/reference.css'
import '../../../src/styles/warm-theme.css'
const params=new URLSearchParams(location.search),language=params.get('language')==='vi'?'vi':'fr',h=await syntheticRepresentative(),stored=JSON.parse(localStorage.getItem('representative-fixture-server')??'null')
let labels:GoldLabel[]=stored?.labels??[];if(stored)h.items=stored.items
if(params.get('phase')==='results'){h.test.status='completed';h.test.comparison=await scoreRepresentative(h.test.id,h.source,h.benchmark,h.items,h.labels,h.context.previous)}
export function Demo(){const [data,setData]=useState(representativeProjection(h.context,h.test,h.items,labels,true,h.selection.stats)),[busy,setBusy]=useState(false);async function action(kind:string,payload:Record<string,unknown>={}){setBusy(true);try{if(kind==='confirm_review'){labels=labels.filter(l=>l.review_id!==payload.review_id);labels.push(...Object.entries(normalizeGoldLabels(payload.choices as object)).map(([theme_key,choice])=>({review_id:payload.review_id,theme_key,choice})) as GoldLabel[]);h.items.find(i=>i.review_id===payload.review_id)!.confirmed_at='2026-10-07T00:00:00Z'}else if(kind==='exclude_review'){const replacement=await representativeReplacement(h.source.generation_id,h.context.reviews,h.context.goldIds,h.context.previousIds,h.items,payload.review_id as string);h.items.find(i=>i.review_id===payload.review_id)!.excluded=true;h.items.push({...replacement,confirmed_at:null})}else if(kind==='finalize'){h.test.status='completed';h.test.comparison=await scoreRepresentative(h.test.id,h.source,h.benchmark,h.items,labels,h.context.previous)}h.test.revision++;localStorage.setItem('representative-fixture-server',JSON.stringify({items:h.items,labels}));setData(representativeProjection(h.context,h.test,h.items,labels,true,h.selection.stats));return true}finally{setBusy(false)}}return <main className="page-frame"><div className="jev-page gold-page">{h.test.status==='completed'?<RepresentativeResults data={data}/>:<RepresentativeAnnotation data={data} user="fixture" busy={busy} action={action}/>}</div></main>}
createRoot(document.getElementById('root')!).render(<I18nProvider language={language}><Demo/></I18nProvider>)
