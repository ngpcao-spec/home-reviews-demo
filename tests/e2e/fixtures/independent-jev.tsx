import React from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {I18nProvider} from '../../../src/i18n'
import {IndependentWorkspace} from '../../../src/pages/IndependentJevPage'
import {INDEPENDENT_CONFIG,compareIndependent} from '../../../supabase/functions/_shared/independent-jev-core'
import {syntheticIndependent} from '../../fixtures/independent-jev'
import type {IndependentView} from '../../../src/lib/independent-jev'
import '../../../src/styles/global.css'
import '../../../src/styles/pages.css'
import '../../../src/styles/reference.css'
import '../../../src/styles/warm-theme.css'
const f=await syntheticIndependent(),p=f.prepared,lang=new URLSearchParams(location.search).get('language')==='vi'?'vi':'fr'
const ready:IndependentView={configuration:{id:INDEPENDENT_CONFIG.id,config:INDEPENDENT_CONFIG,config_sha256:p.config_sha256,frozen_at:'2026-10-09'},ready:true,error_code:null,run:null,preview:{reviews:32,reference_labels:800,uncertain_labels:11,sealed_at:p.seal.sealed_at,reference_model:p.seal.model_source,reference_fingerprint:p.seal.reference_fingerprint,dataset_fingerprint:p.seal.frozen_dataset_fingerprint,config_sha256:p.config_sha256,prepared_sha256:p.prepared_sha256,expected_requests:192,estimated_input_tokens:p.estimated_input_tokens,estimated_cost_usd:p.estimated_cost_usd,rates:p.rates,translation_anomalies:[]},comparison:null,progress:{total:0,completed:0,failed:0}},done={...ready,run:{id:f.run.id,status:'completed' as const,error_code:null,created_at:f.run.created_at},comparison:await compareIndependent(f.run,f.tasks),progress:{total:192,completed:192,failed:0}}
export function Fixture(){const [view,setView]=React.useState(localStorage.getItem('independent-fixture-done')?done:ready);return <MemoryRouter><I18nProvider language={lang}><main className="page-frame"><div className="jev-page gold-page exploratory-page"><IndependentWorkspace data={view} busy={false} start={async()=>{localStorage.setItem('independent-fixture-done','1');setView(done)}}/></div></main></I18nProvider></MemoryRouter>}
createRoot(document.getElementById('root')!).render(<Fixture/>)
