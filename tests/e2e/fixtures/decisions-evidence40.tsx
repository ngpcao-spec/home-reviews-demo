import {createRoot} from "react-dom/client";
import {useState} from "react";
import {I18nProvider} from "../../../src/i18n";
import {Evidence40Workspace} from "../../../src/pages/DecisionsEvidence40Page";
import type {E40View} from "../../../supabase/functions/_shared/decisions-evidence40";
import "../../../src/styles/global.css";import "../../../src/styles/pages.css";import "../../../src/styles/reference.css";import "../../../src/styles/warm-theme.css";
const language=new URLSearchParams(location.search).get("language")==="vi"?"vi":"fr";
const initial=await fetch("/tests/e2e/fixtures/decisions-evidence40-mock.json").then(r=>r.json()) as E40View;
export function MockPage(){const [v,setV]=useState<E40View>(()=>JSON.parse(localStorage.getItem("e40-mock-view")??JSON.stringify(initial)));const save=(d:E40View)=>{localStorage.setItem("e40-mock-view",JSON.stringify(d));setV(d);};return <Evidence40Workspace data={v} onPrepare={async()=>{save({...v,plan_id:"mock-plan"});localStorage.setItem("e40-free-count",String(Number(localStorage.getItem("e40-free-count"))+1));}} onConfirm={async()=>{localStorage.setItem("e40-confirm-count",String(Number(localStorage.getItem("e40-confirm-count"))+1));await new Promise(r=>setTimeout(r,100));save({...v,run:{id:"mock-run",status:"running",confirmed_at:"2026-10-12",manifest_sha256:v.manifest_sha256},tasks:[]});}} onRefresh={async()=>{const d=JSON.parse(localStorage.getItem("e40-mock-view")??JSON.stringify(initial)) as E40View;if(d.run)save({...d,run:{...d.run,status:"completed"},result:(initial as E40View & {mock_result:E40View["result"]}).mock_result});else setV(d);}}/>;}
createRoot(document.getElementById("root")!).render(<I18nProvider language={language}><main className="page-frame"><div className="jev-page gold-page decisions-page"><MockPage/></div></main></I18nProvider>);
