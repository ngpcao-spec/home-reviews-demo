// Offline synthetic fixtures only: no real dataset or provider call.
import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {I18nProvider} from '../../../src/i18n'
import {V12Workspace} from '../../../src/pages/JevV12TestPage'
import {syntheticV12} from '../../fixtures/jev-v12'
import {compareV12} from '../../../supabase/functions/_shared/jev-v12-core'
import {V12_CONFIG} from '../../../supabase/functions/_shared/jev-v12-config'
import type {V12View} from '../../../src/lib/jev-v12'
import '../../../src/styles/global.css'
import '../../../src/styles/pages.css'
import '../../../src/styles/reference.css'
import '../../../src/styles/warm-theme.css'
const language=new URLSearchParams(location.search).get('language')==='vi'?'vi':'fr',f=await syntheticV12(),comparison=await compareV12(f.run,f.v12Tasks)
export function Demo(){const [done,setDone]=useState(localStorage.getItem('v12-fixture-server')==='done'),p=f.prepared,data:V12View={configuration:{id:V12_CONFIG.question_set,config:V12_CONFIG,config_sha256:p.config_sha256,frozen_at:'2026-10-09'},ready:true,error_code:null,run:done?{id:f.run.id,status:'completed',created_at:f.run.created_at,error_code:null}:null,preview:{source_reviews:32,eligible_reviews:30,source_exclusions:p.source_exclusions,source_invalid_responses:2,rechecks_total:p.rechecks_total,rechecks_applied:p.rechecks_applied,uncertain_labels:1,expected_requests:90,estimated_input_tokens:p.estimated_input_tokens,estimated_cost_usd:p.estimated_cost_usd,input_rate:p.input_rate,prepared_sha256:p.prepared_sha256,dataset_sha256:p.dataset_sha256},comparison:done?comparison:null,progress:{total:done?90:0,completed:done?90:0,failed:0}};return <main className="page-frame"><div className="jev-page gold-page exploratory-page"><V12Workspace data={data} busy={false} start={async()=>{localStorage.setItem('v12-fixture-server','done');setDone(true)}}/></div></main>}
createRoot(document.getElementById('root')!).render(<MemoryRouter><I18nProvider language={language}><Demo/></I18nProvider></MemoryRouter>)
