import {createRoot} from "react-dom/client";
import {useState} from 'react';
import {mockMultiCompletedView} from '../../fixtures/luna-multirest-results';
import {mockMultiLaunch} from '../../fixtures/luna-multirest-launch';
import {I18nProvider} from "../../../src/i18n";
import {MultiWorkspace} from "../../../src/pages/LunaMultirestPage";
import type {MultiView} from "../../../supabase/functions/_shared/luna-multirest-api";
import "../../../src/styles/global.css";import "../../../src/styles/pages.css";import "../../../src/styles/reference.css";import "../../../src/styles/warm-theme.css";
const language=new URLSearchParams(location.search).get("language")==="vi"?"vi":"fr";
const data=await fetch("/tests/e2e/fixtures/luna-multirest-mock.json").then(r=>r.json()) as MultiView;
const mode=new URLSearchParams(location.search).get('launch');
const f=mode?await mockMultiLaunch():null;
const prepared:MultiView=mode==='results'?await mockMultiCompletedView():f?{record:{...f.source.record,sealed_at:'2026-10-12'},reference_seal:{id:f.source.seal.id,reference_sha256:f.source.seal.reference_sha256,sealed_at:'2026-10-12',body:f.source.seal.body},launch:{...f.view,api_key_configured:mode!=='no-key',can_confirm:mode!=='no-key'},blind_export:null,result:null,paid_enabled:true,can_launch:mode!=='no-key',new_paid_calls:0,production_enabled:false}:data;
const storage='mock-multirest-launch-'+mode;
export function Fixture(){const [view,setView]=useState<MultiView>(()=>mode&&localStorage.getItem(storage)?JSON.parse(localStorage.getItem(storage)!):prepared);return <MultiWorkspace data={view} onFreeze={()=>Promise.reject(new Error('MOCK_ALREADY_FROZEN'))} onSeal={()=>Promise.reject(new Error('MOCK_SEAL_NOT_ACTUAL_REFERENCE'))} onRefresh={async()=>{if(mode&&localStorage.getItem(storage))setView(JSON.parse(localStorage.getItem(storage)!));}} onPrepare={f?async()=>{setView(v=>({...v,launch:{...v.launch!,plan_id:'mock-plan'}}));}:undefined} onConfirm={f?async()=>{localStorage.setItem('mock-confirmations',String(Number(localStorage.getItem('mock-confirmations')??0)+1));await new Promise(r=>setTimeout(r,200));const next={...view,launch:{...view.launch!,can_confirm:false,run:{id:'mock-run',status:'queued' as const,manifest_sha256:view.launch!.manifest_sha256,confirmed_at:'mock',result:null,result_sha256:null},tasks:f.tasks}};localStorage.setItem(storage,JSON.stringify(next));if(mode==='ambiguous')throw new Error('MOCK_NETWORK_RESPONSE_LOST');setView(next);}:undefined}/>;}
createRoot(document.getElementById("root")!).render(<I18nProvider language={language}><main className="page-frame"><div className="jev-page gold-page decisions-page"><Fixture/></div></main></I18nProvider>);
