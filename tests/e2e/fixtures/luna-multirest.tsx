import {createRoot} from "react-dom/client";
import {I18nProvider} from "../../../src/i18n";
import {MultiWorkspace} from "../../../src/pages/LunaMultirestPage";
import type {MultiView} from "../../../supabase/functions/_shared/luna-multirest-api";
import "../../../src/styles/global.css";import "../../../src/styles/pages.css";import "../../../src/styles/reference.css";import "../../../src/styles/warm-theme.css";
const language=new URLSearchParams(location.search).get("language")==="vi"?"vi":"fr";
const data=await fetch("/tests/e2e/fixtures/luna-multirest-mock.json").then(r=>r.json()) as MultiView;
createRoot(document.getElementById("root")!).render(<I18nProvider language={language}><main className="page-frame"><div className="jev-page gold-page decisions-page"><MultiWorkspace data={data} onFreeze={()=>Promise.reject(new Error("MOCK_ALREADY_FROZEN"))} onSeal={()=>Promise.reject(new Error("MOCK_SEAL_NOT_ACTUAL_REFERENCE"))} onRefresh={()=>Promise.resolve()}/></div></main></I18nProvider>);
